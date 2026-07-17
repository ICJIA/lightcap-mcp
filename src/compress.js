import { CONFIG, log } from './config.js';

// ─── Sanitization ─────────────────────────────────────────────────

// Strip control chars and newlines from page-controlled strings to prevent
// prompt injection via crafted selectors, titles, or explanations.
function sanitize(str) {
  if (!str || typeof str !== 'string') return '';
  // Remove control characters (C0/C1), newlines, and zero-width chars
  return str.replace(/[\x00-\x1f\x7f-\x9f\u200b-\u200f\u2028\u2029\ufeff]/g, '');
}

// ─── Helpers ───────────────────────────────────────────────────────

function capLength(str, max) {
  return str.length > max ? str.slice(0, max) + '…' : str;
}

function truncateSelector(selector) {
  if (!selector || typeof selector !== 'string') return null;
  const clean = sanitize(selector);
  if (!clean) return null;
  return capLength(clean, CONFIG.SELECTOR_MAX_LENGTH);
}

function truncateExplanation(explanation) {
  if (!explanation || typeof explanation !== 'string') return null;
  const clean = sanitize(explanation);
  return capLength(clean, CONFIG.EXPLANATION_MAX_LENGTH);
}

// Runtime errors (page failed to load, blocked, etc.) make scores
// meaningless — surface them instead of reporting silent zeros.
function runtimeErrorLines(lhr) {
  const lines = [];
  const re = lhr.runtimeError;
  if (re && (re.code || re.message)) {
    const code = sanitize(re.code || '');
    const msg = capLength(sanitize(re.message || ''), 200);
    lines.push(`⚠ Audit error${code ? ` (${code})` : ''}: ${msg} — results may be incomplete`);
  }
  if (Array.isArray(lhr.runWarnings)) {
    for (const warning of lhr.runWarnings.slice(0, 2)) {
      if (typeof warning === 'string' && warning) {
        lines.push(`⚠ ${capLength(sanitize(warning), 160)}`);
      }
    }
  }
  return lines;
}

function formatMetricValue(id, numericValue) {
  if (typeof numericValue !== 'number' || !isFinite(numericValue)) return '?';
  if (id === 'cumulative-layout-shift') {
    return numericValue.toFixed(2);
  }
  if (numericValue >= 1000) {
    return `${(numericValue / 1000).toFixed(1)}s`;
  }
  return `${Math.round(numericValue)}ms`;
}

function metricFailing(id, numericValue) {
  const threshold = CONFIG.METRIC_THRESHOLDS[id];
  if (threshold == null) return false;
  return numericValue > threshold;
}

// Returns ALL failed audits (worst first) when maxIssues is omitted;
// callers cap for display so headers can report true totals.
function getFailedAudits(lhr, categoryId, maxIssues) {
  const category = lhr.categories?.[categoryId];
  if (!category) return [];

  const refs = category.auditRefs || [];
  const failed = [];

  for (const ref of refs) {
    const audit = lhr.audits?.[ref.id];
    if (!audit) continue;
    if (audit.score === null || audit.score === 1) continue;
    failed.push(audit);
  }

  // Sort by score ascending (worst first)
  failed.sort((a, b) => (a.score ?? 0) - (b.score ?? 0));

  if (maxIssues == null) return failed;
  return failed.slice(0, Math.min(maxIssues, CONFIG.MAX_ISSUES_CAP));
}

// Perf/BP audits list resources by url rather than DOM node — label
// them by file basename (or hostname for root URLs).
function resourceLabel(url) {
  if (!url || typeof url !== 'string') return null;
  try {
    const parsed = new URL(url);
    const base = parsed.pathname.split('/').filter(Boolean).pop();
    return truncateSelector(base || parsed.hostname);
  } catch {
    return truncateSelector(url);
  }
}

function wasteDetail(item) {
  if (typeof item.wastedBytes === 'number' && item.wastedBytes >= 1024) {
    return `${Math.round(item.wastedBytes / 1024)}KB wasted`;
  }
  if (typeof item.wastedBytes === 'number' && item.wastedBytes > 0) {
    return `${Math.round(item.wastedBytes)}B wasted`;
  }
  if (typeof item.wastedMs === 'number' && item.wastedMs >= 1) {
    return `${Math.round(item.wastedMs)}ms`;
  }
  return null;
}

