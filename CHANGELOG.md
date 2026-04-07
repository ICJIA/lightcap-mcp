# Changelog

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
