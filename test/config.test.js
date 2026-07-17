import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { CONFIG } from '../src/config.js';

describe('CONFIG', () => {
  it('has positive numeric limits', () => {
    assert.ok(CONFIG.MAX_ISSUES_DEFAULT > 0);
    assert.ok(CONFIG.MAX_ISSUES_A11Y_DEFAULT > 0);
    assert.ok(CONFIG.MAX_ISSUES_CAP > 0);
    assert.ok(CONFIG.MAX_ELEMENTS_PER_ISSUE > 0);
    assert.ok(CONFIG.SELECTOR_MAX_LENGTH > 0);
    assert.ok(CONFIG.EXPLANATION_MAX_LENGTH > 0);
    assert.ok(CONFIG.MAX_URL_LENGTH > 0);
    assert.ok(CONFIG.AUDIT_TIMEOUT > 0);
    assert.ok(CONFIG.NAV_TIMEOUT > 0);
    assert.ok(CONFIG.MAX_OUTPUT_LINES > 0);
    assert.ok(CONFIG.MAX_OUTPUT_CHARS > 0);
    assert.ok(CONFIG.MAX_QUEUE_DEPTH > 0);
  });

  it('MAX_ISSUES_CAP >= MAX_ISSUES_DEFAULT', () => {
    assert.ok(CONFIG.MAX_ISSUES_CAP >= CONFIG.MAX_ISSUES_DEFAULT);
    assert.ok(CONFIG.MAX_ISSUES_CAP >= CONFIG.MAX_ISSUES_A11Y_DEFAULT);
  });

  it('has non-empty default categories', () => {
    assert.ok(Array.isArray(CONFIG.DEFAULT_CATEGORIES));
    assert.ok(CONFIG.DEFAULT_CATEGORIES.length > 0);
  });

  it('has metric thresholds for expected metrics', () => {
    const expected = [
      'first-contentful-paint',
      'largest-contentful-paint',
      'total-blocking-time',
      'cumulative-layout-shift',
      'speed-index',
    ];
    for (const metric of expected) {
      assert.ok(metric in CONFIG.METRIC_THRESHOLDS, `Missing threshold for ${metric}`);
      assert.ok(typeof CONFIG.METRIC_THRESHOLDS[metric] === 'number');
    }
  });

  it('has blocked hostnames including 0.0.0.0 and [::]', () => {
    assert.ok(CONFIG.BLOCKED_HOSTNAMES.length > 0);
    assert.ok(CONFIG.BLOCKED_HOSTNAMES.includes('169.254.169.254'));
    assert.ok(CONFIG.BLOCKED_HOSTNAMES.includes('0.0.0.0'));
    assert.ok(CONFIG.BLOCKED_HOSTNAMES.includes('[::]'));
  });

  it('has well-formed blocked IP CIDR ranges', () => {
    assert.ok(Array.isArray(CONFIG.BLOCKED_IP_RANGES));
    assert.ok(CONFIG.BLOCKED_IP_RANGES.length > 0);
    for (const range of CONFIG.BLOCKED_IP_RANGES) {
      const [address, prefix, family] = range;
      assert.equal(typeof address, 'string');
      assert.ok(Number.isInteger(prefix) && prefix >= 1);
      assert.ok(family === 'ipv4' || family === 'ipv6');
      assert.ok(prefix <= (family === 'ipv4' ? 32 : 128));
    }
  });

  it('localhost allowlist contains only loopback hostnames', () => {
    assert.ok(CONFIG.LOCALHOST_HOSTS.includes('localhost'));
    assert.ok(CONFIG.LOCALHOST_HOSTS.includes('127.0.0.1'));
    assert.ok(CONFIG.LOCALHOST_HOSTS.includes('::1'));
    assert.ok(CONFIG.LOCALHOST_HOSTS.includes('[::1]'));
    // Unspecified addresses are blocked, not allowlisted
    assert.ok(!CONFIG.LOCALHOST_HOSTS.includes('0.0.0.0'));
    assert.ok(!CONFIG.LOCALHOST_HOSTS.includes('[::]'));
  });

  it('MAX_OUTPUT_CHARS is large enough but bounded', () => {
    assert.ok(CONFIG.MAX_OUTPUT_CHARS >= 10_000);
    assert.ok(CONFIG.MAX_OUTPUT_CHARS <= 100_000);
  });
});
