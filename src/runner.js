import path from 'path';
import os from 'os';
import fs from 'fs';
import net from 'net';
import crypto from 'crypto';
import { lookup } from 'dns/promises';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { CONFIG, log } from './config.js';

// ─── Request Queue ─────────────────────────────────────────────────
// Audits run strictly one at a time (each spawns a full Chrome). The
// queue bounds how many callers may wait; beyond that we reject fast
// rather than let requests pile up past any MCP client timeout.

function createQueue(maxDepth) {
  let pending = 0;
  let chain = Promise.resolve();

  return {
    run(fn) {
      if (pending >= maxDepth) {
        return Promise.reject(new Error('Audit queue full — try again shortly'));
      }
      pending++;
      const result = chain.then(() => fn());
      chain = result.then(() => {}, () => {});
      return result.finally(() => { pending--; });
    },
  };
}

const auditQueue = createQueue(CONFIG.MAX_QUEUE_DEPTH);

// ─── URL Validation ────────────────────────────────────────────────

const blockList = new net.BlockList();
for (const [address, prefix, family] of CONFIG.BLOCKED_IP_RANGES) {
  blockList.addSubnet(address, prefix, family);
}

async function isBlockedIp(hostname) {
  if (CONFIG.LOCALHOST_HOSTS.includes(hostname)) return false;

  try {
    // Check every address the hostname resolves to, not just the first —
    // a host with one public and one private record must still be blocked.
    const addresses = await lookup(hostname, { all: true });
    for (const { address } of addresses) {
      // Normalize IPv6-mapped IPv4: ::ffff:1.2.3.4 → 1.2.3.4
      const normalized = address.startsWith('::ffff:') ? address.slice(7) : address;
      const version = net.isIP(normalized);
      if (version === 0) return true; // unrecognizable address — fail closed
      if (blockList.check(normalized, version === 6 ? 'ipv6' : 'ipv4')) return true;
    }
    return false;
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

// Path containment with a separator guard: '/tmpfoo' is NOT within '/tmp'.
function isWithin(child, root) {
  return child === root || child.startsWith(root + path.sep);
}

function validateOutputDir(dir) {
  const resolved = path.resolve(dir);
  const home = os.homedir();
  const realHome = fs.realpathSync(home);
  const realTmp = fs.realpathSync('/tmp');

  // Logical path check (fast reject for obvious violations)
  if (!isWithin(resolved, home) && !isWithin(resolved, '/tmp') && !isWithin(resolved, '/private/tmp')) {
    throw new Error('Output directory is outside allowed paths');
  }

  // Walk up to the deepest existing ancestor and resolve its real path.
  // This catches symlink escapes BEFORE we create any directories.
  let existing = resolved;
  while (!fs.existsSync(existing)) {
    existing = path.dirname(existing);
  }
  const realExisting = fs.realpathSync(existing);
  if (!isWithin(realExisting, realHome) && !isWithin(realExisting, realTmp)) {
    throw new Error('Output directory is outside allowed paths');
  }

  // Now safe to create — the ancestor is verified
  fs.mkdirSync(resolved, { recursive: true });
  const real = fs.realpathSync(resolved);

  // Final check on the created path (belt and suspenders)
  if (!isWithin(real, realHome) && !isWithin(real, realTmp)) {
    throw new Error('Output directory is outside allowed paths');
  }

  return real;
}

// ─── HTML report save ──────────────────────────────────────────────

function saveHtmlReport(directory, html) {
  if (!html) {
    log('error', 'HTML report not available — skipping save');
    return null;
  }
  const dir = validateOutputDir(directory);
  // 'wx' refuses to write through a pre-existing file or symlink at the
  // target path; the random suffix makes collisions effectively impossible.
  for (let attempt = 0; attempt < 2; attempt++) {
    const filename = `lighthouse-${Date.now()}-${crypto.randomBytes(3).toString('hex')}.html`;
    const filePath = path.join(dir, filename);
    try {
      fs.writeFileSync(filePath, html, { flag: 'wx' });
      log('info', `HTML report saved: ${filePath}`);
      return filePath;
    } catch (err) {
      if (err.code !== 'EEXIST') throw err;
    }
  }
  log('error', 'HTML report save failed — target filenames already exist');
  return null;
}

// ─── Sanitize error messages ───────────────────────────────────────

const KNOWN_ERRORS = [
  'Blocked URL scheme',
  'Blocked URL',
  'Output directory is outside allowed paths',
  'Lighthouse audit timed out',
  'Audit queue full',
  'No valid categories specified',
];

function sanitizeError(err) {
  const msg = err.message || 'Unknown error';
  // Pass through known safe error messages
  if (KNOWN_ERRORS.some(known => msg.startsWith(known))) return msg;
  // chrome-launcher could not find a Chrome/Chromium binary
  if (err.code === 'ERR_LAUNCHER_PATH_NOT_SET'
      || msg.includes('CHROME_PATH')
      || msg.includes('No Chrome installations found')) {
    return 'Chrome not found — install Google Chrome or set CHROME_PATH';
  }
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
      // HTML report is at index 1 when output is ['json', 'html']
      const htmlReport = Array.isArray(result.report) ? result.report[1] : result.report;
      htmlPath = saveHtmlReport(options.directory, htmlReport);
    }

    return { lhr: result.lhr, htmlPath };
  } finally {
    await killChrome(chrome);
  }
}

// Public entry point — serialized through the bounded queue
export function runLighthouse(url, options) {
  return auditQueue.run(() => _runLighthouse(url, options));
}

// ─── Test-only exports ─────────────────────────────────────────────

export { sanitizeError };

export const _test = { validateUrl, validateOutputDir, isBlockedIp, isWithin, createQueue, saveHtmlReport };
