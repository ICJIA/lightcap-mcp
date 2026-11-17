import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, statSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { historyPath, historyKey, loadHistory, recordRun } from '../src/cli-history.js';

function lhr(a11yScore, failedIds = []) {
  const audits = {};
  const auditRefs = [];
  for (const id of failedIds) {
    auditRefs.push({ id });
    audits[id] = { id, score: 0, title: id, details: { items: [{ node: { selector: 'img' } }] } };
  }
  return { categories: { accessibility: { score: a11yScore, auditRefs } }, audits };
}

describe('historyPath', () => {
  it('honors LIGHTCAP_HISTORY', () => {
    assert.equal(historyPath({ LIGHTCAP_HISTORY: '/x/h.json' }), '/x/h.json');
  });
  it('uses XDG_CACHE_HOME when set', () => {
    assert.equal(historyPath({ XDG_CACHE_HOME: '/c' }), join('/c', 'lightcap', 'cli-history.json'));
  });
});

describe('historyKey', () => {
  it('matches the server key shape and sorts categories', () => {
    assert.equal(
      historyKey('audit', { url: 'http://a', viewport: 'mobile', categories: ['seo', 'performance'] }),
      'audit|http://a|mobile|performance,seo'
    );
  });
  it('defaults viewport and categories', () => {
    assert.equal(
      historyKey('audit', { url: 'http://a' }),
      'audit|http://a|desktop|accessibility,best-practices,performance,seo'
    );
  });
});

describe('recordRun', () => {
  let path;
  beforeEach(() => { path = join(mkdtempSync(join(tmpdir(), 'lc-hist-')), 'sub', 'h.json'); });

  it('returns null on the first run and a delta on the second', () => {
    const p = { url: 'http://localhost:3000', categories: ['accessibility'] };
    assert.equal(recordRun('a11y', p, lhr(0.8, ['image-alt', 'label']), path), null);
    const d = recordRun('a11y', p, lhr(0.95, ['label', 'link-name']), path);
    assert.equal(d, 'Δ vs last run: A11y 80→95 · fixed: image-alt · new: link-name');
  });

  it('keeps targets separate', () => {
    recordRun('a11y', { url: 'http://a' }, lhr(0.5), path);
    assert.equal(recordRun('a11y', { url: 'http://b' }, lhr(0.9), path), null);
  });

  it('writes the file owner-only', () => {
    recordRun('a11y', { url: 'http://a' }, lhr(0.5), path);
    assert.equal(statSync(path).mode & 0o777, 0o600);
  });

  it('survives a corrupt history file', () => {
    recordRun('a11y', { url: 'http://a' }, lhr(0.5), path);
    writeFileSync(path, '{not json');
    assert.equal(recordRun('a11y', { url: 'http://a' }, lhr(0.5), path), null);
    assert.ok(Array.isArray(JSON.parse(readFileSync(path, 'utf8'))));
  });

  it('caps stored targets (LRU)', () => {
    for (let i = 0; i < 25; i++) recordRun('a11y', { url: `http://h${i}` }, lhr(0.5), path);
    assert.equal(loadHistory(path).entries.size, 20);
  });
});
