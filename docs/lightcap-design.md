# LightCap — Design Document

> **Project name:** `lightcap`
> **npm package:** `@icjia/lightcap`
> **GitHub repo:** `https://github.com/ICJIA/lightcap-mcp`
> **Platforms:** macOS, Linux (Ubuntu)
> **Node:** >= 18

## Purpose

A lightweight local MCP server for Claude Code that runs Google Lighthouse audits and returns compressed, actionable results optimized for Claude's context window. The server's primary job is translating Lighthouse's massive reports (~2MB JSON) into structured summaries (~100 lines) that Claude can read and act on in the same session.

## Use Case

From Claude Code: *"Audit localhost:3000 for accessibility"* — this server runs Lighthouse, distills the results, and returns structured violations that Claude can immediately fix in your code.

**The workflow that matters:**

```
You: "Run an accessibility audit on localhost:3000"
Claude: [calls run_a11y] Found 23 issues (4 critical, 8 serious, 11 moderate)
Claude: "I see 4 critical issues. Let me fix them now."
Claude: [edits your source files]
You: "Run it again"
Claude: [calls run_a11y] Found 11 issues (0 critical, 3 serious, 8 moderate)
```

This loop — audit → fix → re-audit — is what makes an MCP server more valuable than the Lighthouse CLI.

---

## Reference & Clean-Room Disclaimer

This design is informed by Google Lighthouse's public documentation and output format. **This is an original implementation. No code from third-party Lighthouse wrapper packages is used.** Lighthouse itself is used as a library dependency (it is open source under the Apache 2.0 license).

---

## Context Window Impact

This is the central design constraint. Every tool response must be small enough that Claude retains room to reason and act.

| Response type | Estimated size | Tokens (~) | Comparable to |
|---------------|---------------|------------|---------------|
| Score summary (4 categories) | ~10 lines | ~150 | One short paragraph |
| Accessibility audit (top issues) | ~80-120 lines | ~1,500 | 2 viewcap tiles |
| Full audit (all categories, top issues) | ~150-200 lines | ~2,500 | 3 viewcap tiles |
| Detailed single issue with affected elements | ~20-30 lines | ~400 | Half a viewcap tile |
| Raw Lighthouse JSON (NEVER returned) | ~60,000 lines | ~500,000 | Would destroy context |

### Compression strategy

Lighthouse returns hundreds of audits. The server filters and compresses:

1. **Scores only:** 4 numbers (performance, accessibility, best practices, SEO) — always included
2. **Failed audits only:** skip all passing audits entirely
3. **Top N issues per category:** default 5, configurable up to 15
4. **Element references truncated:** CSS selectors only, no full DOM snippets — `div.hero > img` not a 40-line HTML excerpt
5. **Descriptions summarized:** one line per issue, not Lighthouse's multi-paragraph explanations
6. **Metrics condensed:** LCP, FID, CLS, TTFB as single-line values with pass/fail indicators

**What is never returned:** raw JSON, HTML reports, full audit trees, screenshot thumbnails, trace data, network request logs.

---

## Architecture

```
Claude Code
    ├── Chrome MCP ──► browser automation, DOM, navigation
    ├── @icjia/viewcap ──► screenshots
    └── @icjia/lightcap ──► Lighthouse audits (this project)
            │
            src/
            ├── server.js ........... MCP server init + tool handlers
            ├── runner.js ........... Lighthouse execution + browser management
            ├── compress.js ......... Report → compressed output for Claude
            └── config.js ........... Constants
```

| File | Lines (est.) | Role |
|------|-------------|------|
| `server.js` | ~130 | MCP init, 3 tool registrations, request routing |
| `runner.js` | ~100 | Launch Chrome, run Lighthouse, return raw report |
| `compress.js` | ~150 | Filter failed audits, truncate selectors, format output |
| `config.js` | ~20 | `MAX_ISSUES`, `DEFAULT_CATEGORIES`, timeouts |

**Total: ~420 lines.** Even leaner than viewcap.

### Why no `browser.js` singleton?

Unlike viewcap, Lighthouse manages its own Chrome instance internally. The `runner.js` launches Chrome via `chrome-launcher`, passes the port to Lighthouse, and Lighthouse handles the connection. We don't need a singleton — each audit gets a fresh browser, which is what Lighthouse expects.

---

## MCP Tools

### 1. `run_audit`