function extractElements(audit) {
  const items = audit.details?.items;
  if (!Array.isArray(items)) return [];

  // Deduplicate labels, count occurrences, keep first waste detail
  const labelCounts = new Map();
  const labelDetails = new Map();
  for (const item of items) {
    const label = truncateSelector(item.node?.selector) || resourceLabel(item.url);
    if (!label) continue;
    labelCounts.set(label, (labelCounts.get(label) || 0) + 1);
    if (!labelDetails.has(label)) {
      const detail = wasteDetail(item);
      if (detail) labelDetails.set(label, detail);
    }
  }

  const elements = [];
  for (const [label, count] of labelCounts) {
    let line = label;
    if (count > 1) line += ` (×${count})`;
    const detail = labelDetails.get(label);
    if (detail) line += ` (${detail})`;
    elements.push(line);
  }
  return elements;
}

function formatElementList(elements) {
  if (elements.length === 0) return '';

  const shown = elements.slice(0, CONFIG.MAX_ELEMENTS_PER_ISSUE);
  const remaining = elements.length - shown.length;

  let line = '    → ' + shown.join(', ');
  if (remaining > 0) {
    line += ` (+${remaining})`;
  }
  return line;
}

// Shorten verbose audit titles — use displayValue if available, else compact the title
function auditDisplay(audit) {
  const raw = audit.displayValue || audit.title || audit.id;
  const clean = sanitize(raw);
  return clean.length > 60 ? clean.slice(0, 57) + '...' : clean;
}

// Estimate tokens: ~4 chars per token for English text
function estimateTokens(text) {
  return Math.ceil(text.length / 4);
}

// ─── Full Report Compression ───────────────────────────────────────

const CATEGORY_SHORT = {
  'performance': 'Perf',
  'accessibility': 'A11y',
  'best-practices': 'BP',
  'seo': 'SEO',
};

const METRIC_SHORT = {
  'first-contentful-paint': 'FCP',
  'largest-contentful-paint': 'LCP',
  'total-blocking-time': 'TBT',
  'cumulative-layout-shift': 'CLS',
  'speed-index': 'SI',
};

export function compressFullReport(lhr, maxIssues = CONFIG.MAX_ISSUES_DEFAULT) {
  const lines = [];
  const url = sanitize(lhr.finalDisplayedUrl || lhr.requestedUrl || lhr.finalUrl || 'unknown');
  const formFactor = sanitize(lhr.configSettings?.formFactor || 'unknown');

  // Header: single line with all scores ('?' when Lighthouse could not score)
  const scoreParts = [];
  for (const catId of CONFIG.DEFAULT_CATEGORIES) {
    const cat = lhr.categories?.[catId];
    if (!cat) continue;
    const label = CATEGORY_SHORT[catId] || catId;
    const score = cat.score == null ? '?' : Math.round(cat.score * 100);
    scoreParts.push(`${label}:${score}`);
  }
  lines.push(`${url} [${formFactor}] ${scoreParts.join(' ')}`);
  lines.push(...runtimeErrorLines(lhr));

  // Failing metrics only — one compact line
  const failingMetrics = [];
  for (const [id, label] of Object.entries(METRIC_SHORT)) {
    const audit = lhr.audits?.[id];
    if (!audit || audit.numericValue == null) continue;
    if (metricFailing(id, audit.numericValue)) {
      failingMetrics.push(`${label}=${formatMetricValue(id, audit.numericValue)}`);
    }
  }
  if (failingMetrics.length > 0) {
    lines.push(`Failing metrics: ${failingMetrics.join(' ')}`);
  }

  // Failed audits per category — skip categories with no failures
  for (const catId of CONFIG.DEFAULT_CATEGORIES) {
    const failed = getFailedAudits(lhr, catId);
    if (failed.length === 0) continue;

    const shown = failed.slice(0, Math.min(maxIssues, CONFIG.MAX_ISSUES_CAP));
    const label = CATEGORY_SHORT[catId] || catId;
    const countNote = failed.length > shown.length
      ? `${failed.length} issues, showing ${shown.length}`
      : `${failed.length} issues`;
    lines.push('');
    lines.push(`── ${label} (${countNote}) ──`);

    for (const audit of shown) {
      lines.push(`  ✗ ${audit.id}: ${auditDisplay(audit)}`);

      const elements = extractElements(audit);
      const elLine = formatElementList(elements);
      if (elLine) lines.push(elLine);
    }
  }

  return truncateOutput(lines);
}

