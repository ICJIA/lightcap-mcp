import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { compressFullReport, compressA11yReport, _test } from '../src/compress.js';
import { CONFIG } from '../src/config.js';

const { truncateSelector, formatMetricValue, metricFailing, parseWcagCriterion, getWcagRef, estimateTokens } = _test;

// ─── Mock LHR factories ───────────────────────────────────────────

function makeLhr({ scores = {}, audits = {}, categories = null } = {}) {
  const defaultScores = {
    performance: 0.72,
    accessibility: 0.88,
    'best-practices': 0.95,
    seo: 0.91,
  };
  const mergedScores = { ...defaultScores, ...scores };

  const defaultCategories = {};
  for (const [catId, score] of Object.entries(mergedScores)) {
    defaultCategories[catId] = {
      score,
      auditRefs: Object.keys(audits)
        .filter(id => audits[id]._category === catId)
        .map(id => ({ id })),
    };
  }

  return {
    finalDisplayedUrl: 'http://localhost:3000',
    configSettings: { formFactor: 'desktop' },
    categories: categories || defaultCategories,
    audits,
  };
}

function makeAudit(id, { score = 0, title = `Audit ${id}`, displayValue = null, category = 'accessibility', impact = 'moderate', items = [], wcagTags = [] } = {}) {
  const audit = {
    id,
    score,
    title,
    _category: category,
    details: {
      items: items.map(sel => ({
        node: {
          selector: sel,
          impact,
        },
      })),
    },
  };

  if (displayValue) audit.displayValue = displayValue;

  if (wcagTags.length > 0 || impact) {
    audit.details.debugData = {
      impact,
      tags: wcagTags,
    };
  }

  return [id, audit];
}

// ─── truncateSelector ──────────────────────────────────────────────

describe('truncateSelector', () => {
  it('returns short selectors unchanged', () => {
    assert.equal(truncateSelector('div.foo'), 'div.foo');
  });

  it('truncates long selectors', () => {
    const long = 'a'.repeat(100);
    const result = truncateSelector(long);
    assert.equal(result.length, CONFIG.SELECTOR_MAX_LENGTH + 1); // +1 for ellipsis
    assert.ok(result.endsWith('…'));
  });

  it('returns null for null/undefined', () => {
    assert.equal(truncateSelector(null), null);
    assert.equal(truncateSelector(undefined), null);
  });
});

// ─── formatMetricValue ─────────────────────────────────────────────

describe('formatMetricValue', () => {
  it('formats CLS as decimal', () => {
    assert.equal(formatMetricValue('cumulative-layout-shift', 0.12), '0.12');
  });

  it('formats ms >= 1000 as seconds', () => {
    assert.equal(formatMetricValue('largest-contentful-paint', 4200), '4.2s');
  });

  it('formats ms < 1000 as milliseconds', () => {
    assert.equal(formatMetricValue('total-blocking-time', 210), '210ms');
  });
});

// ─── metricFailing ─────────────────────────────────────────────────

describe('metricFailing', () => {
  it('returns false for passing metric', () => {
    assert.equal(metricFailing('total-blocking-time', 100), false);
  });

  it('returns true for failing metric', () => {
    assert.equal(metricFailing('largest-contentful-paint', 5000), true);
  });

  it('returns false for unknown metric', () => {
    assert.equal(metricFailing('unknown-metric', 100), false);
  });
});

// ─── estimateTokens ────────────────────────────────────────────────

describe('estimateTokens', () => {
  it('estimates ~1 token per 4 chars', () => {
    assert.equal(estimateTokens('abcd'), 1);
    assert.equal(estimateTokens('abcde'), 2);
    assert.equal(estimateTokens('a'.repeat(100)), 25);
  });

  it('returns 0 for empty string', () => {
    assert.equal(estimateTokens(''), 0);
  });
});

// ─── parseWcagCriterion ────────────────────────────────────────────