Full Lighthouse audit across selected categories.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | *(required)* | HTTP/HTTPS URL to audit |
| `categories` | string[] | `["accessibility", "performance", "best-practices", "seo"]` | Which categories to run |
| `maxIssues` | number | 5 | Top N failed audits per category (max 15) |
| `viewport` | string | `"desktop"` | `"desktop"` or `"mobile"` |
| `directory` | string | — | If set, saves full HTML report to disk |

**Returns:** Structured text content block with scores and top issues. If `directory` is set, also saves the full Lighthouse HTML report for manual review.

**Example response returned to Claude:**

```
Lighthouse audit: http://localhost:3000
Viewport: desktop

═══ Scores ═══
  Performance:    72 / 100
  Accessibility:  88 / 100
  Best Practices: 95 / 100
  SEO:            91 / 100

═══ Performance (top 5 issues) ═══
  ✗ largest-contentful-paint: 4.2s (target: ≤2.5s)
  ✗ unused-css-rules: 340KB removable across 3 stylesheets
  ✗ render-blocking-resources: 2 resources blocking first paint
  ✗ total-byte-weight: 2.8MB total (target: ≤1.6MB)
  ✗ dom-size: 1,847 elements (target: ≤1,500)

═══ Accessibility (top 5 issues) ═══
  ✗ image-alt: 12 images missing alt text
      → img.hero-image, img.card-thumb, img.logo (and 9 more)
  ✗ color-contrast: 8 elements with insufficient contrast
      → p.subtitle (3.2:1, needs 4.5:1), span.caption (2.8:1)
  ✗ heading-order: Heading levels skip from h2 to h4
      → section.content > h4
  ✗ link-name: 3 links with no accessible name
      → a.icon-link, a.social-fb, a.social-tw
  ✗ html-has-lang: <html> missing lang attribute

═══ SEO (top 5 issues) ═══
  ✗ meta-description: Missing meta description
  ✗ link-text: 4 links with generic text ("click here", "read more")

═══ Metrics ═══
  First Contentful Paint:    1.2s ✓
  Largest Contentful Paint:  4.2s ✗
  Total Blocking Time:       210ms ✓
  Cumulative Layout Shift:   0.12 ✗
  Speed Index:               2.8s ✓
```

That's ~40 lines. Claude can read it, understand every issue, and start fixing code immediately.

### 2. `run_a11y`

Accessibility-only audit. Faster than a full audit (~5s vs ~20s) and returns more detail on accessibility issues specifically.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | *(required)* | HTTP/HTTPS URL to audit |
| `maxIssues` | number | 10 | Top N failed audits (max 15) |
| `viewport` | string | `"desktop"` | `"desktop"` or `"mobile"` |
| `wcagOnly` | boolean | false | If true, only return issues with WCAG tags (filters out best-practice-only items) |
| `directory` | string | — | Save full HTML report to disk |

**Returns:** Structured text with accessibility score, issues grouped by impact level (critical/serious/moderate/minor), affected elements as CSS selectors, and WCAG criteria references.

**Example response:**

```
Accessibility audit: http://localhost:3000
Viewport: desktop
Score: 88 / 100

═══ Critical (2 issues, 15 elements) ═══
  ✗ image-alt [WCAG 1.1.1] — 12 images missing alt text
      → img.hero-image
      → img.card-thumb (×8)
      → img.logo
      → img.partner-logo (×2)
  ✗ color-contrast [WCAG 1.4.3] — 8 elements with insufficient contrast
      → p.subtitle: foreground #999 on #fff = 3.2:1 (needs 4.5:1)
      → span.caption: foreground #aaa on #f5f5f5 = 2.8:1 (needs 4.5:1)
      → a.nav-link: foreground #888 on #fff = 3.5:1 (needs 4.5:1)
      → (and 5 more)

═══ Serious (3 issues, 6 elements) ═══
  ✗ heading-order [WCAG 1.3.1] — Heading levels skip from h2 to h4
      → section.content > h4
  ✗ link-name [WCAG 2.4.4] — 3 links with no accessible name
      → a.icon-link, a.social-fb, a.social-tw
  ✗ html-has-lang [WCAG 3.1.1] — <html> missing lang attribute
      → html

═══ Moderate (4 issues, 11 elements) ═══
  ✗ list [WCAG 1.3.1] — List element missing parent <ul>/<ol>
      → li.breadcrumb-item (×3)
  ✗ tabindex [WCAG 2.4.3] — 2 elements with tabindex > 0
      → div.modal, input.search
  ✗ definition-list [WCAG 1.3.1] — <dl> with non-<dt>/<dd> children
      → dl.glossary
  ✗ duplicate-id-aria [WCAG 4.1.1] — Duplicate id used in ARIA: "nav-main"
      → nav#nav-main (×2)

Summary: 9 issues | 32 affected elements
  Critical: 2 | Serious: 3 | Moderate: 4 | Minor: 0
```

