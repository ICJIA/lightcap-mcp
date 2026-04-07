# @icjia/lightcap

A lightweight local MCP server that runs Google Lighthouse audits and returns compressed, actionable results optimized for Claude's context window.

## Why?

A raw Lighthouse report is ~2MB / ~500K tokens — it would destroy Claude's context window. LightCap compresses that into ~40-120 lines of structured plain text that Claude can read and act on immediately.

The workflow that matters:

```
You: "Run an accessibility audit on localhost:3000"
Claude: [calls run_a11y] Found 23 issues (4 critical, 8 serious, 11 moderate)
Claude: "I see 4 critical issues. Let me fix them now."
Claude: [edits your source files]
You: "Run it again"
Claude: [calls run_a11y] Found 11 issues (0 critical, 3 serious, 8 moderate)
```

This audit → fix → re-audit loop is what makes an MCP server more valuable than the Lighthouse CLI.

## What it does

- Runs full Lighthouse audits across performance, accessibility, best practices, and SEO
- Runs fast accessibility-only audits (~5s vs ~20s for a full audit)
- Compresses ~2MB Lighthouse JSON reports into ~40-120 lines of structured plain text
- Groups accessibility issues by impact level: critical, serious, moderate, minor
- Includes WCAG criteria references (e.g., WCAG 1.1.1, 1.4.3) and CSS selectors for each issue
- Filters to WCAG-only issues for compliance-focused audits (skips best-practice-only items)
- Reports core web vitals (FCP, LCP, TBT, CLS, Speed Index) with pass/fail indicators
- Optionally saves full HTML reports to disk for manual human review
- Reports server and Lighthouse version info with npm update availability
- Standalone CLI for use outside of MCP clients (`lightcap audit`, `lightcap a11y`, `lightcap status`)
- Runs as a local MCP server over stdio (no HTTP, no ports, no remote attack surface)

## Installation

### Prerequisites

- **Node.js >= 18** (check with `node --version`)
- **Google Chrome** or **Chromium** installed on your system
- **Claude Code**, **Cursor**, or any MCP-compatible client (for MCP mode)

### Option 1: npx (recommended, no install needed)

npx downloads and runs the package automatically. Nothing to install globally.

```bash
# Test that it works
npx -y @icjia/lightcap --help
```

### Option 2: Global install

```bash
npm install -g @icjia/lightcap
```

### Option 3: Clone for development

```bash
git clone https://github.com/ICJIA/lightcap-mcp.git
cd lightcap-mcp
npm install
```

## Setup with Claude Code

Claude Code manages MCP server lifecycle automatically — you register the server once, and Claude Code starts/stops it with each session.

### Using npx (recommended)

```bash
# Register for all projects (user-level)
claude mcp add lightcap -s user -- npx -y @icjia/lightcap

# Or register for current project only
claude mcp add lightcap -s project -- npx -y @icjia/lightcap
```

### Using a local clone

```bash
# Point directly at the source (for development)
claude mcp add lightcap -s user -- node /absolute/path/to/lightcap-mcp/src/server.js
```

### Manual config (edit settings.json directly)

If you prefer, edit `~/.claude/settings.json`:

```json
{
  "mcpServers": {
    "lightcap": {
      "command": "npx",
      "args": ["-y", "@icjia/lightcap"]
    }
  }
}
```

### Verify it's registered

Restart Claude Code after registering. You should see lightcap listed when you run `/mcp` in Claude Code. Then test:

> "Use lightcap to run an accessibility audit on http://localhost:3000"

### Tool routing with viewcap and Chrome MCP

If you have viewcap and Chrome MCP registered alongside lightcap, add this to your project's `CLAUDE.md` to ensure Claude uses the right tool for each task:

```markdown
# Tool preferences
- For Lighthouse audits (performance, accessibility, SEO), use the `lightcap` MCP server (run_audit, run_a11y, get_status).
- For all screenshots, use the `viewcap` MCP server (take_screenshot, capture_selector, take_screencast).
- For version info on MCP tools, use the relevant server's `get_status` tool.
- Use Chrome MCP for browser automation, DOM interaction, and navigation only.
```

## Setup with Cursor

Cursor supports MCP servers through its settings. Add lightcap to your Cursor MCP configuration.

### Global configuration

