import { CONFIG, log } from './config.js';

// ─── Helpers ───────────────────────────────────────────────────────

function truncateSelector(selector) {
  if (!selector || typeof selector !== 'string') return null;
  return selector.length > CONFIG.SELECTOR_MAX_LENGTH
    ? selector.slice(0, CONFIG.SELECTOR_MAX_LENGTH) + '…'
    : selector;
}

function formatMetricValue(id, numericValue) {
  if (id === 'cumulative-layout-shift') {
    return numericValue.toFixed(2);
  }
  if (numericValue >= 1000) {
    return `${(numericValue / 1000).toFixed(1)}s`;
  }
  return `${Math.round(numericValue)}ms`;
}

function metricPassFail(id, numericValue) {
  const threshold = CONFIG.METRIC_THRESHOLDS[id];
  if (threshold == null) return '';
  return numericValue <= threshold ? ' ✓' : ' ✗';
}

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

  return failed.slice(0, Math.min(maxIssues, CONFIG.MAX_ISSUES_CAP));
}

function extractElements(audit) {
  const items = audit.details?.items;
  if (!Array.isArray(items)) return [];

  const selectors = [];
  for (const item of items) {
    const sel = item.node?.selector;
    if (sel) {
      selectors.push(truncateSelector(sel));
    }
  }
  return selectors;
}

function formatElementList(selectors) {
  if (selectors.length === 0) return '';

  const shown = selectors.slice(0, CONFIG.MAX_ELEMENTS_PER_ISSUE);
  const remaining = selectors.length - shown.length;

  let line = '      → ' + shown.join(', ');
  if (remaining > 0) {
    line += ` (and ${remaining} more)`;
  }
  return line;
}

// ─── Full Report Compression ───────────────────────────────────────

const CATEGORY_LABELS = {
  'performance': 'Performance',
  'accessibility': 'Accessibility',
  'best-practices': 'Best Practices',
  'seo': 'SEO',
};

const METRIC_LABELS = {
  'first-contentful-paint': 'First Contentful Paint',
  'largest-contentful-paint': 'Largest Contentful Paint',
  'total-blocking-time': 'Total Blocking Time',
  'cumulative-layout-shift': 'Cumulative Layout Shift',
  'speed-index': 'Speed Index',
};

