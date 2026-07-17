import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { summarizeRun, diffLine, RunHistory } from '../src/diff.js';

function makeLhr({ a11yScore = 0.88, failedAudits = {} } = {}) {
  const audits = {};
  const auditRefs = [];
  for (const [id, elCount] of Object.entries(failedAudits)) {
    auditRefs.push({ id });
    audits[id] = {
      id,
      score: 0,
      title: id,
      details: { items: Array.from({ length: elCount }, (_, i) => ({ node: { selector: `div.el-${i}` } })) },
    };
  }
  return {
    finalDisplayedUrl: 'http://localhost:3000',
    configSettings: { formFactor: 'desktop' },
    categories: {
      accessibility: { score: a11yScore, auditRefs },
    },
    audits,
  };
}

describe('summarizeRun', () => {
  it('captures rounded scores and failed audit ids with element counts', () => {
    const lhr = makeLhr({ a11yScore: 0.88, failedAudits: { 'image-alt': 12, 'color-contrast': 8 } });
    const summary = summarizeRun(lhr);
    assert.equal(summary.scores.accessibility, 88);
    assert.equal(summary.failed['image-alt'], 12);
    assert.equal(summary.failed['color-contrast'], 8);
  });

  it('records null for unscored categories', () => {
    const lhr = makeLhr({ a11yScore: null });
    const summary = summarizeRun(lhr);
    assert.equal(summary.scores.accessibility, null);
  });
});

describe('diffLine', () => {
  it('returns null when there is no previous run', () => {
    const curr = summarizeRun(makeLhr());
    assert.equal(diffLine(null, curr), null);
  });

  it('reports no change for identical runs', () => {
    const a = summarizeRun(makeLhr({ failedAudits: { 'image-alt': 12 } }));
    const b = summarizeRun(makeLhr({ failedAudits: { 'image-alt': 12 } }));
    assert.equal(diffLine(a, b), 'Δ vs last run: no change');
  });

  it('reports score deltas, fixed and new issues', () => {
    const prev = summarizeRun(makeLhr({ a11yScore: 0.88, failedAudits: { 'image-alt': 12, 'color-contrast': 8 } }));
    const curr = summarizeRun(makeLhr({ a11yScore: 0.95, failedAudits: { 'tabindex': 2 } }));
    const line = diffLine(prev, curr);
    assert.ok(line.startsWith('Δ vs last run:'), line);
    assert.ok(line.includes('A11y 88→95'), line);
    assert.ok(line.includes('fixed: color-contrast, image-alt'), line);
    assert.ok(line.includes('new: tabindex'), line);
  });

  it('caps long fixed/new lists at 3 with a remainder', () => {
    const prev = summarizeRun(makeLhr({
      failedAudits: { a: 1, b: 1, c: 1, d: 1, e: 1 },
    }));
    const curr = summarizeRun(makeLhr({ failedAudits: {} }));
    const line = diffLine(prev, curr);
    assert.ok(line.includes('fixed: a, b, c +2 more'), line);
  });

  it('skips score deltas when either side is unscored', () => {
    const prev = summarizeRun(makeLhr({ a11yScore: null, failedAudits: { a: 1 } }));
    const curr = summarizeRun(makeLhr({ a11yScore: 0.9, failedAudits: { a: 1 } }));
    const line = diffLine(prev, curr);
    assert.ok(!line.includes('→'), line);
  });
});

describe('RunHistory', () => {
  it('returns null for unknown keys', () => {
    const h = new RunHistory();
    assert.equal(h.get('nope'), null);
  });

  it('stores and retrieves summaries by key', () => {
    const h = new RunHistory();
    h.set('k', { scores: {}, failed: {} });
    assert.deepEqual(h.get('k'), { scores: {}, failed: {} });
  });

  it('evicts the oldest entries beyond the cap', () => {
    const h = new RunHistory(3);
    h.set('a', 1);
    h.set('b', 2);
    h.set('c', 3);
    h.set('d', 4);
    assert.equal(h.get('a'), null);
    assert.equal(h.get('d'), 4);
  });

  it('refreshes recency when a key is re-set', () => {
    const h = new RunHistory(2);
    h.set('a', 1);
    h.set('b', 2);
    h.set('a', 10);
    h.set('c', 3);
    assert.equal(h.get('b'), null, 'b should be evicted, not a');
    assert.equal(h.get('a'), 10);
  });
});
