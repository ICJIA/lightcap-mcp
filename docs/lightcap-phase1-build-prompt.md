# LightCap — Phase 1 Build Prompt

> **Feed this entire document to Claude Code to build Phase 1.**
> This is a self-contained build prompt. Do not reference external documents.
> **Reference implementation:** Clone https://github.com/ICJIA/viewcap-mcp and study its patterns. LightCap follows the same architecture, conventions, and security posture.

---

## What You Are Building

LightCap is a local MCP server for Claude Code that runs Google Lighthouse audits and returns compressed, actionable results optimized for Claude's context window. It communicates over stdio (no HTTP, no ports).

**The core problem:** A raw Lighthouse report is ~2MB / ~500K tokens — it would destroy Claude's context window. This server's primary job is compressing that into ~40-120 lines of structured plain text that Claude can read and act on immediately.

**This is an original implementation.** Lighthouse is used as a library dependency (Apache 2.0). No code from third-party Lighthouse wrapper packages is used.

---

## Project Setup

### Initialize

```bash
mkdir lightcap-mcp && cd lightcap-mcp
git init
npm init -y
```

### `package.json` — set to exactly this:

```json
{
  "name": "@icjia/lightcap",
  "version": "0.1.0",
  "description": "MCP Lighthouse audit server for Claude Code — compressed, actionable reports optimized for Claude's context window",
  "type": "module",
  "main": "src/server.js",
  "bin": {
    "lightcap": "src/server.js"
  },
  "scripts": {
    "start": "node src/server.js",
    "test": "node --test test/*.test.js"
  },
  "files": [
    "src/",
    "README.md"
  ],
  "engines": {
    "node": ">=18"
  },
  "keywords": ["mcp", "lighthouse", "accessibility", "audit", "claude", "wcag"],
  "license": "MIT",
  "repository": {
    "type": "git",
    "url": "git+https://github.com/ICJIA/lightcap-mcp.git"
  }
}
```

### Install dependencies:

```bash
npm install @modelcontextprotocol/server zod lighthouse chrome-launcher
```

**Match viewcap's dependency pattern:**
- `@modelcontextprotocol/server` — MCP server SDK (same version as viewcap)
- `zod` — schema validation for tool parameters (same as viewcap)
- `lighthouse` — Google Lighthouse library
- `chrome-launcher` — launches Chrome for Lighthouse (Lighthouse uses this internally, but we need it explicitly to control the lifecycle)

**Not needed (unlike viewcap):**
- No `puppeteer` — Lighthouse manages its own Chrome connection via DevTools Protocol
- No `sharp` — no image processing
- No `commander` — no CLI in Phase 1
- No `@cfworker/json-schema` — only needed if viewcap uses it for a specific purpose; check viewcap and include if needed

### Create `.gitignore`:

```
node_modules/
.DS_Store
```

### Create `CLAUDE.md`:

```markdown
# Tool preferences

- For Lighthouse audits (performance, accessibility, SEO), use the `lightcap` MCP server (run_audit, run_a11y, get_status).
- For all screenshots, use the `viewcap` MCP server.
- Use Chrome MCP for browser automation, DOM interaction, and navigation only.
```

### Create `LICENSE`:

MIT License, copyright `Illinois Criminal Justice Information Authority (ICJIA)`. Same text as viewcap's LICENSE.

### File structure:

```
lightcap-mcp/
├── package.json
├── .gitignore
├── CLAUDE.md
├── LICENSE
├── publish.sh
├── README.md
├── docs/
│   └── lightcap-design.md
├── src/
│   ├── server.js          # MCP server init + tool handlers
│   ├── runner.js           # Chrome launch + Lighthouse execution + URL validation
│   ├── compress.js         # Report → compressed text for Claude
│   └── config.js           # Constants + logging helper
└── test/
    ├── url-validation.test.js
    ├── compress.test.js
    └── config.test.js
```

### `publish.sh`:

Copy viewcap's `publish.sh` verbatim. Change only:
- `PACKAGE_NAME="@icjia/lightcap"`
- Log prefix: `[lightcap]` instead of `[viewcap]`
- Error message: `"Run this from the lightcap project root."`

