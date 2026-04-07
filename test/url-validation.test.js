import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { _test } from '../src/runner.js';

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
});
