# Tool preferences

- For Lighthouse audits (performance, accessibility, SEO), use the `lightcap` MCP server (run_audit, run_a11y, get_status). If the MCP server isn't available, use the CLI via Bash instead: `lightcap --quiet audit <url>`, `lightcap --quiet a11y <url>`, `lightcap status` (same output; see README "MCP or CLI?" for the flag mapping).
- For all screenshots, use the `viewcap` MCP server.
- Use Chrome MCP for browser automation, DOM interaction, and navigation only.
