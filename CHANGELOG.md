# Changelog

## 0.2.1 — 2026-08-14

### Changed

- **Lighthouse `^13.4.0` → `^13.4.1`** and refreshed the lockfile, so fresh
  installs (`npx -y @icjia/lightcap`) resolve the current Lighthouse patch
  instead of a stale cached resolution that `get_status` flags as outdated.

## 0.2.0 — 2026-07-17

### Bug fixes, security hardening, and re-audit diffs

**Bugs fixed:**
- `lightcap status` (CLI) reported `Lighthouse: vunknown` under npx/global installs: the v0.1.6 fix (resolve via `createRequire` instead of a fixed `../node_modules/...` path) was applied only in `server.js`; `cli.js` still used the broken path. **Fix:** version logic extracted to a shared `src/versions.js` used by both the MCP `get_status` tool and the CLI `status` subcommand.
- `engines` claimed Node `>=18`, but Lighthouse 13.4 requires Node `>=22.19` — users on Node 18/20 following the README got install warnings or runtime breakage. **Fix:** `engines` bumped to `>=22.19` (matches `.nvmrc`); README prerequisites updated.
- `run_a11y` silently dropped issues on issue-heavy pages: failed audits were pre-capped at 15 *before* impact grouping. Most failed a11y audits score exactly 0, so the kept 15 were arbitrary — **critical issues could be dropped while moderates survived** — and the header undercounted. With `wcagOnly`, non-WCAG audits could consume all 15 slots and hide every WCAG issue. **Fix:** all failed audits are grouped; `maxIssues` caps per impact group only (with `+N more` notes); `wcagOnly` filters before any capping; headers count true totals. The full report header is now honest too: `── Perf (12 issues, showing 5) ──` when capped.
- The concurrency guard was dead code: the serialization queue meant `inFlight` could never reach `MAX_CONCURRENT_AUDITS` (2), so "Audit queue full" could never fire — while queue depth was unbounded (N rapid calls piled up serially at up to 60s each, far past any MCP client timeout). **Fix:** real bounded queue (`MAX_QUEUE_DEPTH` 3 pending); excess requests rejected fast with `'Audit queue full'`. Execution remains one Chrome at a time.
- Page-load failures masqueraded as zero scores: `lhr.runtimeError`/`lhr.runWarnings` were never read, so a blocked or unloadable page reported `Perf:0 A11y:0 ...` and invited "fixes" for a page that never rendered. **Fix:** runtime errors surface under the header (`⚠ Audit error (CODE): message — results may be incomplete`, sanitized and length-capped), up to 2 run warnings shown, and unscored categories render as `?` instead of `0`.
- A missing Chrome binary — the most common first-run failure — returned the generic `'Audit failed'`. **Fix:** chrome-launcher failures (`ERR_LAUNCHER_PATH_NOT_SET`, `CHROME_PATH`, "No Chrome installations found") map to `'Chrome not found — install Google Chrome or set CHROME_PATH'`.

**Security hardening:**
- IP blocklist rewritten from string-prefix matching to CIDR checks via Node's built-in `net.BlockList`. String prefixes had real gaps: IPv6 unique-local is `fc00::/7`, but only literal `fd00:` was matched — `fd12:3456::1` sailed through; the `fe80::/10` tail (e.g. `febf::1`) likewise. CIDR ranges now cover RFC1918, loopback (v4+v6), `0.0.0.0/8`, link-local (v4+v6), `fc00::/7`, `::/128`, and newly **CGNAT `100.64.0.0/10`**. Unrecognizable resolved addresses fail closed.
- DNS resolution now checks **every** resolved address (`lookup {all: true}`) — a hostname with one public and one private record no longer passes on its first record.
- `validateOutputDir` prefix checks gained a path-separator guard: `/tmpfoo` and `/Users/name 2` (a real macOS Migration Assistant artifact) no longer satisfy `startsWith('/tmp')` / `startsWith(home)`.
- HTML reports are written with the `wx` flag plus a random filename suffix — a pre-planted symlink at the target path is refused rather than written through.
- `http://[::]` is now blocked, matching the existing `http://0.0.0.0` block (both mean the unspecified address); `0.0.0.0`/`[::]` removed from the localhost allowlist.

