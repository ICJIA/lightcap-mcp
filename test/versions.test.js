import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { pkg, installedLighthouseVersion, parseNpmVersionOutput, statusText } from '../src/versions.js';

describe('pkg', () => {
  it('exposes the package version', () => {
    assert.match(pkg.version, /^\d+\.\d+\.\d+/);
  });
});

describe('installedLighthouseVersion', () => {
  it('resolves the real lighthouse version via Node module resolution', () => {
    // Must work in both dev checkouts and hoisted npx/flat installs —
    // a fixed '../node_modules/...' path only works in the former.
    const v = installedLighthouseVersion();
    assert.match(v, /^\d+\.\d+\.\d+/);
  });
});

describe('parseNpmVersionOutput', () => {
  it('accepts semver output', () => {
    assert.equal(parseNpmVersionOutput(null, '13.4.0\n'), '13.4.0');
  });

  it('returns unknown on error', () => {
    assert.equal(parseNpmVersionOutput(new Error('offline'), ''), 'unknown');
  });

  it('rejects non-semver output (npmrc injection guard)', () => {
    assert.equal(parseNpmVersionOutput(null, 'malicious text\n'), 'unknown');
  });
});

describe('statusText', () => {
  it('formats the status block with an update note', () => {
    const text = statusText({ serverVersion: '0.2.0', lhVersion: '13.4.0', latestLh: '13.5.0' });
    assert.ok(text.includes('@icjia/lightcap v0.2.0'));
    assert.ok(text.includes('Lighthouse: v13.4.0 (latest: v13.5.0 — update available)'));
    assert.ok(text.includes(`Node:       v${process.versions.node}`));
    assert.ok(text.includes(`Platform:   ${process.platform} ${process.arch}`));
  });

  it('shows (latest) when up to date or when the registry is unreachable', () => {
    const upToDate = statusText({ serverVersion: '0.2.0', lhVersion: '13.4.0', latestLh: '13.4.0' });
    assert.ok(upToDate.includes('v13.4.0 (latest)'));
    const unknown = statusText({ serverVersion: '0.2.0', lhVersion: '13.4.0', latestLh: 'unknown' });
    assert.ok(unknown.includes('v13.4.0 (latest)'));
  });
});
