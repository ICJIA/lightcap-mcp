import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _test, sanitizeError } from '../src/runner.js';

const { validateUrl, isBlockedIp } = _test;

describe('validateUrl', () => {
  it('allows http localhost', async () => {
    const result = await validateUrl('http://localhost:3000');
    assert.equal(result, 'http://localhost:3000/');
  });

  it('allows http 127.0.0.1', async () => {
    const result = await validateUrl('http://127.0.0.1:8080');
    assert.equal(result, 'http://127.0.0.1:8080/');
  });

  it('allows https external URLs', async () => {
    const result = await validateUrl('https://example.com');
    assert.equal(result, 'https://example.com/');
  });

  it('blocks file:// scheme', async () => {
    await assert.rejects(
      () => validateUrl('file:///etc/passwd'),
      { message: 'Blocked URL scheme' }
    );
  });

  it('blocks data: scheme', async () => {
    await assert.rejects(
      () => validateUrl('data:text/html,<h1>test</h1>'),
      { message: 'Blocked URL scheme' }
    );
  });

  it('blocks javascript: scheme', async () => {
    await assert.rejects(
      () => validateUrl('javascript:alert(1)'),
      { message: 'Blocked URL scheme' }
    );
  });

  it('blocks ftp:// scheme', async () => {
    await assert.rejects(
      () => validateUrl('ftp://example.com'),
      { message: 'Blocked URL scheme' }
    );
  });

  it('blocks AWS metadata endpoint', async () => {
    await assert.rejects(
      () => validateUrl('http://169.254.169.254/latest/meta-data/'),
      { message: 'Blocked URL' }
    );
  });

  it('blocks GCP metadata endpoint', async () => {
    await assert.rejects(
      () => validateUrl('http://metadata.google.internal/'),
      { message: 'Blocked URL' }
    );
  });

  it('blocks Azure metadata endpoint', async () => {
    await assert.rejects(
      () => validateUrl('http://metadata.azure.com/'),
      { message: 'Blocked URL' }
    );
  });

  it('blocks 0.0.0.0', async () => {
    await assert.rejects(
      () => validateUrl('http://0.0.0.0:8080/'),
      { message: 'Blocked URL' }
    );
  });

  it('throws on invalid URL', async () => {
    await assert.rejects(
      () => validateUrl('not-a-url'),
      Error
    );
  });

  it('throws on empty string', async () => {
    await assert.rejects(
      () => validateUrl(''),
      Error
    );
  });

  it('error messages are generic (no internal details)', async () => {
    try {
      await validateUrl('file:///etc/shadow');
      assert.fail('Should have thrown');
    } catch (err) {
      assert.ok(!err.message.includes('/etc'));
      assert.ok(!err.message.includes('shadow'));
    }
  });
});

describe('isBlockedIp', () => {
  it('allows localhost', async () => {
    assert.equal(await isBlockedIp('localhost'), false);
  });

  it('allows 127.0.0.1', async () => {
    assert.equal(await isBlockedIp('127.0.0.1'), false);
  });

  it('allows ::1', async () => {
    assert.equal(await isBlockedIp('::1'), false);
  });

  it('allows 0.0.0.0 (in LOCALHOST_HOSTS)', async () => {
    assert.equal(await isBlockedIp('0.0.0.0'), false);
  });
});

describe('BLOCKED_IP_PREFIXES coverage', async () => {
  const { CONFIG } = await import('../src/config.js');
  const prefixes = CONFIG.BLOCKED_IP_PREFIXES;

  it('blocks full 127.x.x.x loopback range', () => {
    assert.ok(prefixes.includes('127.'));
  });

  it('blocks 0.x.x.x range', () => {
    assert.ok(prefixes.includes('0.'));
  });

  it('blocks :: (IPv6 unspecified/loopback)', () => {
    assert.ok(prefixes.includes('::'));
  });

  it('blocks all RFC1918 172.16-31.x ranges', () => {
    for (let i = 16; i <= 31; i++) {
      assert.ok(prefixes.includes(`172.${i}.`), `Missing 172.${i}.`);
    }
  });
});

describe('sanitizeError', () => {
  it('passes through known safe errors', () => {
    assert.equal(sanitizeError(new Error('Blocked URL scheme')), 'Blocked URL scheme');
    assert.equal(sanitizeError(new Error('Blocked URL')), 'Blocked URL');
    assert.equal(sanitizeError(new Error('Lighthouse audit timed out')), 'Lighthouse audit timed out');
  });

  it('maps connection errors to generic messages', () => {
    assert.equal(sanitizeError(new Error('connect ECONNREFUSED 127.0.0.1:3000')), 'Could not connect to URL');
    assert.equal(sanitizeError(new Error('net::ERR_CONNECTION_REFUSED')), 'Could not connect to URL');
  });

  it('maps timeout errors', () => {
    assert.equal(sanitizeError(new Error('ETIMEOUT on request')), 'Connection timed out');
  });

  it('maps DNS errors', () => {
    assert.equal(sanitizeError(new Error('net::ERR_NAME_NOT_RESOLVED')), 'Could not resolve hostname');
  });

  it('returns generic fallback for unknown errors', () => {
    assert.equal(sanitizeError(new Error('/Users/secret/path/to/file.js:42')), 'Audit failed');
  });

  it('never leaks filesystem paths', () => {
    const result = sanitizeError(new Error('ENOENT: /home/user/.config/chrome'));
    assert.ok(!result.includes('/home'));
    assert.ok(!result.includes('ENOENT'));
  });
});