**Added:**
- **Re-audit diffs** (`src/diff.js`): auditing the same target again in the same session (same tool, viewport, categories) prepends `Δ vs last run: A11y 88→95 · fixed: color-contrast, image-alt · new: none` — score deltas, fixed issues, and new issues, capped at 3 ids per list. History is session-scoped, keyed per tool/URL/viewport/categories, LRU-capped at 20 targets. This closes the loop on the audit → fix → re-audit workflow.
- **Performance resource evidence:** perf/BP audits that list resources by URL (render-blocking-resources, unused-css-rules, …) previously showed no elements at all (only DOM `node.selector` was read). Element extraction now falls back to the resource URL (file basename, or hostname for root URLs) and appends per-item waste: `→ main.css (48KB wasted)`, `→ styles.css (300ms)`.

**Internals:**
- `src/versions.js` — shared version detection (`createRequire`-based), sanitized npm registry check, shared status block for server + CLI.
- `getFailedAudits()` returns all failures uncapped when no limit is passed; exported as `listFailedAudits()` for the diff module.

### Test improvements (148 tests, was 84)
- Behavioral SSRF tests against real addresses (RFC1918, CGNAT, `fd12::1`, `febf::1`, mapped IPv4, public-address allow cases)
- `validateOutputDir` behavioral tests: symlink escape, outside-root, sibling-name rejection, happy path (previously the only security-critical function with zero tests)
- Bounded queue: serialization order, depth-cap rejection, recovery after task failure
- Runtime error surfacing, `?` scores, capped-header honesty, a11y no-silent-drop (21-failure and wcagOnly-beyond-cap cases)
- Perf resource labels and waste details; chrome-not-found mapping
- `versions.js` (module-resolution version detection, npm output sanitization, status format) and `diff.js` (summaries, delta lines, LRU history)

---

## 0.1.7 — 2026-07-01

### Fix: server failed to start under `npx` (MCP SDK prerelease drift)

**Bug fixed:** `npx -y @icjia/lightcap` crashed on startup with `SyntaxError: The requested module '@modelcontextprotocol/server' does not provide an export named 'StdioServerTransport'`, surfacing in Claude Code as `Failed to reconnect to lightcap: -32000`. The dependency was pinned with a caret on a **prerelease** — `"@modelcontextprotocol/server": "^2.0.0-alpha.2"` — and the published tarball ships no lockfile, so every fresh `npx` install re-resolved that range to the newest matching prerelease. `2.0.0-alpha.3` relocated `StdioServerTransport` from the package root to the `@modelcontextprotocol/server/stdio` subpath and removed it from `.`, so `src/server.js`'s root import stopped resolving. Dev checkouts were unaffected because `package-lock.json` still pinned `alpha.2`. (Not a Lighthouse issue — Lighthouse 13.4.0 resolved correctly in both layouts.) **Fix:** pin the SDK to exactly `2.0.0-alpha.2` (drop the caret; never range a prerelease). Existing npx installs must clear the cache to pick this up: `rm -rf ~/.npm/_npx`.

---

## 0.1.6 — 2026-06-11

### Lighthouse version detection + dependency refresh

**Bugs fixed:**
- `get_status` reported `Lighthouse: vunknown` when installed via `npx`: the version was read from `new URL('../node_modules/lighthouse/package.json', import.meta.url)` — a fixed path relative to `src/` that only exists in a dev checkout. Under npx/npm **flat installs**, lighthouse is hoisted to a parent `node_modules` (e.g. `~/.npm/_npx/<hash>/node_modules/lighthouse`), so the read failed silently and the real version was hidden. **Fix:** resolve via `createRequire(import.meta.url).resolve('lighthouse/package.json')`, which follows Node's module resolution in both layouts. (Found in the field: this masked a cached lighthouse@13.1.0 running one minor behind — see below.)