Edit `~/.cursor/mcp.json` (create it if it doesn't exist):

```json
{
  "mcpServers": {
    "lightcap": {
      "command": "npx",
      "args": ["-y", "@icjia/lightcap"]
    }
  }
}
```

### Project-level configuration

Create `.cursor/mcp.json` in your project root:

```json
{
  "mcpServers": {
    "lightcap": {
      "command": "npx",
      "args": ["-y", "@icjia/lightcap"]
    }
  }
}
```

After adding the configuration, restart Cursor. LightCap's tools will be available to the AI assistant.

## Setup with other MCP clients

LightCap works with any MCP client that supports stdio transport. The server communicates over stdin/stdout using JSON-RPC (the MCP protocol). Configure your client to spawn:

```bash
npx -y @icjia/lightcap
```

No HTTP ports, no environment variables, no API keys required.

## MCP Tools

### `run_audit`

Full Lighthouse audit across selected categories. Runs all four categories by default, returns compressed scores, top failed audits per category, and core web vitals metrics.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | *(required)* | HTTP/HTTPS URL to audit |
| `categories` | string[] | all 4 | Which categories: `performance`, `accessibility`, `best-practices`, `seo` |
| `maxIssues` | number | 5 | Top N failed audits per category (max 15) |
| `viewport` | string | `desktop` | `desktop` or `mobile` |
| `directory` | string | — | Save full HTML report to this directory |

**Returns:** Compact structured text with scores, failing metrics, and top issues. Zero tokens wasted on passing audits or metrics.

**Example output (page with issues):**

```
http://localhost:3000 [desktop] Perf:72 A11y:88 BP:95 SEO:91
Failing metrics: LCP=4.2s CLS=0.12

── Perf (5 issues) ──
  ✗ largest-contentful-paint: 4.2 s
  ✗ unused-css-rules: Reduce unused CSS
  ✗ render-blocking-resources: Eliminate render-blocking resources
    → link[href="styles.css"], script[src="app.js"]

── A11y (2 issues) ──
  ✗ image-alt: 12 images missing alt text
    → img.hero-image, img.card-thumb (×8) (+2)
  ✗ color-contrast: Insufficient contrast ratio
    → p.subtitle, span.caption (+5)
```

**Example output (clean page):**

```
http://localhost:3000 [desktop] Perf:98 A11y:100 BP:100 SEO:100
```

One line. ~30 tokens. No wasted context on a page that doesn't need fixing.

### `run_a11y`

Accessibility-only audit. Faster than a full audit (~5s vs ~20s) and provides more detail on accessibility issues — grouped by impact level with WCAG criteria references and CSS selectors pointing to affected elements.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `url` | string | *(required)* | HTTP/HTTPS URL to audit |
| `maxIssues` | number | 10 | Top N failed audits per impact group (max 15) |
| `viewport` | string | `desktop` | `desktop` or `mobile` |
| `wcagOnly` | boolean | false | Only return issues with WCAG tags (filters out best-practice-only items) |
| `directory` | string | — | Save full HTML report to this directory |

**Returns:** Compact structured text with score, impact-grouped issues, WCAG refs, and CSS selectors. Critical/serious issues get full element detail; moderate/minor get compact detail.

**Example output:**

```
A11y: http://localhost:3000 [desktop] 88/100 — 9 issues (2c 3s 4m)

── Critical (2 issues, 20 el) ──
  ✗ image-alt [1.1.1] (12 el)
    → img.hero-image
    → img.card-thumb (×8)
    → img.logo
    → img.partner-logo (×2)
    → (+7)
  ✗ color-contrast [1.4.3] (8 el)
    → p.subtitle: foreground #999 on #fff = 3.2:1 (needs 4.5:1)
    → span.caption: foreground #aaa on #f5f5f5 = 2.8:1 (needs 4.5:1)
    → a.nav-link
    → (+5)

── Serious (3 issues, 6 el) ──
  ✗ heading-order [1.3.1] (1 el)
    → section.content > h4
  ✗ link-name [2.4.4] (3 el)
    → a.icon-link, a.social-fb, a.social-tw

── Moderate (4 issues, 11 el) ──
  ✗ list [1.3.1] (3 el)
    → li.breadcrumb-item (×3)
  ✗ tabindex [2.4.3] (2 el)
    → div.modal, input.search
  ✗ definition-list [1.3.1] (1 el)
    → dl.glossary
  ✗ duplicate-id-aria [4.1.1] (2 el)
    → nav#nav-main (×2)
```

**What the compact header tells you at a glance:**
- `88/100` — accessibility score
- `9 issues` — total failed audits
- `2c 3s 4m` — 2 critical, 3 serious, 4 moderate (impact shorthand)

**Tiered detail:** Critical and serious issues show up to 5 affected elements each (these are the ones you need to fix first). Moderate and minor show up to 3 (enough to understand the pattern without burning context).

### `get_status`

Returns server and Lighthouse version info. This is the only way Claude can see version information — `console.error()` goes to stderr which Claude never reads.

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| *(none)* | — | — | No parameters |

**Returns:** Server version, installed Lighthouse version, latest available version on npm, Node version, platform.

**Example output:**

```
lightcap status
  Server:     @icjia/lightcap v0.1.3
  Lighthouse: v13.1.0 (latest: v13.2.0 — update available)
  Node:       v22.22.0
  Platform:   darwin arm64
```

## CLI (standalone usage)

LightCap includes a standalone CLI for use outside of MCP clients:

```bash
# Install globally (or use npx)
npm install -g @icjia/lightcap

# Full audit
lightcap audit http://localhost:3000

# Accessibility-only audit
lightcap a11y http://localhost:3000

# Accessibility audit with WCAG-only filter
lightcap a11y http://localhost:3000 --wcag-only

# Audit specific categories
lightcap audit http://localhost:3000 -c performance,seo

# Mobile viewport
lightcap audit http://localhost:3000 -v mobile

# Save HTML report to directory
lightcap audit http://localhost:3000 -d ~/reports

# Top 10 issues per category
lightcap audit http://localhost:3000 -n 10

# Check versions
lightcap status

# Verbose logging
lightcap --verbose audit http://localhost:3000
```

When run without a subcommand, `lightcap` starts in MCP server mode (stdio transport).

## Usage examples

From Claude Code or Cursor, just ask naturally:

```
"Run an accessibility audit on localhost:3000"
"Audit localhost:3000 for performance and SEO"
"Run a11y audit on localhost:3000 with wcagOnly"
"Audit localhost:3000 and save the report to ~/reports"
"What version of lightcap is running?"
"Run a mobile audit on https://example.com"
"Audit localhost:3000 and show the top 10 issues per category"
"Fix all critical and serious accessibility issues, then re-audit"
```

## Compression strategy

The central design principle: **zero tokens on passes, maximum detail on failures.**

Every tool response must be small enough that Claude retains room to reason and act. A raw Lighthouse report is ~2MB / ~500K tokens. LightCap compresses that to ~30-1,200 tokens depending on the number of failures.

### Context window impact

| Scenario | Lines | Tokens (~) | vs. Raw JSON |
|----------|-------|------------|-------------|
| Clean page (no failures) | 1-2 | ~30 | 99.99% smaller |
| Page with 5 failures | ~15-25 | ~400 | 99.92% smaller |
| Heavy failure page (20+ issues) | ~60-120 | ~1,200 | 99.76% smaller |
| Raw Lighthouse JSON (NEVER returned) | ~60,000 | ~500,000 | — |

### How compression works

Lighthouse returns hundreds of audits. The compression engine applies 12 techniques:

1. **Failed audits only:** all passing audits are skipped entirely — zero tokens
2. **Failing metrics only:** passing metrics are dropped completely (was: all 5 shown with ✓/✗)
3. **Compact header:** URL, viewport, and all 4 scores on a single line: `http://localhost:3000 [desktop] Perf:72 A11y:88 BP:95 SEO:91`
4. **Short labels:** `Perf`, `A11y`, `BP`, `SEO`, `FCP`, `LCP`, `TBT`, `CLS`, `SI` instead of full names
5. **Top N issues per category:** default 5 (run_audit) or 10 (run_a11y), configurable up to 15
6. **Selector deduplication:** `img.card (×8)` instead of listing `img.card` eight times — saves tokens AND provides count information
7. **Selector truncation:** CSS selectors capped at 60 chars — `div.hero > img` not a 40-line DOM snippet
8. **Title compression:** `displayValue` preferred over verbose `title`; long titles truncated to 60 chars
9. **Impact grouping (a11y):** issues grouped by axe-core impact level (critical/serious/moderate/minor) with shorthand notation: `2c 3s 4m`
10. **Tiered element detail:** critical/serious issues show up to 5 affected elements; moderate/minor show up to 3 — detail where it matters most
11. **WCAG references:** extracted from Lighthouse's internal tags (e.g., `wcag111` → `1.1.1`)
12. **Hard cap:** output truncated at 200 lines with a notice to lower `maxIssues`

**What is never returned:** raw JSON, HTML reports, full audit trees, screenshot thumbnails, trace data, network request logs.

### Why plain text, not JSON?

JSON wastes tokens on syntax (`{`, `}`, `"key":`, quotes). Plain structured text is:
- ~30% fewer tokens than equivalent JSON
- Easier for Claude to scan and reference
- Still structured enough for Claude to reason about and act on

## Testing

```bash
# Run all tests (57 tests)
npm test

# Run a specific test file
node --test test/url-validation.test.js
```

The test suite covers:
- **URL validation** — scheme whitelist (http/https only), blocking of file:/data:/javascript:/ftp: schemes
- **Metadata endpoint blocking** — AWS (169.254.169.254), GCP (metadata.google.internal), Azure (metadata.azure.com)
- **IP blocking** — localhost bypass, RFC1918 private range coverage
- **Error message safety** — generic messages only, no internal paths or IPs leaked
- **Compression** — compact header format, score extraction, failed-only audit filtering, failing-only metrics, maxIssues cap, selector truncation and deduplication, output line limit, token estimation
- **A11y grouping** — impact level grouping (critical/serious/moderate/minor), WCAG tag filtering, compact header with impact shorthand, element counts per issue, tiered element detail (critical vs moderate)
- **WCAG parsing** — 3-digit tags (wcag111 → 1.1.1), 4-digit tags (wcag1412 → 1.4.12)
- **Config sanity** — all numeric limits positive, default categories non-empty, metric thresholds present

## Local development

There is no build step. LightCap is plain JavaScript with ES modules. The source files are what ships to npm.

```
Edit source files
      |
      v
Restart Claude Code (re-spawns the server from source)
      |
      v
Test by talking to Claude Code ("audit localhost:3000")
      |
      v
See a bug? Edit the file, restart Claude Code, repeat.
```

### Quick development setup

```bash
# 1. Clone and install
git clone https://github.com/ICJIA/lightcap-mcp.git
cd lightcap-mcp
npm install

# 2. Register your local copy with Claude Code
claude mcp add lightcap -s user -- node $(pwd)/src/server.js

# 3. Restart Claude Code

# 4. Spin up a test target in another terminal
npx serve -l 3000 .

# 5. Test from Claude Code:
#    "Use lightcap to run an accessibility audit on http://localhost:3000"
```

After editing source files, restart Claude Code to pick up changes (the server is re-spawned fresh each startup).

## Architecture

```
src/
├── server.js ........... MCP server init + 3 tool registrations + version tracking
├── runner.js ........... Chrome launch + Lighthouse execution + URL/directory validation
├── compress.js ......... Report → compressed plain text (the core of the server)
├── cli.js .............. Commander-based standalone CLI (audit, a11y, status subcommands)
└── config.js ........... Constants, metric thresholds, logging helper
```

| File | Role |
|------|------|
| `server.js` | MCP init, Zod schemas for 3 tools, request routing, error handling |
| `runner.js` | `chrome-launcher` lifecycle, Lighthouse flags/config, URL validation (scheme whitelist, IP resolution, metadata blocklist), directory validation (symlink-aware) |
| `compress.js` | `compressFullReport()` — scores + failed audits + metrics; `compressA11yReport()` — impact grouping + WCAG refs + element dedup |
| `cli.js` | `audit`, `a11y`, `status` subcommands; falls back to MCP server mode when no subcommand given |
| `config.js` | `CONFIG` object with all limits/thresholds, `log(level, msg)` helper, `setVerbosity()` |

### Dependencies

| Package | Purpose |
|---------|---------|
| `@modelcontextprotocol/server` | MCP server SDK (stdio transport, tool registration) |
| `lighthouse` | Google Lighthouse library (Apache 2.0) |
| `chrome-launcher` | Launches Chrome for Lighthouse (controls lifecycle explicitly) |
| `commander` | CLI subcommand parsing |
| `zod` | Schema validation for MCP tool parameters |
| `@cfworker/json-schema` | Peer dependency of `@modelcontextprotocol/server` |

**Not needed (unlike viewcap):**
- No `puppeteer` — Lighthouse manages its own Chrome connection via DevTools Protocol
- No `sharp` — no image processing
- No restart wrapper — Lighthouse runs fresh Chrome per audit, no singleton to recover

## Security

LightCap runs locally over stdio — no network listener, no ports, no remote attack surface. Security mitigations focus on preventing misuse through prompt injection.

### SSRF prevention

- **Scheme whitelist:** Only `http:` and `https:` URLs are allowed. `file://`, `data:`, `javascript:`, `ftp://`, and all other schemes are blocked.
- **Metadata endpoint blocklist:** AWS (`169.254.169.254`), GCP (`metadata.google.internal`), and Azure (`metadata.azure.com`) metadata endpoints are blocked.
- **Private IP range blocklist:** All RFC1918 private ranges (`10.x`, `172.16-31.x`, `192.168.x`), IPv4 link-local (`169.254.x`), and IPv6 link-local/unique-local (`fe80:`, `fd00:`) are blocked. This prevents reaching internal network services via alternate IP encodings.
- **IP resolution:** Hostnames are resolved to IP addresses and checked against blocked ranges, catching hex IPs, octal IPs, IPv6-mapped addresses, and DNS wildcard services.
- **Fail-closed DNS:** If hostname resolution fails, the request is blocked (not allowed). This prevents DNS poisoning or resolution failures from bypassing IP checks.

### Directory traversal prevention

- Output paths are validated against the user's home directory and `/tmp` only.
- The deepest existing ancestor directory is resolved via `realpathSync` **before** any new directories are created, preventing TOCTOU symlink swap attacks.
- After creation, the final path is re-verified against allowed roots (belt and suspenders).

### Error message safety

- Error messages returned to the AI are generic (e.g., "Blocked URL scheme", "Blocked URL") and never include internal paths, IPs, or stack traces.
- External URL logging writes hostname only (not full URL) to stderr, preventing token leakage from query parameters.

### Resource limits

| Resource | Limit | Enforced By |
|----------|-------|-------------|
| Lighthouse audit timeout | 60s | runner.js (Promise.race + clearTimeout) |
| Page navigation timeout | 30s | Lighthouse maxWaitForLoad flag |
| Issues per category | 15 max | Zod schema + compress.js |
| Elements per issue | 5 shown | compress.js (remainder counted) |
| Selector length | 60 chars | compress.js (truncated with …) |
| Output lines | 200 max | compress.js (truncated with notice) |
| Chrome process | killed in finally | runner.js |

### Input validation

All MCP tool parameters are validated by Zod schemas with enforced min/max bounds. The CLI validates numeric inputs with bounds checking (`clampInt`) to prevent out-of-range values.

### No raw data exposure

Full Lighthouse JSON and HTML reports are **never** returned to Claude. HTML reports can only be saved to disk (for human review). The compression engine is the only path from Lighthouse results to Claude's context.

## Desktop throttling note

Desktop mode disables network and CPU throttling for accurate localhost audits. Performance scores will differ from Lighthouse CLI defaults, which apply simulated throttling. This is intentional — localhost audits benefit from unthrottled results that reflect actual server performance rather than simulated slow-network conditions.

Mobile mode uses Lighthouse's default mobile throttling (simulated slow 4G).

## Configuration flags

| Flag | Description |
|------|-------------|
| `--verbose` | Log audit timing, Chrome lifecycle, compression details, missing axe-core fields |
| `--quiet` | Log errors only |

## ICJIA-specific usage

### ADA Title II compliance

The audit → fix → re-audit loop is the primary workflow for accessibility remediation:

```
You: "Run a11y audit on localhost:3000"
You: "Fix all critical and serious issues"
You: "Run it again — did the score improve?"
```

The `wcagOnly` flag filters to WCAG-mapped issues only, skipping Lighthouse's best-practice recommendations that aren't compliance-relevant.

### Multi-site sweeps

For multiple web properties, you can request a sweep:

```
You: "Audit these URLs and give me a scorecard:
  - icjia.illinois.gov
  - researchhub.icjia.dev
  - accessibility.icjia.app
  ..."
```

Claude will call `run_audit` sequentially and compile a summary table. Context impact: ~40 lines per site.

### Pre-deploy checks

Add to your project's `CLAUDE.md`:

```markdown
# Deploy checklist
Before any deploy to production, run `lightcap run_a11y` against localhost
and verify 0 critical issues and accessibility score >= 90.
```

## Clean-room notice

This project's design is informed by Google Lighthouse's public documentation and output format. **This is an original implementation. No code from third-party Lighthouse wrapper packages is used.** Lighthouse itself is used as a library dependency (Apache 2.0 license).

## License

MIT. See [LICENSE](LICENSE).