describe('parseWcagCriterion', () => {
  it('parses 3-digit tag (wcag111 → 1.1.1)', () => {
    assert.equal(parseWcagCriterion('wcag111'), '1.1.1');
  });

  it('parses 4-digit tag (wcag1412 → 1.4.12)', () => {
    assert.equal(parseWcagCriterion('wcag1412'), '1.4.12');
  });

  it('parses wcag243 → 2.4.3', () => {
    assert.equal(parseWcagCriterion('wcag243'), '2.4.3');
  });

  it('returns null for non-wcag tags', () => {
    assert.equal(parseWcagCriterion('notawcag'), null);
  });

  it('returns null for too-short tags', () => {
    assert.equal(parseWcagCriterion('wcag12'), null);
  });
});

// ─── compressFullReport ────────────────────────────────────────────

describe('compressFullReport', () => {
  it('includes all scores in compact format', () => {
    const lhr = makeLhr();
    const output = compressFullReport(lhr);
    // New format: Perf:72 A11y:88 BP:95 SEO:91
    assert.ok(output.includes('Perf:72'));
    assert.ok(output.includes('A11y:88'));
    assert.ok(output.includes('BP:95'));
    assert.ok(output.includes('SEO:91'));
  });

  it('puts URL, viewport, and scores on one header line', () => {
    const lhr = makeLhr();
    const output = compressFullReport(lhr);
    const firstLine = output.split('\n')[0];
    assert.ok(firstLine.includes('http://localhost:3000'));
    assert.ok(firstLine.includes('desktop'));
    assert.ok(firstLine.includes('Perf:'));
  });

  it('only includes failed audits', () => {
    const audits = Object.fromEntries([
      makeAudit('passing-audit', { score: 1, category: 'accessibility' }),
      makeAudit('failing-audit', { score: 0.3, category: 'accessibility', title: 'Failing test' }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressFullReport(lhr);
    assert.ok(!output.includes('passing-audit'));
    assert.ok(output.includes('failing-audit'));
  });

  it('only shows failing metrics', () => {
    const lhr = makeLhr();
    // Add passing and failing metrics
    lhr.audits = {
      'largest-contentful-paint': { numericValue: 5000 }, // fails (threshold 2500)
      'total-blocking-time': { numericValue: 100 },       // passes (threshold 200)
    };
    const output = compressFullReport(lhr);
    assert.ok(output.includes('LCP='));
    assert.ok(!output.includes('TBT='));
  });

  it('respects maxIssues cap', () => {
    const audits = Object.fromEntries(
      Array.from({ length: 20 }, (_, i) =>
        makeAudit(`audit-${i}`, { score: 0.1 + i * 0.01, category: 'performance' })
      )
    );
    const lhr = makeLhr({ audits });
    const output = compressFullReport(lhr, 3);
    const perfMatches = output.match(/  ✗ audit-/g);
    assert.ok(perfMatches);
    assert.ok(perfMatches.length <= 3);
  });

  it('truncates long selectors in output', () => {
    const longSelector = 'div.' + 'a'.repeat(100);
    const audits = Object.fromEntries([
      makeAudit('long-sel', { score: 0.5, category: 'accessibility', items: [longSelector] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressFullReport(lhr);
    assert.ok(!output.includes(longSelector));
    assert.ok(output.includes('…'));
  });

  it('deduplicates selectors with count', () => {
    const audits = Object.fromEntries([
      makeAudit('dup-test', { score: 0.5, category: 'accessibility', items: ['img.card', 'img.card', 'img.card'] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressFullReport(lhr);
    assert.ok(output.includes('×3'));
    // Should NOT have three separate "img.card" entries
    const matches = output.match(/img\.card/g);
    assert.equal(matches.length, 1);
  });

  it('skips empty categories', () => {
    const lhr = makeLhr();
    const output = compressFullReport(lhr);
    assert.ok(!output.includes('── Perf'));
    assert.ok(!output.includes('── A11y'));
  });

  it('output does not exceed MAX_OUTPUT_LINES', () => {
    const audits = Object.fromEntries(
      Array.from({ length: 50 }, (_, i) =>
        makeAudit(`a-${i}`, {
          score: 0.01,
          category: 'accessibility',
          items: Array.from({ length: 10 }, (_, j) => `div.el-${i}-${j}`),
        })
      )
    );
    const lhr = makeLhr({ audits });
    const output = compressFullReport(lhr, 15);
    const lineCount = output.split('\n').length;
    assert.ok(lineCount <= CONFIG.MAX_OUTPUT_LINES + 2);
  });

  it('is more compact than before (scores on one line)', () => {
    const lhr = makeLhr();
    const output = compressFullReport(lhr);
    // With no failures, should be very compact — just the header line
    const lines = output.split('\n').filter(l => l.trim());
    assert.ok(lines.length <= 3, `Expected ≤3 non-empty lines for clean report, got ${lines.length}`);
  });
});

// ─── compressA11yReport ────────────────────────────────────────────

describe('compressA11yReport', () => {
  it('groups by impact level', () => {
    const audits = Object.fromEntries([
      makeAudit('critical-issue', { score: 0, impact: 'critical', items: ['img.hero'] }),
      makeAudit('serious-issue', { score: 0.2, impact: 'serious', items: ['a.link'] }),
      makeAudit('moderate-issue', { score: 0.4, impact: 'moderate', items: ['div.box'] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr);
    assert.ok(output.includes('Critical'));
    assert.ok(output.includes('Serious'));
    assert.ok(output.includes('Moderate'));
  });

  it('includes WCAG references', () => {
    const audits = Object.fromEntries([
      makeAudit('image-alt', {
        score: 0,
        impact: 'critical',
        items: ['img.hero'],
        wcagTags: ['wcag111', 'wcag2a'],
      }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr);
    assert.ok(output.includes('[1.1.1]'));
  });

  it('wcagOnly filters to WCAG-tagged audits', () => {
    const audits = Object.fromEntries([
      makeAudit('has-wcag', { score: 0, items: ['img'], wcagTags: ['wcag111'] }),
      makeAudit('no-wcag', { score: 0, items: ['div'], wcagTags: [] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr, 10, true);
    assert.ok(output.includes('has-wcag'));
    assert.ok(!output.includes('no-wcag'));
  });

  it('compact header includes score and impact counts', () => {
    const audits = Object.fromEntries([
      makeAudit('issue-1', { score: 0, impact: 'critical', items: ['a', 'b'] }),
      makeAudit('issue-2', { score: 0.1, impact: 'serious', items: ['c'] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr);
    const firstLine = output.split('\n')[0];
    // Header should contain score, total issues, and impact shorthand
    assert.ok(firstLine.includes('88/100'));
    assert.ok(firstLine.includes('2 issues'));
    assert.ok(firstLine.includes('1c'));  // 1 critical
    assert.ok(firstLine.includes('1s'));  // 1 serious
  });

  it('includes score in header', () => {
    const lhr = makeLhr({ scores: { accessibility: 0.76 } });
    const output = compressA11yReport(lhr);
    assert.ok(output.includes('76/100'));
  });

  it('counts duplicate selectors with ×', () => {
    const audits = Object.fromEntries([
      makeAudit('dup-sel', { score: 0, impact: 'critical', items: ['img.card', 'img.card', 'img.card'] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr);
    assert.ok(output.includes('×3'));
  });

  it('shows element counts per issue', () => {
    const audits = Object.fromEntries([
      makeAudit('multi-el', { score: 0, impact: 'critical', items: ['a', 'b', 'c'] }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr);
    assert.ok(output.includes('(3 el)'));
  });

  it('shows fewer elements for moderate/minor than critical/serious', () => {
    const items = Array.from({ length: 10 }, (_, i) => `div.el-${i}`);
    const audits = Object.fromEntries([
      makeAudit('crit', { score: 0, impact: 'critical', items }),
      makeAudit('mod', { score: 0.5, impact: 'moderate', items }),
    ]);
    const lhr = makeLhr({ audits });
    const output = compressA11yReport(lhr);
    // Critical section should show more → lines than moderate section
    const sections = output.split('──');
    const critSection = sections.find(s => s.includes('Critical')) || '';
    const modSection = sections.find(s => s.includes('Moderate')) || '';
    const critArrows = (critSection.match(/→/g) || []).length;
    const modArrows = (modSection.match(/→/g) || []).length;
    assert.ok(critArrows >= modArrows, `Critical (${critArrows} elements) should show >= Moderate (${modArrows} elements)`);
  });
});