**Dependencies:**
- lighthouse `^13.1.0` → `^13.4.0` (axe-core 4.11.2 → 4.12.1). Lighthouse 13.2 enabled additional axe accessibility audits in the default config (73 → 76 audits, including `presentation-role-conflict`), so 13.1-based runs could report a11y 100 on pages that current Chrome DevTools / PageSpeed Insights score below 100. Note for existing installs: `npx -y @icjia/lightcap` caches the dependency tree at first use — clear the npx cache (or pin `@icjia/lightcap@latest`) to pick up the new Lighthouse.

**Known audit-methodology caveat (documented, not a lightcap bug):** like any fresh-profile Lighthouse run, lightcap audits the page's first-visit state. Sites that auto-open a dialog on first visit (cookie banners, welcome/tour modals) render their main UI inert behind it, so axe never evaluates those elements. Audit such pages in their post-dismiss state as well (e.g. a Playwright + axe harness, or a browser session that has dismissed the dialog).

---

## 0.1.5 — 2026-04-07

### Error checking and boundary fixes

**Bugs fixed:**
- `inFlight` counter permanently stuck after `chrome-launcher` failure: if `launch()` threw, `inFlight` was incremented but never decremented (the `finally` block was inside the `try` that starts after `launch()`). After enough launch failures, all future audits would be rejected with "Audit queue full". **Fix:** Wrapped `launch()` in its own try/catch that decrements `inFlight` on failure.
- `result.report[1]` crash/corruption if Lighthouse returns unexpected report shape: when `directory` is set, the code assumed `result.report` was always an array. If Lighthouse returned a string instead, `report[1]` would be `undefined` and `fs.writeFileSync` would write the literal string `"undefined"` to disk. **Fix:** Guard with `Array.isArray` check, skip save and log error if HTML report unavailable.
- `'No valid categories specified'` error not in `KNOWN_ERRORS` allowlist: this error was being swallowed by `sanitizeError()` and returned as generic `'Audit failed'`, losing a useful message. **Fix:** Added to the `KNOWN_ERRORS` allowlist.

**Edge cases fixed:**
- `truncateSelector` returned empty string `''` for selectors made entirely of control characters (e.g., `'\x00\x01\x02'`): after sanitization the string was empty but passed the initial truthy check. This produced `→ ` with nothing after the arrow in output. **Fix:** Return `null` if sanitized result is empty.
- `formatMetricValue` produced `"NaN"` or `"Infinityms"` for non-finite metric values: if `audit.numericValue` was `NaN` or `Infinity`, the output was nonsensical. **Fix:** Guard with `typeof` + `isFinite()` check, return `'?'` for non-finite values.

**Sanitization gaps closed:**
- URL and formFactor in compressed output were not sanitized: `lhr.finalDisplayedUrl` is page-controlled (via redirect chains) and was used directly in the header line of both `compressFullReport` and `compressA11yReport`. **Fix:** Applied `sanitize()` to URL and formFactor in both report functions.

### Test improvements (84 tests, was 81)
- `formatMetricValue`: NaN and Infinity handling
- `truncateSelector`: all-control-char input returns null

---

## 0.1.4 — 2026-04-07

### Security audit fixes

Red/blue team adversarial audit identified and resolved the following:

**Critical**
- SSRF via HTTP redirects: Lighthouse follows redirects, but the redirect target was never validated. A `302` to `http://169.254.169.254/` would bypass all checks. **Fix:** Post-audit validation of `lhr.finalDisplayedUrl` against the same blocklist. Fail-closed if neither `finalDisplayedUrl` nor `finalUrl` exists.
- SSRF via DNS rebinding: hostname resolves to safe IP during pre-audit validation, then re-resolves to a blocked IP when Chrome actually navigates. **Fix:** Same post-audit URL recheck catches this.