That's ~35 lines. Enough detail for Claude to fix every issue, with CSS selectors pointing to exact elements.

---

### 3. `get_status`

Returns server version, Lighthouse version, and whether a newer Lighthouse version is available on npm.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | — | — | No parameters needed |

**Returns:** Structured text content block with version info.

**Example response:**

```
lightcap status
  Server:     @icjia/lightcap v1.0.3
  Lighthouse: v12.2.1 (latest: v12.4.0 — update available)
  Node:       v20.11.0
  Platform:   darwin arm64
```

This is the only way Claude can see version info — `console.error()` goes to stderr which Claude never reads. The latest-version check hits the npm registry once (`npm view lighthouse version`) and is cached for the session.

**Implementation in `server.js`:**

```javascript
import { execSync } from 'child_process';
import { readFileSync } from 'fs';

// Read server version from package.json (once on startup)
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const serverVersion = pkg.version;

// Read installed Lighthouse version (once on startup)
const lhPkg = JSON.parse(readFileSync(new URL('../node_modules/lighthouse/package.json', import.meta.url)));
const lhVersion = lhPkg.version;

// Check latest Lighthouse on npm (cached per session)
let latestLhVersion = null;
async function getLatestLighthouseVersion() {
  if (latestLhVersion) return latestLhVersion;
  try {
    latestLhVersion = execSync('npm view lighthouse version', { encoding: 'utf8' }).trim();
  } catch {
    latestLhVersion = 'unknown';
  }
  return latestLhVersion;
}
```

**Context cost:** ~4 lines / ~60 tokens. Negligible.

> **Note:** Consider adding `get_status` to viewcap as well — same pattern, same benefit. The viewcap version would report server version, Puppeteer version, and sharp version.

---

## Why Not `compare_audits`?

The original thinking included a `compare_audits` tool. Dropped it because:

- Running two full Lighthouse audits back-to-back takes 40-60 seconds
- The comparison output doubles the context cost
- Claude can do the comparison itself if you run `run_audit` twice — it remembers the first result

If comparison becomes important later, it's a Phase 2 addition.

---

## Compression Logic (`compress.js`)

This file is the core of the server. It transforms a ~2MB Lighthouse JSON report into ~40 lines of structured text.

### `compressFullReport(lhr, maxIssues)`

Input: Lighthouse Result object (`lhr`)

Steps:
1. Extract category scores from `lhr.categories` — round to integers
2. For each category, get audits where `score !== 1` and `score !== null`
3. Sort failed audits by score ascending (worst first)
4. Take top `maxIssues` per category
5. For each failed audit:
   - Extract `id` and `title`
   - If `details.items` exists, extract element selectors from `node.selector` (truncate to 60 chars)
   - Cap element list at 5, show "(and N more)" for remainder
   - For numeric audits (LCP, CLS, etc.), include value and target threshold
6. Extract core web vitals from `lhr.audits` (FCP, LCP, TBT, CLS, SI)
7. Format as plain text (not JSON, not markdown — plain structured text is most context-efficient)

### `compressA11yReport(lhr, maxIssues, wcagOnly)`

Same input, accessibility-focused output:

1. Extract accessibility score
2. Get failed audits from `lhr.categories.accessibility`
3. If `wcagOnly`, filter to audits that have WCAG tags in `audit.details`
4. Group by impact level: critical, serious, moderate, minor (from axe-core metadata in Lighthouse).
   **Note:** Impact level comes from undocumented axe-core internals (`audit.details?.items?.[0]?.node?.impact` or `audit.details?.debugData?.impact`). This is not part of Lighthouse's public API — if the shape changes in a future version, fall back to `'moderate'` and log a warning to stderr.
5. For each issue:
   - Include audit id, WCAG criterion reference, title
   - List affected elements as CSS selectors
   - For `color-contrast`: include computed foreground/background colors and ratio
6. Summary line: total issues, total affected elements, count per impact level

### Why plain text, not JSON?

JSON wastes tokens on syntax (`{`, `}`, `"key":`, quotes). Plain structured text with visual separators (`═══`) is:
- ~30% fewer tokens than equivalent JSON
- Easier for Claude to scan and reference in its response
- Still parseable by Claude for structured reasoning

---

## Browser & Lighthouse Execution (`runner.js`)

### `runLighthouse(url, options)`

Steps:
1. Validate URL (same `validateUrl()` logic as viewcap — scheme whitelist, metadata blocklist)
2. Launch Chrome via `chrome-launcher`:

```javascript
import { launch } from 'chrome-launcher';

const chrome = await launch({
  chromeFlags: [
    '--headless=new',
    '--no-sandbox',
    '--disable-gpu',
    '--disable-dev-shm-usage',
  ],
});
```

3. Configure Lighthouse:

```javascript
const config = {
  extends: 'lighthouse:default',
  settings: {
    onlyCategories: options.categories,
    formFactor: options.viewport === 'mobile' ? 'mobile' : 'desktop',
    screenEmulation: options.viewport === 'mobile'
      ? { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 }
      : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1 },
    // Desktop: no throttling — optimized for localhost accuracy.
    // Scores will differ from Lighthouse CLI defaults (which apply simulated throttling).
    throttling: options.viewport === 'mobile'
      ? undefined  // Lighthouse default mobile throttling
      : { throughputKbps: 0, cpuSlowdownMultiplier: 1 },  // No throttling for desktop
    maxWaitForLoad: 30000,
  },
};
```

4. Run Lighthouse:

```javascript
import lighthouse from 'lighthouse';

const result = await lighthouse(url, {
  port: chrome.port,
  output: ['json', 'html'],  // JSON for compression, HTML for optional save
}, config);
```

5. Kill Chrome: `await chrome.kill()` — always, in a `finally` block.
6. Return the Lighthouse Result object (`result.lhr`) and optionally the HTML report.

### Timing expectations

| Audit type | Typical duration | Why |
|-----------|-----------------|-----|
| Accessibility only | 3-8 seconds | Skips performance traces |
| Full audit (4 categories) | 15-30 seconds | Performance requires network throttling + traces |

The server should log timing to stderr: `[lightcap] Audit completed in 12.3s`.

---

## Security

Same threat model as viewcap — local stdio server, no network listener.

### Mitigations

| Risk | Mitigation |
|------|-----------|
| SSRF via URL parameter | Same as viewcap: scheme whitelist (`http:`/`https:` only), metadata endpoint blocklist |
| Resource exhaustion | 60s hard timeout on Lighthouse execution; Chrome killed in `finally` block |
| Directory traversal | Same as viewcap: output paths validated against home dir / `/tmp` |
| Raw report exposure | Full Lighthouse JSON/HTML is never returned to Claude — only compressed summaries |
| No network listener | stdio transport only |

URL validation code is identical to viewcap's `validateUrl()`. If both packages are maintained, consider extracting to a shared `@icjia/mcp-utils` package later — but for now, copy the ~15 lines.

---

## Dependencies

```json
{
  "dependencies": {
    "@modelcontextprotocol/server": "^2.0.0-alpha.2",
    "lighthouse": "^12.0.0",
    "chrome-launcher": "^1.1.0"
  }
}
```

Three dependencies. No `puppeteer` — Lighthouse uses `chrome-launcher` directly, which finds the system Chrome or downloads Chromium. No `sharp` — no image processing needed. Leaner than viewcap.

Note: `lighthouse` is a large package (~50MB installed) but it's a one-time install cost. The runtime overhead is just Lighthouse + Chrome, same as running `npx lighthouse` from the CLI.

---

## Project Structure

```
lightcap/
├── package.json
├── .gitignore
├── publish.sh
├── README.md
└── src/
    ├── server.js          # MCP server init + tool handlers
    ├── runner.js           # Chrome launch + Lighthouse execution
    ├── compress.js         # Report → compressed text for Claude
    └── config.js           # Constants
```

No build step. Plain JS with ES modules. Same pattern as viewcap.

---

## Distribution & Configuration

### Claude Code Registration

```bash
# User-level
claude mcp add lightcap -s user -- npx -y @icjia/lightcap

# Local development
claude mcp add lightcap -s user -- node /absolute/path/to/lightcap/src/server.js
```

### Using alongside viewcap and Chrome MCP

Add to your project's `CLAUDE.md`:

```markdown
# Tool preferences
- For all screenshots, use the `viewcap` MCP server.
- For Lighthouse audits (performance, accessibility, SEO), use the `lightcap` MCP server.
- For version info on MCP tools, use the relevant server's `get_status` tool.
- Use Chrome MCP for browser automation, DOM interaction, and navigation only.
```

### Publishing

Same `publish.sh` pattern as viewcap.

---

## Testing Locally

### There is no build step

Same as viewcap — plain JS, `node src/server.js` runs directly.

### Local development workflow

