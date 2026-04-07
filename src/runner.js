import path from 'path';
import os from 'os';
import fs from 'fs';
import { lookup } from 'dns/promises';
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';
import { CONFIG, log } from './config.js';

// ─── URL Validation ────────────────────────────────────────────────

async function isBlockedIp(hostname) {
  if (CONFIG.LOCALHOST_HOSTS.includes(hostname)) return false;

  try {
    const { address } = await lookup(hostname);
    return CONFIG.BLOCKED_IP_PREFIXES.some(prefix => address.startsWith(prefix));
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

// ─── Lighthouse Execution ──────────────────────────────────────────

export async function runLighthouse(url, options = {}) {
  const validatedUrl = await validateUrl(url);

  const categories = options.categories || CONFIG.DEFAULT_CATEGORIES;
  const viewport = options.viewport || CONFIG.DEFAULT_VIEWPORT;

  const chrome = await launch({
    chromeFlags: [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
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
        // Performance scores will differ from Lighthouse CLI defaults (which apply simulated throttling).
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
    await chrome.kill();
  }
}

// ─── Test-only exports ─────────────────────────────────────────────

export const _test = { validateUrl, validateOutputDir, isBlockedIp };