**High**
- SSRF gaps: `0.0.0.0`, `127.0.0.2-255`, and `[::]` bypassed all checks. `0.0.0.0` was not blocked, `127.` prefix was missing (only `127.0.0.1` was in localhost allowlist), and `::` (IPv6 unspecified) was unblocked. **Fix:** Added `127.` prefix, `0.` prefix, `::` prefix to `BLOCKED_IP_PREFIXES`. Added `0.0.0.0` to `BLOCKED_HOSTNAMES`. Added `0.0.0.0` and `[::]` to `LOCALHOST_HOSTS`.
- IPv6-mapped IPv4 bypass: `::ffff:169.254.169.254` was not normalized before prefix checking. **Fix:** `isBlockedIp` now strips `::ffff:` prefix before checking.
- No concurrency control: each audit spawned a full Chrome process with no limit. 20 concurrent calls = 20 Chrome processes = OOM. **Fix:** Request serialization queue (`enqueue`) + `MAX_CONCURRENT_AUDITS` (2) counter. Excess requests rejected with `'Audit queue full'`.
- Prompt injection via page-controlled content: malicious pages could craft CSS selectors or ARIA labels containing adversarial text that gets injected into Claude's context. **Fix:** `sanitize()` strips all control characters (C0/C1), newlines, zero-width chars, and BOM from selectors, explanations, and audit titles before output.

**Medium**
- No URL length limit: Zod schema accepted arbitrary-length URL strings (memory pressure). **Fix:** `z.url().max(2048)` on both tools. `directory` parameter capped at `.max(500)`.
- Unbounded `node.explanation` field: color-contrast explanations had no length cap (could be kilobytes). **Fix:** `truncateExplanation()` caps at `EXPLANATION_MAX_LENGTH` (120 chars) with sanitization.
- `MAX_OUTPUT_LINES` counted lines only: a single line could be megabytes. **Fix:** Added `MAX_OUTPUT_CHARS` (50,000) as a second truncation guard in `truncateOutput()`.
- Error message leakage: Lighthouse/Chrome errors returned verbatim, potentially containing filesystem paths and internal details. **Fix:** `sanitizeError()` allowlists known safe messages, maps common error types to generic messages, and falls back to `'Audit failed'` for unknowns.
- Chrome zombie processes: if `chrome.kill()` failed, the process leaked. **Fix:** `killChrome()` catches kill failure and falls back to `process.kill(pid, 'SIGKILL')`.
- Categories not validated in runner.js: the MCP Zod schema validated categories, but `runLighthouse()` accepted any strings. CLI path also unvalidated. **Fix:** `runLighthouse()` now filters categories against `CONFIG.DEFAULT_CATEGORIES` and rejects if none remain.

**Low**
- `exec()` for npm version check: used shell interpretation unnecessarily. **Fix:** Changed to `execFile('npm', [...])` in both `server.js` and `cli.js`.
- npm version string unsanitized: malicious `.npmrc` could inject arbitrary text into `get_status` output. **Fix:** Version string validated against `/^\d+\.\d+\.\d+/` pattern; non-matching values replaced with `'unknown'`.
- `sanitizeError` accessed via `_test` export in production code (code smell). **Fix:** Promoted to a regular named export from `runner.js`.

### Test improvements (81 tests, was 57)
- Sanitization: control char stripping, newline removal, zero-width char removal, prompt injection via newlines
- Explanation truncation: length cap, sanitization, null handling
- SSRF coverage: 0.0.0.0 blocking, full 127.x loopback range, 0.x range, :: prefix, all 172.16-31.x ranges
- Error sanitization: known-safe passthrough, connection refused, timeout, DNS failure, path leakage prevention
- Config: new constants (EXPLANATION_MAX_LENGTH, MAX_URL_LENGTH, MAX_CONCURRENT_AUDITS, MAX_OUTPUT_CHARS)
- Char budget: output character count enforcement

### What passed audit (no changes needed)
- Directory validation: symlink-aware TOCTOU prevention already implemented correctly
- WCAG regex: no catastrophic backtracking, properly anchored
- clampInt: handles NaN, Infinity, negatives correctly
- Zod enum validation: categories properly constrained at MCP layer

---

## 0.1.3 — 2026-04-07

Version bump for npm publish with 2FA.

---

