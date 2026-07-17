import { CONFIG } from './config.js';
import { listFailedAudits } from './compress.js';

// Session-scoped audit history so re-audits can report what changed —
// the audit → fix → re-audit loop is the primary workflow.

const CATEGORY_SHORT = {
  'performance': 'Perf',
  'accessibility': 'A11y',
  'best-practices': 'BP',
  'seo': 'SEO',
};

export function summarizeRun(lhr) {
  const scores = {};
  const failed = {};
  for (const catId of CONFIG.DEFAULT_CATEGORIES) {
    const cat = lhr.categories?.[catId];
    if (!cat) continue;
    scores[catId] = cat.score == null ? null : Math.round(cat.score * 100);
    for (const audit of listFailedAudits(lhr, catId)) {
      failed[audit.id] = audit.details?.items?.length || 0;
    }
  }
  return { scores, failed };
}

function listWithCap(ids, cap = 3) {
  const shown = ids.slice(0, cap);
  const extra = ids.length - shown.length;
  return shown.join(', ') + (extra > 0 ? ` +${extra} more` : '');
}

export function diffLine(prev, curr) {
  if (!prev) return null;

  const parts = [];

  const scoreChanges = [];
  for (const [catId, currScore] of Object.entries(curr.scores)) {
    const prevScore = prev.scores[catId];
    if (prevScore == null || currScore == null) continue;
    if (prevScore !== currScore) {
      scoreChanges.push(`${CATEGORY_SHORT[catId] || catId} ${prevScore}→${currScore}`);
    }
  }
  if (scoreChanges.length > 0) parts.push(scoreChanges.join(', '));

  const fixed = Object.keys(prev.failed).filter(id => !(id in curr.failed)).sort();
  const appeared = Object.keys(curr.failed).filter(id => !(id in prev.failed)).sort();
  if (fixed.length > 0) parts.push(`fixed: ${listWithCap(fixed)}`);
  if (appeared.length > 0) parts.push(`new: ${listWithCap(appeared)}`);

  if (parts.length === 0) return 'Δ vs last run: no change';
  return `Δ vs last run: ${parts.join(' · ')}`;
}

export class RunHistory {
  constructor(maxEntries = 20) {
    this.maxEntries = maxEntries;
    this.entries = new Map();
  }

  get(key) {
    return this.entries.get(key) ?? null;
  }

  set(key, value) {
    // Delete-then-set refreshes Map insertion order for LRU eviction
    this.entries.delete(key);
    this.entries.set(key, value);
    while (this.entries.size > this.maxEntries) {
      this.entries.delete(this.entries.keys().next().value);
    }
  }
}