// ─── Output truncation (lines + chars) ─────────────────────────────

function truncateOutput(lines) {
  // Line-count truncation
  if (lines.length > CONFIG.MAX_OUTPUT_LINES) {
    lines = lines.slice(0, CONFIG.MAX_OUTPUT_LINES);
    lines.push('(truncated — lower maxIssues for more detail)');
  }

  // Char-budget truncation (defense against long individual lines)
  let result = lines.join('\n');
  if (result.length > CONFIG.MAX_OUTPUT_CHARS) {
    result = result.slice(0, CONFIG.MAX_OUTPUT_CHARS);
    result += '\n(truncated — output exceeded character budget)';
  }

  return result;
}

// ─── Accessibility Report Compression ──────────────────────────────

const IMPACT_ORDER = ['critical', 'serious', 'moderate', 'minor'];

function getImpact(audit) {
  // From axe-core internals — not part of Lighthouse public API.
  // Guard defensively; fall back to 'moderate' if shape changes.
  const fromItems = audit.details?.items?.[0]?.node?.impact;
  if (fromItems && IMPACT_ORDER.includes(fromItems)) return fromItems;

  const fromDebug = audit.details?.debugData?.impact;
  if (fromDebug && IMPACT_ORDER.includes(fromDebug)) return fromDebug;

  log('debug', `No impact level found for audit "${audit.id}", defaulting to moderate`);
  return 'moderate';
}

function getWcagTags(audit) {
  const tags = audit.details?.debugData?.tags;
  if (!Array.isArray(tags)) return [];
  return tags.filter(t => typeof t === 'string' && t.startsWith('wcag'));
}

function parseWcagCriterion(tag) {
  // Lighthouse encodes WCAG criteria without dots: wcag111 = 1.1.1, wcag1412 = 1.4.12
  // Parse right-to-left: last digit = level 3 (if single), second group = level 2, remainder = level 1
  // In practice: 3-digit = x.y.z, 4-digit = x.y.zz (e.g., wcag1412 = 1.4.12)
  const match = tag.match(/^wcag(\d+)$/);
  if (!match) return null;

  const digits = match[1];
  if (digits.length < 3) return null;

  // Level 1 = first digit, Level 2 = second digit, Level 3 = rest
  const level1 = digits[0];
  const level2 = digits[1];
  const level3 = digits.slice(2);

  return `${level1}.${level2}.${level3}`;
}

function getWcagRef(audit) {
  const tags = getWcagTags(audit);
  for (const tag of tags) {
    // Match criteria tags (e.g., wcag111) not level tags (e.g., wcag2a, wcag2aa)
    if (/^wcag\d{3,}$/.test(tag) && !/^wcag\d+a+$/.test(tag)) {
      const criterion = parseWcagCriterion(tag);
      if (criterion) return criterion;
    }
  }
  return null;
}

function extractA11yElements(audit) {
  const items = audit.details?.items;
  if (!Array.isArray(items)) return [];

  const selectorCounts = new Map();
  const selectorDetails = new Map();

  for (const item of items) {
    const sel = truncateSelector(item.node?.selector);
    if (!sel) continue;

    selectorCounts.set(sel, (selectorCounts.get(sel) || 0) + 1);

    // For color-contrast, capture the explanation (truncated)
    if (!selectorDetails.has(sel) && item.node?.explanation) {
      selectorDetails.set(sel, truncateExplanation(item.node.explanation));
    }
  }

  const elements = [];
  for (const [sel, count] of selectorCounts) {
    const detail = selectorDetails.get(sel);
    let line = sel;
    if (count > 1) line += ` (×${count})`;
    if (detail) line += `: ${detail}`;
    elements.push(line);
  }

  return elements;
}

