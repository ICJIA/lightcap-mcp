# Changelog

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