```
Register: claude mcp add lightcap -s user -- node /path/to/lightcap/src/server.js
Start test server: npx serve -l 3000 .
Restart Claude Code
Test: "Run an accessibility audit on http://localhost:3000"
```

### Test cases

1. **"Run an accessibility audit on http://localhost:3000"** — should return a11y score + issues in ~5s
2. **"Audit localhost:3000 for performance and SEO"** — should return selected categories only
3. **"Audit file:///etc/passwd"** — should return blocked scheme error
4. **"Audit localhost:3000 and save the full report to ~/reports"** — should save HTML report to disk and return compressed summary
5. **"What version of lightcap is running?"** — Claude calls `get_status`, returns server version, Lighthouse version, and whether an update is available
6. **Re-audit after fixes** — run audit, have Claude fix issues, run again, verify score improves

---

## Build Phases

### Phase 1 — Core audit (~3 hours)

- `config.js` + `runner.js` + `compress.js` + `server.js`
- `run_audit` tool working end-to-end
- `run_a11y` tool with impact grouping and WCAG references
- `get_status` tool with current + latest Lighthouse version check
- URL validation (SSRF prevention)
- Compression producing ~40-line summaries from full reports
- Test from Claude Code: audit → see results → Claude fixes code

**Testable deliverable:** "Audit localhost:3000 for accessibility" returns a compressed, actionable summary. "What version of lightcap is running?" returns server and Lighthouse versions.

### Phase 2 — Polish (~1 hour)

- Directory save mode (full HTML report to disk)
- `publish.sh`
- README with install/config/usage
- npm publish as `@icjia/lightcap`

**Testable deliverable:** `npx -y @icjia/lightcap` works in Claude Code config.

---

## Design Decisions

| Decision | Rationale |
|----------|-----------|
| Compression is the core feature | Raw Lighthouse reports would destroy Claude's context window; the server's job is translation |
| Plain text output, not JSON | ~30% fewer tokens; easier for Claude to scan; still structured enough to act on |
| Three tools: `run_audit`, `run_a11y`, `get_status` | `get_status` is how Claude sees version info (stderr is invisible to Claude); dropped `compare_audits` since Claude can diff sequential results itself |
| Accessibility-only mode | Fastest audit type (3-8s vs 15-30s); highest urgency given ADA deadline |
| `chrome-launcher`, not Puppeteer | Lighthouse expects to manage its own Chrome connection; Puppeteer would be redundant |
| Fresh Chrome per audit | Lighthouse works best with a clean browser; no singleton needed |
| CSS selectors only for elements | Full DOM snippets would bloat output; selectors are enough for Claude to find and fix elements |
| Max 15 issues per category | Hard cap prevents context bloat on very broken pages |
| HTML report to disk only | Full report available for human review but never sent to Claude |
| Same URL validation as viewcap | Consistent security posture across ICJIA MCP tools |
| No `--allow-js` flag | Unlike viewcap, no JS injection feature — Lighthouse controls the page |

---

## ICJIA-Specific Usage

### ADA Title II compliance (April 24, 2026 deadline)

The audit → fix → re-audit loop is the primary workflow:

```
You: "Run a11y audit on localhost:3000"
You: "Fix all critical and serious issues"
You: "Run it again — did the score improve?"
```

For the ~1,860 pages flagged by SiteImprove with "All roles are invalid" (sia-r110), the `wcagOnly` flag filters to WCAG-mapped issues only, skipping Lighthouse's best-practice recommendations that aren't compliance-relevant.

### Multi-site sweeps

For your 15+ web properties, you could script a sweep:

```
You: "Audit these URLs and give me a scorecard:
  - icjia.illinois.gov
  - researchhub.icjia.dev
  - accessibility.icjia.app
  ..."
```

Claude would call `run_audit` sequentially and compile a summary table. Context impact: ~40 lines per site × 15 sites = ~600 lines total. Fits comfortably.

### Pre-deploy checks

Add to your `CLAUDE.md`:

```markdown
# Deploy checklist
Before any deploy to production, run `lightcap run_a11y` against localhost
and verify 0 critical issues and accessibility score >= 90.
```

---

## Resolved Questions

1. **Package name:** `lightcap`. Repo: `ICJIA/lightcap-mcp` (matches `ICJIA/viewcap-mcp` pattern). npm: `@icjia/lightcap`.

2. **Shared URL validation:** Copy-paste the ~15 lines from viewcap. Extract to `@icjia/mcp-utils` only if/when a third server needs it.

3. **Lighthouse version pinning:** Pin to `^12.0.0`. The `get_status` tool reports the installed version and checks npm for the latest, so version drift is visible without any manual checking.