## 0.1.2 — 2026-04-07

### Aggressive compression overhaul

Redesigned the compression engine to minimize token usage while maximizing detail on failures. The principle: **zero tokens on passes, maximum detail on failures.**

**Full report (`compressFullReport`) changes:**
- Scores condensed to one line: `http://localhost:3000 [desktop] Perf:72 A11y:88 BP:95 SEO:91` — was 8 lines with padding and separators
- Passing metrics dropped entirely — only failing metrics shown, on one compact line: `Failing metrics: LCP=4.2s CLS=0.12`
- Metric labels shortened to standard abbreviations: FCP, LCP, TBT, CLS, SI (was full names like "Largest Contentful Paint")
- Category labels shortened: Perf, A11y, BP, SEO (was "Performance", "Accessibility", "Best Practices", "SEO")
- Decorative separators reduced: `──` instead of `═══...═══`
- Selectors deduplicated in element lists: `img.card (×3)` instead of listing `img.card` three times — saves tokens AND provides count information
- Long audit titles truncated to 60 chars; `displayValue` preferred over `title` when available
- Clean pages (no failures) produce 1-2 lines instead of 14+ lines

**Accessibility report (`compressA11yReport`) changes:**
- Header compressed to one line with score and impact shorthand: `A11y: http://localhost:3000 [desktop] 88/100 — 5 issues (2c 3s)` — was 3 separate lines plus a separate summary block
- Impact shorthand notation: `2c 3s 4m 1n` = 2 critical, 3 serious, 4 moderate, 1 minor
- Element counts shown per issue: `✗ image-alt [1.1.1] (12 el)` — immediate visibility of scope
- Tiered element detail: critical/serious issues show up to 5 affected elements, moderate/minor show up to 3 — preserves detail where it matters most
- Skipped issues noted in section header: `── Critical (5 issues, 23 el) +3 more ──`
- Redundant summary block removed — same information is now in the compact header
- WCAG refs shortened: `[1.1.1]` instead of `[WCAG 1.1.1]`

**Token impact estimates:**
- Clean page (no failures): ~30 tokens (was ~200) — **85% reduction**
- Page with 5 failures: ~400 tokens (was ~600) — **33% reduction**
- Heavy failure page (20+ issues): ~1,200 tokens (was ~1,800) — **33% reduction**
- Savings scale with number of passing audits/metrics — more passes = more savings

**New internal utilities:**
- `estimateTokens(text)` — rough token count (~4 chars/token) for future budget enforcement
- `auditDisplay(audit)` — prefers `displayValue` over `title`, truncates to 60 chars
- `metricFailing(id, value)` — boolean check replacing `metricPassFail()` (no more ✓/✗ strings)
- Element deduplication moved from a11y-only to shared `extractElements()` — benefits both reports

### Test improvements
- 57 tests (was 50)
- New tests: compact header format, failing-metrics-only, selector deduplication, element count display, tiered element detail for critical vs moderate, token estimation

---

## 0.1.1 — 2026-04-07

Version bump — 0.1.0 was previously claimed on npm registry.

---

## 0.1.0 — 2026-04-07

### Phase 1: Core audit + compression

**MCP Tools**
- `run_audit` tool: full Lighthouse audit across performance, accessibility, best-practices, SEO with compressed output optimized for Claude's context window (~40-120 lines from ~2MB raw JSON)
- `run_a11y` tool: accessibility-only audit (~5s vs ~20s) with issues grouped by axe-core impact level (critical/serious/moderate/minor), WCAG criteria references (e.g., 1.1.1, 1.4.3), CSS selectors for affected elements, and summary counts
- `get_status` tool: reports server version, installed Lighthouse version, latest available version on npm, Node version, and platform — the only way Claude can see version info (stderr is invisible to Claude)