Make executable: `chmod +x publish.sh`

---

## Conventions — Match viewcap Exactly

Study viewcap's source code and follow these patterns:

### MCP server setup
- Use `@modelcontextprotocol/server` with the same import pattern as viewcap's `server.js`
- Use `zod` schemas for tool parameter validation (same as viewcap)
- Match viewcap's error handling pattern: try/catch in handlers, return `{ content: [{ type: 'text', text: 'Error: ...' }] }` on error

### Logging
- Use viewcap's `log(level, msg)` helper pattern from `config.js`
- Support `--verbose` and `--quiet` flags (same as viewcap)
- All logging to stderr via `console.error()` — stdout is reserved for MCP stdio transport
- Log prefix: `[lightcap]` (not `[viewcap]`)

### URL validation
- Copy viewcap's `validateUrl()` function from `capture.js` — it is async, resolves IPs, checks blocked ranges, and uses generic error messages
- Copy viewcap's `isBlockedIp()` function and all RFC1918 private range checks
- Copy the post-navigation URL recheck pattern (not applicable for Lighthouse since we don't control navigation, but validate the URL before passing to Lighthouse)
- Generic error messages only: `"Blocked URL scheme"`, `"Blocked URL"` — never leak internal paths or IPs

### Directory validation
- Copy viewcap's `validateOutputDir()` function with symlink-aware `realpathSync` checks
- Same allowed roots: home directory and `/tmp` (with `/private/tmp` for macOS)
- Generic error: `"Output directory is outside allowed paths"`

### Test exports
- Export internal functions for testing via `_test` named export (same pattern as viewcap's `capture.js`):

```javascript
// At the bottom of runner.js
export const _test = { validateUrl, validateOutputDir };
```

### Test suite
- Use `node:test` and `node:assert/strict` (no test framework dependency — same as viewcap)
- Test file naming: `test/{feature}.test.js`
- Run via `npm test` → `node --test test/*.test.js`

---

## File Specifications

### `src/config.js`

Follow viewcap's config.js pattern — export constants and a `log()` helper:

```javascript
export const CONFIG = {
  MAX_ISSUES_DEFAULT: 5,        // Top N failed audits per category for run_audit
  MAX_ISSUES_A11Y_DEFAULT: 10,  // Top N for run_a11y
  MAX_ISSUES_CAP: 15,           // Hard cap — never return more per category
  MAX_ELEMENTS_PER_ISSUE: 5,    // Affected elements shown per issue, then "(and N more)"
  SELECTOR_MAX_LENGTH: 60,      // Truncate CSS selectors
  AUDIT_TIMEOUT: 60_000,        // 60s hard timeout on Lighthouse
  NAV_TIMEOUT: 30_000,          // 30s page load timeout
  DEFAULT_CATEGORIES: ['accessibility', 'performance', 'best-practices', 'seo'],
  DEFAULT_VIEWPORT: 'desktop',
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
  ],
  METRIC_THRESHOLDS: {
    'first-contentful-paint': 1800,
    'largest-contentful-paint': 2500,
    'total-blocking-time': 200,
    'cumulative-layout-shift': 0.1,
    'speed-index': 3400,
  },
  MAX_OUTPUT_LINES: 200,        // Truncate compressed output if it exceeds this
};

// Logging — same pattern as viewcap
let verbosity = 'normal';
if (process.argv.includes('--verbose')) verbosity = 'verbose';
if (process.argv.includes('--quiet')) verbosity = 'quiet';

export function log(level, msg) {
  if (verbosity === 'quiet' && level !== 'error') return;
  if (verbosity === 'normal' && level === 'debug') return;
  console.error(`[lightcap] ${msg}`);
}
```

---

### `src/runner.js`

Chrome launch, Lighthouse execution, URL validation, directory validation.

**Exports:**
- `runLighthouse(url, options)` — validates URL, runs Lighthouse, returns `{ lhr, htmlPath }`
- `validateUrl(url)` — async, with IP resolution (copied from viewcap)
- `validateOutputDir(dir)` — symlink-aware (copied from viewcap)
- `_test` — exports for unit testing

#### URL validation

**Copy from viewcap's `capture.js`:**
- `validateUrl()` — async function with scheme whitelist, hostname blocklist, IP resolution via `isBlockedIp()`, fail-closed DNS, generic error messages
- `isBlockedIp()` — RFC1918 range checks, link-local, metadata endpoints
- All supporting helper functions

Change only the log prefix from `[viewcap]` to `[lightcap]`.

#### Directory validation

**Copy from viewcap's `capture.js`:**
- `validateOutputDir()` — symlink-aware with `realpathSync`, home + `/tmp` + `/private/tmp` allowed roots

#### `runLighthouse(url, options)`

Parameters: `{ categories, viewport, directory }`

```javascript
import { launch } from 'chrome-launcher';
import lighthouse from 'lighthouse';

export async function runLighthouse(url, options = {}) {
  const validatedUrl = await validateUrl(url);

  const categories = options.categories || CONFIG.DEFAULT_CATEGORIES;
  const viewport = options.viewport || CONFIG.DEFAULT_VIEWPORT;

  const chrome = await launch({
    chromeFlags: [
      '--headless=new',
      '--disable-gpu',
      '--disable-dev-shm-usage',
      '--disable-extensions',
      '--disable-background-networking',
      '--no-first-run',
      // Platform-specific sandbox (same as viewcap)
      ...(process.platform === 'linux' ? ['--no-sandbox', '--disable-setuid-sandbox'] : []),
    ],
  });

  try {
    const startTime = Date.now();

    const flags = {
      port: chrome.port,
      output: options.directory ? ['json', 'html'] : ['json'],
      maxWaitForLoad: CONFIG.NAV_TIMEOUT,
    };

    const config = {
      extends: 'lighthouse:default',
      settings: {
        onlyCategories: categories,
        formFactor: viewport === 'mobile' ? 'mobile' : 'desktop',
        screenEmulation: viewport === 'mobile'
          ? { mobile: true, width: 375, height: 812, deviceScaleFactor: 2 }
          : { mobile: false, width: 1350, height: 940, deviceScaleFactor: 1 },
        // Desktop: throttling disabled for localhost accuracy.
        // Performance scores will differ from Lighthouse CLI defaults (which apply simulated throttling).
        throttling: viewport === 'mobile'
          ? undefined
          : { rttMs: 0, throughputKbps: 0, cpuSlowdownMultiplier: 1, requestLatencyMs: 0, downloadThroughputKbps: 0, uploadThroughputKbps: 0 },
      },
    };

    // Use AbortController-style timeout so the timer is cleared on success
    // (prevents the timer from holding the process open if Lighthouse finishes quickly).
    let timeoutId;
    const timeoutPromise = new Promise((_, reject) => {
      timeoutId = setTimeout(() => reject(new Error('Lighthouse audit timed out')), CONFIG.AUDIT_TIMEOUT);
    });

    const result = await Promise.race([
      lighthouse(validatedUrl, flags, config),
      timeoutPromise,
    ]).finally(() => clearTimeout(timeoutId));

    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
    log('info', `Audit completed in ${elapsed}s`);

    let htmlPath = null;
    if (options.directory) {
      const dir = validateOutputDir(options.directory);
      const filename = `lighthouse-${Date.now()}.html`;
      const filePath = path.join(dir, filename);
      fs.writeFileSync(filePath, result.report[1]);
      log('info', `HTML report saved: ${filePath}`);
      htmlPath = filePath;
    }

    return { lhr: result.lhr, htmlPath };
  } finally {
    await chrome.kill();
  }
}
```

**Important:** Lighthouse manages its own connection to Chrome via the DevTools Protocol port. No Puppeteer. No browser singleton. Each audit gets a fresh Chrome, which is what Lighthouse expects. Chrome is killed in the `finally` block — always.

---

### `src/compress.js`

**This is the most important file.** It transforms ~2MB of Lighthouse JSON into ~40-120 lines of structured plain text.

**LHR shape resilience:** The compression logic depends on specific paths in the Lighthouse Result object (`lhr.categories`, `audit.details.items`, `item.node.selector`, `debugData.impact`). These are not versioned APIs — they can change across Lighthouse major versions. Use optional chaining throughout and degrade gracefully (skip missing fields, don't crash). Log missing expected fields at `debug` level so shape changes are visible in verbose mode.

**Exports:**
- `compressFullReport(lhr, maxIssues)` — for `run_audit`
- `compressA11yReport(lhr, maxIssues, wcagOnly)` — for `run_a11y`
- `_test` — internal functions for testing

#### Why plain text, not JSON?

JSON wastes tokens on syntax (`{`, `}`, `"key":`, quotes). Plain text with visual separators is ~30% fewer tokens, easier for Claude to scan, and still structured enough for Claude to reason about and act on.

#### `compressFullReport(lhr, maxIssues)`

Build output in this exact format:

```
Lighthouse audit: {url}
Viewport: {formFactor}

═══ Scores ═══
  Performance:    {score} / 100
  Accessibility:  {score} / 100
  Best Practices: {score} / 100
  SEO:            {score} / 100

═══ {Category} (top {N} issues) ═══
  ✗ {audit-id}: {displayValue or title}
      → {selector}, {selector} (and {N} more)

═══ Metrics ═══
  First Contentful Paint:    {value} {✓|✗}
  Largest Contentful Paint:  {value} {✓|✗}
  Total Blocking Time:       {value} {✓|✗}
  Cumulative Layout Shift:   {value} {✓|✗}
  Speed Index:               {value} {✓|✗}
```

Steps:

1. **Scores:** `Math.round(lhr.categories[catId].score * 100)`. Skip categories not in results.

2. **Failed audits per category:**
   - Get refs from `lhr.categories[catId].auditRefs`
   - Get audit data from `lhr.audits[ref.id]`
   - Filter: `score !== null && score !== 1`
   - Sort by score ascending (worst first)
   - Take top `Math.min(maxIssues, CONFIG.MAX_ISSUES_CAP)`

3. **Per failed audit:**
   - Use `audit.displayValue` if it exists (more specific, e.g. "4.2 s"), else `audit.title`
   - Elements: extract `item.node?.selector` from `audit.details?.items`
   - Truncate selectors to `CONFIG.SELECTOR_MAX_LENGTH`
   - Show up to `CONFIG.MAX_ELEMENTS_PER_ISSUE`, then `(and {N} more)`

4. **Metrics:** Extract from `lhr.audits[metricId].numericValue`. Format: ≥1000ms → `{x.x}s`, else `{x}ms`. CLS is dimensionless. Pass/fail via `CONFIG.METRIC_THRESHOLDS`.

5. **Skip empty categories** (0 failed audits → no section header).

6. **Truncate** if output exceeds `CONFIG.MAX_OUTPUT_LINES`. Add: `(output truncated — lower maxIssues for more detail per issue)`.

#### `compressA11yReport(lhr, maxIssues, wcagOnly)`

Build output in this format:

```
Accessibility audit: {url}
Viewport: {formFactor}
Score: {score} / 100

═══ Critical ({N} issues, {M} elements) ═══
  ✗ {audit-id} [WCAG {x.x.x}] — {title}
      → {selector}: {detail}
      → {selector} (×{count})

═══ Serious ({N} issues, {M} elements) ═══
  ...

═══ Moderate ═══
  ...

═══ Minor ═══
  ...

Summary: {total} issues | {total} affected elements
  Critical: {N} | Serious: {N} | Moderate: {N} | Minor: {N}
```

Steps:

1. **Score:** `Math.round(lhr.categories.accessibility.score * 100)`

2. **Failed audits:** Same filtering as `compressFullReport`, accessibility category only.

3. **Group by impact:**
   - Look for `audit.details?.items?.[0]?.node?.impact`
   - Or `audit.details?.debugData?.impact`
   - Default to `'moderate'` if not found — and `log('debug', ...)` when falling back, so shape changes in future Lighthouse versions are visible in verbose mode
   - Valid: `critical`, `serious`, `moderate`, `minor`
   - **Note:** These fields come from axe-core internals embedded in Lighthouse, not from Lighthouse's public API. Guard access defensively.

4. **WCAG filter** (`wcagOnly`):
   - Check `audit.details?.debugData?.tags` for entries matching `/^wcag/`
   - Skip audits with no WCAG tags

5. **WCAG criterion:** Extract from tags matching `/^wcag(\d+)(\d)(\d+)$/` → `{$1}.{$2}.{$3}`. Note: Lighthouse tags encode criteria without dots (e.g., `wcag111` for 1.1.1, `wcag251` for 2.5.1). The first capture group is greedy so `wcag2511` would be ambiguous — in practice Lighthouse uses 3-digit tags for single-digit criteria and 4-digit for two-digit sub-criteria (e.g., `wcag1412` = 1.4.12). Parse right-to-left: last digit = level 3, second-to-last = level 2, remainder = level 1.

6. **Elements:** Same extraction as `compressFullReport`, plus:
   - For color-contrast: extract ratio from `item.node?.explanation` if present
   - Count duplicate selectors, show as `(×{count})`

7. **Summary line** at bottom with totals.

8. **Cap** at `maxIssues` per impact group, sorted by element count descending.

---

### `src/server.js`

Entry point. MCP server init, tool registration, version tracking.

**Shebang:** `#!/usr/bin/env node`

**Follow viewcap's `server.js` patterns exactly for:**
- MCP server initialization
- Zod schema definitions for tool parameters
- Error handling in tool handlers
- Startup logging

#### Version tracking (loaded once on startup):

```javascript
import { readFileSync } from 'fs';
import { execSync } from 'child_process';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const serverVersion = pkg.version;

let lhVersion = 'unknown';
try {
  const lhPkg = JSON.parse(readFileSync(new URL('../node_modules/lighthouse/package.json', import.meta.url)));
  lhVersion = lhPkg.version;
} catch { /* ignore */ }

// Kick off the npm registry check at startup (non-blocking).
// By the time get_status is called, this will likely have resolved already.
import { exec } from 'child_process';

let _latestLhVersion = null;
const _latestLhPromise = new Promise((resolve) => {
  exec('npm view lighthouse version', { timeout: 5000 }, (err, stdout) => {
    _latestLhVersion = err ? 'unknown' : stdout.trim();
    resolve(_latestLhVersion);
  });
});

async function getLatestLhVersion() {
  if (_latestLhVersion) return _latestLhVersion;
  return _latestLhPromise;
}

log('info', `Server v${serverVersion} | Lighthouse v${lhVersion}`);
```

#### Three tools:

**`run_audit`**
- Description: `"Run a full Lighthouse audit on a web page. Returns compressed scores and top issues optimized for Claude's context window. Categories: performance, accessibility, best-practices, seo."`
- Zod schema: `{ url: z.string(), categories: z.array(z.enum([...])).optional(), maxIssues: z.number().min(1).max(15).optional(), viewport: z.enum(['desktop', 'mobile']).optional(), directory: z.string().optional() }`
- Handler: `runLighthouse()` → `compressFullReport()` → return text content

**`run_a11y`**
- Description: `"Run an accessibility-only Lighthouse audit. Faster than full audit (~5s vs ~20s). Returns issues grouped by impact (critical/serious/moderate/minor) with WCAG criteria and CSS selectors."`
- Zod schema: `{ url: z.string(), maxIssues: z.number().min(1).max(15).optional(), viewport: z.enum(['desktop', 'mobile']).optional(), wcagOnly: z.boolean().optional(), directory: z.string().optional() }`
- Handler: `runLighthouse({ categories: ['accessibility'] })` → `compressA11yReport()` → return text content

**`get_status`**
- Description: `"Returns lightcap server version, installed Lighthouse version, and whether a newer version is available on npm."`
- Zod schema: `{}` (no parameters)
- Handler: build and return status string:

```
lightcap status
  Server:     @icjia/lightcap v{serverVersion}
  Lighthouse: v{lhVersion} {(latest) | (latest: vX.Y.Z — update available)}
  Node:       v{process.versions.node}
  Platform:   {process.platform} {process.arch}
```

#### Error handling (same as viewcap):

```javascript
try {
  const result = await handler(params);
  return { content: [{ type: 'text', text: result }] };
} catch (err) {
  log('error', err.message);
  return { content: [{ type: 'text', text: `Error: ${err.message}` }] };
}
```

Errors return text content — they never crash the server.

---

## Tests

### `test/url-validation.test.js`

Copy viewcap's `test/url-validation.test.js` pattern. Import from `runner.js` instead of `capture.js`. Same test cases:
- Allows http localhost, 127.0.0.1, ::1, https external
- Blocks file://, data:, javascript:, ftp://
- Blocks AWS/GCP/Azure metadata endpoints
- Throws on invalid/empty URLs
- Error messages are generic (no internal details)

### `test/compress.test.js`

Test the compression functions with mock Lighthouse result objects:
- `compressFullReport` returns correct scores
- `compressFullReport` filters to failed audits only
- `compressFullReport` respects `maxIssues` cap
- `compressFullReport` truncates long selectors
- `compressA11yReport` groups by impact level
- `compressA11yReport` with `wcagOnly` filters to WCAG-tagged audits
- `compressA11yReport` includes summary line with correct counts
- Output never exceeds `MAX_OUTPUT_LINES`

### `test/config.test.js`

Sanity checks on config values (same pattern as viewcap):
- All numeric limits are positive
- Default categories array is not empty
- Metric thresholds exist for expected metrics

---

## What NOT To Do

- **No TypeScript.** Plain `.js` with ES modules.
- **No build step.** Source files ship as-is.
- **No extra dependencies** beyond the install list.
- **No HTTP server.** stdio only.
- **Never return raw Lighthouse JSON or HTML to Claude.** Always compress. HTML goes to disk only.
- **No `--allow-js` flag.** Unlike viewcap, no JS injection — Lighthouse controls the page.
- **No Puppeteer.** Lighthouse uses chrome-launcher directly.
- **Do not copy code from third-party Lighthouse wrappers.**
- **Do not exceed ~200 lines** in any tool response.
- **Error messages to Claude must be generic** — no internal paths, IPs, or stack traces. Details go to stderr only.
- **Follow viewcap's patterns** for everything not Lighthouse-specific (MCP setup, Zod schemas, logging, URL validation, directory validation, test structure, publish.sh).

---

## Testing Locally

### There is no build step

Plain JS. `node src/server.js` runs directly.

### Workflow

```bash
# 1. Register with Claude Code (once)
claude mcp add lightcap -s user -- node /absolute/path/to/lightcap-mcp/src/server.js

# 2. Restart Claude Code

# 3. Spin up a test target
npx serve -l 3000 .

# 4. Test from Claude Code:
#    "Use lightcap to run an accessibility audit on http://localhost:3000"
#    "What version of lightcap is running?"
#    "Audit file:///etc/passwd" (should fail)
```

### Run tests

```bash
npm test
```

---

## Done Criteria

Phase 1 is complete when:

- [ ] `npm install` succeeds
- [ ] Server starts via `node src/server.js` without errors
- [ ] `run_audit` returns compressed text with scores and top issues (~40 lines)
- [ ] `run_a11y` returns issues grouped by impact with WCAG refs and CSS selectors
- [ ] `run_a11y` with `wcagOnly: true` filters correctly
- [ ] `get_status` returns server version, Lighthouse version, update check
- [ ] Compressed output never exceeds ~200 lines
- [ ] Raw Lighthouse JSON/HTML is never returned to Claude
- [ ] `file://` and metadata URLs are rejected with generic error messages
- [ ] Directory parameter saves HTML report to disk
- [ ] Chrome is killed after every audit (`finally` block)
- [ ] 60s timeout on Lighthouse execution
- [ ] All tests pass (`npm test`)
- [ ] Registered and working in Claude Code via `claude mcp add`
- [ ] Audit → fix → re-audit loop works in a Claude Code session
- [ ] Error messages returned to Claude contain no internal paths or IPs
