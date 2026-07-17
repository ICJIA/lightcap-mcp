import { describe, it, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { _test, sanitizeError } from '../src/runner.js';

const { validateUrl, isBlockedIp, isWithin, validateOutputDir, createQueue, saveHtmlReport } = _test;

// ─── CIDR-based IP blocking (behavioral) ───────────────────────────
// All inputs are IP literals: dns.lookup returns them without a network query.

describe('isBlockedIp blocks private/reserved ranges', () => {
  const blocked = [
    '10.0.0.1',            // RFC1918 10/8
    '192.168.1.1',         // RFC1918 192.168/16
    '172.20.0.1',          // RFC1918 172.16/12 interior
    '172.31.255.255',      // RFC1918 172.16/12 upper edge
    '169.254.169.254',     // link-local / AWS metadata
    '127.0.0.2',           // loopback beyond 127.0.0.1
    '0.0.0.0',             // unspecified (no longer allowlisted)
    '100.64.0.1',          // CGNAT 100.64/10
    'fe80::1',             // IPv6 link-local
    'febf::1',             // IPv6 link-local fe80::/10 upper tail
    'fd00::1',             // IPv6 unique-local
    'fd12:3456::1',        // IPv6 unique-local beyond the literal fd00: prefix
    'fdff::1',             // IPv6 unique-local upper edge
    '::ffff:10.0.0.1',     // IPv4-mapped IPv6
  ];
  for (const ip of blocked) {
    it(`blocks ${ip}`, async () => {
      assert.equal(await isBlockedIp(ip), true);
    });
  }
});

describe('isBlockedIp allows public addresses', () => {
  const allowed = ['8.8.8.8', '1.1.1.1', '2606:4700:4700::1111'];
  for (const ip of allowed) {
    it(`allows ${ip}`, async () => {
      assert.equal(await isBlockedIp(ip), false);
    });
  }

  it('still short-circuits localhost hostnames', async () => {
    assert.equal(await isBlockedIp('localhost'), false);
    assert.equal(await isBlockedIp('127.0.0.1'), false);
    assert.equal(await isBlockedIp('::1'), false);
  });
});

describe('validateUrl blocks unspecified-address hosts', () => {
  it('blocks http://[::]', async () => {
    await assert.rejects(
      () => validateUrl('http://[::]:8080/'),
      { message: 'Blocked URL' }
    );
  });

  it('still blocks http://0.0.0.0', async () => {
    await assert.rejects(
      () => validateUrl('http://0.0.0.0:8080/'),
      { message: 'Blocked URL' }
    );
  });
});

// ─── isWithin path containment ─────────────────────────────────────

describe('isWithin', () => {
  it('accepts the root itself and true children', () => {
    assert.equal(isWithin('/tmp', '/tmp'), true);
    assert.equal(isWithin('/tmp/reports', '/tmp'), true);
    const home = os.homedir();
    assert.equal(isWithin(path.join(home, 'reports'), home), true);
  });

  it('rejects sibling paths that share the root as a string prefix', () => {
    assert.equal(isWithin('/tmpfoo', '/tmp'), false);
    const home = os.homedir();
    assert.equal(isWithin(home + 'XXX', home), false);
    assert.equal(isWithin(home + ' 2/reports', home), false);
  });

  it('rejects parents and unrelated paths', () => {
    assert.equal(isWithin('/', '/tmp'), false);
    assert.equal(isWithin('/var/anything', '/tmp'), false);
  });
});

// ─── validateOutputDir (behavioral) ────────────────────────────────

describe('validateOutputDir', () => {
  const base = path.join('/tmp', `lightcap-test-${process.pid}-${Date.now()}`);

  after(() => {
    fs.rmSync(base, { recursive: true, force: true });
  });

  it('creates and returns the real path for a /tmp subdirectory', () => {
    const real = validateOutputDir(path.join(base, 'reports'));
    assert.ok(fs.existsSync(real));
    assert.ok(real.includes('lightcap-test-'));
  });

  it('rejects paths outside home and /tmp', () => {
    assert.throws(
      () => validateOutputDir('/var/lightcap-nope'),
      { message: 'Output directory is outside allowed paths' }
    );
  });

  it('rejects sibling-named paths outside the allowed roots', () => {
    assert.throws(
      () => validateOutputDir(`/tmpfoo-lightcap-${process.pid}`),
      { message: 'Output directory is outside allowed paths' }
    );
  });

  it('rejects symlink escapes to outside the allowed roots', () => {
    fs.mkdirSync(base, { recursive: true });
    const link = path.join(base, 'esc');
    fs.rmSync(link, { force: true });
    fs.symlinkSync('/var', link);
    assert.throws(
      () => validateOutputDir(path.join(link, 'out')),
      { message: 'Output directory is outside allowed paths' }
    );
  });
});

// ─── saveHtmlReport ────────────────────────────────────────────────

describe('saveHtmlReport', () => {
  const dir = path.join('/tmp', `lightcap-save-${process.pid}-${Date.now()}`);

  after(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it('writes the report into a validated directory and returns the path', () => {
    const p = saveHtmlReport(dir, '<html>report</html>');
    assert.ok(p, 'expected a saved path');
    assert.match(path.basename(p), /^lighthouse-\d+-[a-z0-9]+\.html$/);
    assert.equal(fs.readFileSync(p, 'utf8'), '<html>report</html>');
  });

  it('returns null when the html payload is missing', () => {
    assert.equal(saveHtmlReport(dir, null), null);
  });
});

// ─── createQueue ───────────────────────────────────────────────────

describe('createQueue', () => {
  it('serializes tasks: second starts only after first finishes', async () => {
    const q = createQueue(5);
    const order = [];
    let release;
    const gate = new Promise(r => { release = r; });

    const p1 = q.run(async () => { order.push('1-start'); await gate; order.push('1-end'); });
    const p2 = q.run(async () => { order.push('2-start'); });

    await new Promise(r => setImmediate(r));
    assert.deepEqual(order, ['1-start']);

    release();
    await Promise.all([p1, p2]);
    assert.deepEqual(order, ['1-start', '1-end', '2-start']);
  });

  it('rejects tasks beyond maxDepth with Audit queue full', async () => {
    const q = createQueue(2);
    let release;
    const gate = new Promise(r => { release = r; });

    const p1 = q.run(() => gate);
    const p2 = q.run(() => gate);
    await assert.rejects(q.run(() => gate), { message: /Audit queue full/ });

    release();
    await Promise.all([p1, p2]);
    assert.equal(await q.run(async () => 'ok'), 'ok');
  });

  it('keeps running after a task rejects', async () => {
    const q = createQueue(3);
    const p1 = q.run(() => Promise.reject(new Error('boom')));
    const p2 = q.run(async () => 'ok');

    await assert.rejects(p1, { message: 'boom' });
    assert.equal(await p2, 'ok');
  });
});

// ─── sanitizeError: chrome-launcher mapping ────────────────────────

describe('sanitizeError chrome-launcher failures', () => {
  const expected = 'Chrome not found — install Google Chrome or set CHROME_PATH';

  it('maps CHROME_PATH env errors', () => {
    const e = new Error('The CHROME_PATH environment variable must be set to a Chrome/Chromium executable.');
    assert.equal(sanitizeError(e), expected);
  });

  it('maps ERR_LAUNCHER_PATH_NOT_SET by code', () => {
    const e = Object.assign(new Error('launcher failed'), { code: 'ERR_LAUNCHER_PATH_NOT_SET' });
    assert.equal(sanitizeError(e), expected);
  });

  it('maps "No Chrome installations found"', () => {
    const e = new Error('No Chrome installations found.');
    assert.equal(sanitizeError(e), expected);
  });
});