export function compressA11yReport(lhr, maxIssues = CONFIG.MAX_ISSUES_A11Y_DEFAULT, wcagOnly = false) {
  const lines = [];
  const url = sanitize(lhr.finalDisplayedUrl || lhr.requestedUrl || lhr.finalUrl || 'unknown');
  const formFactor = sanitize(lhr.configSettings?.formFactor || 'unknown');

  const a11yCat = lhr.categories?.accessibility;
  const score = !a11yCat ? 'N/A'
    : (a11yCat.score == null ? '?' : Math.round(a11yCat.score * 100));

  // Get ALL failed a11y audits — capping happens per impact group below,
  // so a page with many failures never silently drops critical issues.
  let failed = getFailedAudits(lhr, 'accessibility');

  if (wcagOnly) {
    failed = failed.filter(audit => getWcagTags(audit).length > 0);
  }

  // Group by impact
  const groups = { critical: [], serious: [], moderate: [], minor: [] };
  for (const audit of failed) {
    const impact = getImpact(audit);
    groups[impact].push(audit);
  }

  // Count totals for header
  let totalIssues = 0;
  let totalElements = 0;
  const impactCounts = {};
  for (const impact of IMPACT_ORDER) {
    impactCounts[impact] = groups[impact].length;
    totalIssues += groups[impact].length;
  }

  // Compact header: url, score, and impact summary on one line
  const impactSummary = IMPACT_ORDER
    .filter(i => impactCounts[i] > 0)
    .map(i => `${impactCounts[i]}${i[0]}`) // e.g., "2c 3s 4m"
    .join(' ');
  lines.push(`A11y: ${url} [${formFactor}] ${score}/100 — ${totalIssues} issues (${impactSummary})`);
  lines.push(...runtimeErrorLines(lhr));

  // Detail per impact group — skip empty groups
  for (const impact of IMPACT_ORDER) {
    const audits = groups[impact];
    if (audits.length === 0) continue;

    // Sort by element count descending
    audits.sort((a, b) => {
      const aCount = a.details?.items?.length || 0;
      const bCount = b.details?.items?.length || 0;
      return bCount - aCount;
    });

    const capped = audits.slice(0, Math.min(maxIssues, CONFIG.MAX_ISSUES_CAP));
    const skipped = audits.length - capped.length;

    let groupElements = 0;
    const issueLines = [];

    for (const audit of capped) {
      const wcagRef = getWcagRef(audit);
      const wcagStr = wcagRef ? ` [${wcagRef}]` : '';

      const elements = extractA11yElements(audit);
      groupElements += elements.length;
      const elCount = elements.length > 0 ? ` (${elements.length} el)` : '';

      issueLines.push(`  ✗ ${audit.id}${wcagStr}${elCount}`);

      // Show affected elements — full detail for critical/serious, compact for moderate/minor
      const maxEls = (impact === 'critical' || impact === 'serious')
        ? CONFIG.MAX_ELEMENTS_PER_ISSUE
        : Math.min(3, CONFIG.MAX_ELEMENTS_PER_ISSUE);

      const shown = elements.slice(0, maxEls);
      const remaining = elements.length - shown.length;

      for (const el of shown) {
        issueLines.push(`    → ${el}`);
      }
      if (remaining > 0) {
        issueLines.push(`    → (+${remaining})`);
      }
    }

    totalElements += groupElements;

    const label = impact[0].toUpperCase() + impact.slice(1);
    const skippedNote = skipped > 0 ? ` +${skipped} more` : '';
    lines.push('');
    lines.push(`── ${label} (${capped.length} issues, ${groupElements} el)${skippedNote} ──`);
    lines.push(...issueLines);
  }

  return truncateOutput(lines);
}

// All failed audits for a category, worst first, uncapped — shared with
// the session diff so it sees the same failure set the reports do.
export function listFailedAudits(lhr, categoryId) {
  return getFailedAudits(lhr, categoryId);
}

// ─── Test-only exports ─────────────────────────────────────────────

export const _test = {
  sanitize,
  truncateSelector,
  truncateExplanation,
  formatMetricValue,
  metricFailing,
  getFailedAudits,
  extractElements,
  estimateTokens,
  getImpact,
  getWcagTags,
  parseWcagCriterion,
  getWcagRef,
};