**Compression engine** (`compress.js`)
- Transforms ~2MB Lighthouse JSON into ~40-120 lines of structured plain text
- Plain text output (not JSON) — ~30% fewer tokens, easier for Claude to scan
- Failed audits only — all passing audits skipped entirely
- Configurable top N issues per category (default 5/10, max 15)
- CSS selectors truncated to 60 characters with ellipsis
- Elements capped at 5 per issue with "(and N more)" remainder count
- Duplicate selectors collapsed with `(×N)` count notation
- Core web vitals with pass/fail indicators against standard thresholds
- Impact grouping for accessibility: critical, serious, moderate, minor (from axe-core internals with graceful fallback to 'moderate' if shape changes)
- WCAG criterion extraction from Lighthouse tags (wcag111 → 1.1.1, wcag1412 → 1.4.12)
- `wcagOnly` filter removes best-practice-only items for compliance-focused audits
- Hard cap at 200 output lines with truncation notice
- Raw Lighthouse JSON/HTML is never returned to Claude — HTML saved to disk only

**Lighthouse execution** (`runner.js`)
- Fresh Chrome per audit via `chrome-launcher` (killed in `finally` block — always)
- 60s hard timeout on Lighthouse execution with timer cleanup (clearTimeout in .finally() so timer doesn't hold process open)
- Desktop mode disables throttling for localhost accuracy (scores differ from Lighthouse CLI defaults intentionally)
- Mobile mode uses Lighthouse default mobile throttling (simulated slow 4G)
- Optional HTML report save to specified directory
- `lighthouse` v13 with `chrome-launcher` v1 — no Puppeteer needed

**Security** (`runner.js`)
- URL validation: scheme whitelist (http/https only), blocks file:/data:/javascript:/ftp: and all other schemes
- Metadata endpoint blocklist: AWS (169.254.169.254), GCP (metadata.google.internal), Azure (metadata.azure.com)
- Full RFC1918 private IP range blocking: 10.x, all 172.16-31.x ranges, 192.168.x, IPv6 link-local (fe80:), IPv6 unique-local (fd00:), IPv4 link-local (169.254.x)
- IP resolution via dns/promises.lookup() catches hex IPs, octal IPs, IPv6-mapped addresses, DNS wildcard services
- Fail-closed DNS: unresolvable hostnames are blocked (not allowed)
- Directory traversal prevention: symlink-aware validation with realpathSync, deepest existing ancestor checked before mkdir, output restricted to home directory and /tmp
- Generic error messages to Claude ("Blocked URL scheme", "Blocked URL") — no internal paths, IPs, or stack traces leaked
- External URL logging writes hostname only to stderr (no query params)

**CLI** (`cli.js`)
- `lightcap audit <url>` — full audit with options for categories, maxIssues, viewport, directory
- `lightcap a11y <url>` — accessibility audit with wcag-only filter option
- `lightcap status` — version and update info
- Falls back to MCP server mode when no subcommand given
- Input validation with clampInt bounds checking
- `--verbose` and `--quiet` flags for logging verbosity

**MCP server** (`server.js`)
- `@modelcontextprotocol/server` with `StdioServerTransport` (same pattern as viewcap)
- Zod v4 schemas for all tool parameters with min/max bounds enforcement
- Non-blocking npm registry check at startup (async exec, cached for session)
- Version tracking from package.json and node_modules/lighthouse/package.json
- Error handling: try/catch in all handlers, errors return text content (never crash the server)

### Infrastructure

- 50 automated tests using `node:test` and `node:assert/strict` (no test framework dependency)
  - URL validation: scheme whitelist, metadata endpoints, DNS fail-closed, generic error messages
  - Compression: score extraction, failed audit filtering, maxIssues cap, selector truncation, output line limit
  - A11y grouping: impact levels, WCAG tag filtering and parsing, summary counts, duplicate selector collapsing
  - Config: numeric limits, default categories, metric thresholds, blocked ranges
- ESM-safe `publish.sh` script: first-time detection, version bump (patch/minor/major), dry-run mode, npm publish with --access public, git tag + push
- MIT license (Illinois Criminal Justice Information Authority)
- `.nvmrc` pinned to Node 22.22.0
- Plain JavaScript with ES modules — no build step, no TypeScript
- ~500 lines of source code across 5 files