export function compressFullReport(lhr, maxIssues = CONFIG.MAX_ISSUES_DEFAULT) {
  const lines = [];
  const url = lhr.finalDisplayedUrl || lhr.requestedUrl || lhr.finalUrl || 'unknown';
  const formFactor = lhr.configSettings?.formFactor || 'unknown';

  lines.push(`Lighthouse audit: ${url}`);
  lines.push(`Viewport: ${formFactor}`);
  lines.push('');

  // Scores
  lines.push('═══ Scores ═══');
  for (const catId of CONFIG.DEFAULT_CATEGORIES) {
    const cat = lhr.categories?.[catId];
    if (!cat) continue;
    const label = CATEGORY_LABELS[catId] || catId;
    const score = Math.round((cat.score ?? 0) * 100);
    lines.push(`  ${label.padEnd(16)} ${score} / 100`);
  }

  // Failed audits per category
  for (const catId of CONFIG.DEFAULT_CATEGORIES) {
    const failed = getFailedAudits(lhr, catId, maxIssues);
    if (failed.length === 0) continue;

    lines.push('');
    const label = CATEGORY_LABELS[catId] || catId;
    lines.push(`═══ ${label} (top ${failed.length} issues) ═══`);

    for (const audit of failed) {
      const display = audit.displayValue || audit.title;
      lines.push(`  ✗ ${audit.id}: ${display}`);

      const elements = extractElements(audit);
      const elLine = formatElementList(elements);
      if (elLine) lines.push(elLine);
    }
  }

  // Metrics
  const metricIds = Object.keys(METRIC_LABELS);
  const metricLines = [];
  for (const id of metricIds) {
    const audit = lhr.audits?.[id];
    if (!audit || audit.numericValue == null) continue;
    const label = METRIC_LABELS[id];
    const value = formatMetricValue(id, audit.numericValue);
    const pf = metricPassFail(id, audit.numericValue);
    metricLines.push(`  ${label.padEnd(28)} ${value}${pf}`);
  }

  if (metricLines.length > 0) {
    lines.push('');
    lines.push('═══ Metrics ═══');
    lines.push(...metricLines);
  }

  // Truncate if too long
  if (lines.length > CONFIG.MAX_OUTPUT_LINES) {
    const truncated = lines.slice(0, CONFIG.MAX_OUTPUT_LINES);
    truncated.push('(output truncated — lower maxIssues for more detail per issue)');
    return truncated.join('\n');
  }

  return lines.join('\n');
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

    // For color-contrast, capture the explanation
    if (!selectorDetails.has(sel) && item.node?.explanation) {
      selectorDetails.set(sel, item.node.explanation);
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
  const url = lhr.finalDisplayedUrl || lhr.requestedUrl || lhr.finalUrl || 'unknown';
  const formFactor = lhr.configSettings?.formFactor || 'unknown';

  const a11yCat = lhr.categories?.accessibility;
  const score = a11yCat ? Math.round((a11yCat.score ?? 0) * 100) : 'N/A';

  lines.push(`Accessibility audit: ${url}`);
  lines.push(`Viewport: ${formFactor}`);
  lines.push(`Score: ${score} / 100`);

  // Get all failed a11y audits
  let failed = getFailedAudits(lhr, 'accessibility', CONFIG.MAX_ISSUES_CAP);

  // WCAG filter
  if (wcagOnly) {
    failed = failed.filter(audit => getWcagTags(audit).length > 0);
  }

  // Group by impact
  const groups = { critical: [], serious: [], moderate: [], minor: [] };
  for (const audit of failed) {
    const impact = getImpact(audit);
    groups[impact].push(audit);
  }

  // Sort each group by element count descending, cap at maxIssues
  let totalIssues = 0;
  let totalElements = 0;
  const impactCounts = {};

  for (const impact of IMPACT_ORDER) {
    const audits = groups[impact];
    if (audits.length === 0) continue;

    // Sort by number of affected elements descending
    audits.sort((a, b) => {
      const aCount = a.details?.items?.length || 0;
      const bCount = b.details?.items?.length || 0;
      return bCount - aCount;
    });

    const capped = audits.slice(0, Math.min(maxIssues, CONFIG.MAX_ISSUES_CAP));

    let groupElements = 0;
    const issueLines = [];

    for (const audit of capped) {
      const wcagRef = getWcagRef(audit);
      const wcagStr = wcagRef ? ` [WCAG ${wcagRef}]` : '';

      issueLines.push(`  ✗ ${audit.id}${wcagStr} — ${audit.title}`);

      const elements = extractA11yElements(audit);
      groupElements += elements.length;

      const shown = elements.slice(0, CONFIG.MAX_ELEMENTS_PER_ISSUE);
      const remaining = elements.length - shown.length;

      for (const el of shown) {
        issueLines.push(`      → ${el}`);
      }
      if (remaining > 0) {
        issueLines.push(`      → (and ${remaining} more)`);
      }
    }

    lines.push('');
    lines.push(`═══ ${impact.charAt(0).toUpperCase() + impact.slice(1)} (${capped.length} issues, ${groupElements} elements) ═══`);
    lines.push(...issueLines);

    totalIssues += capped.length;
    totalElements += groupElements;
    impactCounts[impact] = capped.length;
  }

  // Summary
  lines.push('');
  lines.push(`Summary: ${totalIssues} issues | ${totalElements} affected elements`);
  const parts = IMPACT_ORDER.map(i => `${i.charAt(0).toUpperCase() + i.slice(1)}: ${impactCounts[i] || 0}`);
  lines.push(`  ${parts.join(' | ')}`);

  // Truncate if too long
  if (lines.length > CONFIG.MAX_OUTPUT_LINES) {
    const truncated = lines.slice(0, CONFIG.MAX_OUTPUT_LINES);
    truncated.push('(output truncated — lower maxIssues for more detail per issue)');
    return truncated.join('\n');
  }

  return lines.join('\n');
}

// ─── Test-only exports ─────────────────────────────────────────────

export const _test = {
  truncateSelector,
  formatMetricValue,
  metricPassFail,
  getFailedAudits,
  extractElements,
  getImpact,
  getWcagTags,
  parseWcagCriterion,
  getWcagRef,
};
