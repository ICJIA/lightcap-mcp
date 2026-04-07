import path from 'path';
import os from 'os';
import fs from 'fs';
import { lookup } from 'dns/promises';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { CONFIG, log } from './config.js';

// ─── Request Serialization ────────────────────────────────────────

let inFlight = 0;
let queue = Promise.resolve();

function enqueue(fn) {
  queue = queue.then(() => fn(), () => fn());
  return queue;
}

// ─── URL Validation ────────────────────────────────────────────────

async function isBlockedIp(hostname) {
  if (CONFIG.LOCALHOST_HOSTS.includes(hostname)) return false;

  try {
    const { address } = await lookup(hostname);
    // Normalize IPv6-mapped IPv4: ::ffff:1.2.3.4 → 1.2.3.4
    const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
    return CONFIG.BLOCKED_IP_PREFIXES.some(prefix => normalized.startsWith(prefix));
  } catch {
    // DNS resolution failed — fail closed (block the request)
    return true;
  }
}

async function validateUrl(url) {
  const parsed = new URL(url);

  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('Blocked URL scheme');
  }

  if (CONFIG.BLOCKED_HOSTNAMES.includes(parsed.hostname)) {
    throw new Error('Blocked URL');
  }

  if (await isBlockedIp(parsed.hostname)) {
    throw new Error('Blocked URL');
  }

  if (!CONFIG.LOCALHOST_HOSTS.includes(parsed.hostname)) {
    log('info', `Navigating to external host: ${parsed.hostname}`);
  }

  return parsed.href;
}

// ─── Directory Validation ──────────────────────────────────────────

function validateOutputDir(dir) {
  const resolved = path.resolve(dir);
  const home = os.homedir();
  const realHome = fs.realpathSync(home);
  const realTmp = fs.realpathSync('/tmp');

  // Logical path check (fast reject for obvious violations)
  if (!resolved.startsWith(home) && !resolved.startsWith('/tmp') && !resolved.startsWith('/private/tmp')) {
    throw new Error('Output directory is outside allowed paths');
  }

  // Walk up to the deepest existing ancestor and resolve its real path.
  // This catches symlink escapes BEFORE we create any directories.
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    existing = path.dirname(existing);
  }
  const realExisting = fs.realpathSync(existing);
  if (!realExisting.startsWith(realHome) && !realExisting.startsWith(realTmp)) {
    throw new Error('Output directory is outside allowed paths');
  }

  // Now safe to create — the ancestor is verified
  fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync(resolved);

  // Final check on the created path (belt and suspenders)
  if (!real.startsWith(realHome) && !real.startsWith(realTmp)) {
    throw new Error('Output directory is outside allowed paths');
  }

  return real;
}

// ─── Sanitize error messages ───────────────────────────────────────

const KNOWN_ERRORS = [
  'Blocked URL scheme',
  'Blocked URL',
  'Output directory is outside allowed paths',
  'Lighthouse audit timed out',
  'Audit queue full',
];

function sanitizeError(err) {
  const msg = err.message || 'Unknown error';
  // Pass through known safe error messages
  if (KNOWN_ERRORS.some(known => msg.startsWith(known))) return msg;
  // Lighthouse/Chrome errors: strip paths and return generic message
  if (msg.includes('ECONNREFUSED') || msg.includes('ERR_CONNECTION_REFUSED')) {
    return 'Could not connect to URL';
  }
  if (msg.includes('ETIMEOUT') || msg.includes('ERR_TIMED_OUT')) {
    return 'Connection timed out';
  }
  if (msg.includes('ERR_NAME_NOT_RESOLVED')) {
    return 'Could not resolve hostname';
  }
  if (msg.includes('Invalid URL')) {
    return 'Invalid URL';
  }
  // Generic fallback — never leak internal details
  log('error', `Unhandled error: ${msg}`);
  return 'Audit failed';
}

// ─── Chrome kill with force fallback ───────────────────────────────

async function killChrome(chrome) {
  try {
    await chrome.kill();
  } catch {
    // kill() failed — try SIGKILL via the PID
    try {
      if (chrome.pid) process.kill(chrome.pid, 'SIGKILL');
    } catch { /* already dead */ }
  }
}

// ─── Lighthouse Execution ──────────────────────────────────────────

async function _runLighthouse(url, options = {}) {
  const validatedUrl = await validateUrl(url);

  // Validate categories against allowed set
  const validCategories = new Set(CONFIG.DEFAULT_CATEGORIES);
  const categories = (options.categories || CONFIG.DEFAULT_CATEGORIES)
    .filter(c => validCategories.has(c));
  if (categories.length === 0) {
    throw new Error('No valid categories specified');
  }

  const viewport = options.viewport || CONFIG.DEFAULT_VIEWPORT;

  if (inFlight >= CONFIG.MAX_CONCURRENT_AUDITS) {
    throw new Error('Audit queue full — try again shortly');
  }
  inFlight++;

  const chrome = await launch({
    chromeFlags: [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      '--disable-default-apps',
      '--disable-sync',
      '--disable-translate',
      '--no-default-browser-check',
      // Platform-specific sandbox
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  });

  try {
    const startTime = Date.now();

    const flags = {
      port: chrome.port,
      output: options.directory ? ['json', 'html'] : ['json'],
      maxWaitForLoad: CONFIG.NAV_TIMEOUT,
    };

    const config = {
      extends: 'lighthouse:default',
      settings: {
        onlyCategories: categories,
        formFactor: viewport === 'mobile' ? 'mobile' : 'desktop',
        screenEmulation: viewport === 'mobile'
          ? { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 }
          : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1 },
        // Desktop: throttling disabled for localhost accuracy.
        throttling: viewport === 'mobile'
          ? undefined
          : { rttMs: 0, throughputKbps: 0, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
      },
    };

    // Timeout with cleanup so timer doesn't hold process open
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Lighthouse audit timed out')), CONFIG.AUDIT_TIMEOUT);
    });

    const result = await Promise.race([
      lighthouse(validatedUrl, flags, config),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId));

    // Post-audit SSRF check: validate the final URL after redirects/DNS rebinding.
    // Fail-closed: if we can't determine the final URL, reject the result.
    const finalUrl = result.lhr?.finalDisplayedUrl || result.lhr?.finalUrl;
    if (!finalUrl) {
      throw new Error('Blocked URL');
    }
    try {
      await validateUrl(finalUrl);
    } catch {
      throw new Error('Blocked URL');
    }

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('info', `Audit completed in ${elapsed}s`);

    let htmlPath = null;
    if (options.directory) {
      const dir = validateOutputDir(options.directory);
      const filename = `lighthouse-${Date.now()}.html`;
      const filePath = path.join(dir, filename);
      // HTML report is at index 1 when output is ['json', 'html']
      fs.writeFileSync(filePath, result.report[1]);
      log('info', `HTML report saved: ${filePath}`);
      htmlPath = filePath;
    }

    return { lhr: result.lhr, htmlPath };
  } finally {
    inFlight--;
    await killChrome(chrome);
  }
}

// Public entry point — serialized through queue
export function runLighthouse(url, options) {
  return enqueue(() => _runLighthouse(url, options));
}

// ─── Test-only exports ─────────────────────────────────────────────

export { sanitizeError };

export const _test = { validateUrl, validateOutputDir, isBlockedIp };
