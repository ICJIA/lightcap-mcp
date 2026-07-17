#!/usr/bin/env node

import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { runLighthouse, sanitizeError } from './runner.js';
import { compressFullReport, compressA11yReport } from './compress.js';
import { CONFIG, setVerbosity, log } from './config.js';
import { pkg, installedLighthouseVersion, latestNpmVersion, statusText } from './versions.js';
import { summarizeRun, diffLine, RunHistory } from './diff.js';

if (process.argv.includes('--verbose')) setVerbosity('verbose');
if (process.argv.includes('--quiet')) setVerbosity('quiet');

// ─── Version tracking (loaded once on startup) ────────────────────

const serverVersion = pkg.version;
const lhVersion = installedLighthouseVersion();

// Kick off npm registry check at startup (non-blocking); the promise
// caches the result for the session.
const latestLhPromise = latestNpmVersion('lighthouse');

log('info', `Server v${serverVersion} | Lighthouse v${lhVersion}`);

// ─── MCP Server ────────────────────────────────────────────────────

const server = new McpServer({
  name: 'lightcap',
  version: serverVersion,
});

// Session-scoped history: re-audits of the same target get a Δ line
// (score changes, fixed issues, new issues) prepended to the report.
const history = new RunHistory();

function withDiff(tool, params, lhr, text) {
  const categories = (params.categories || CONFIG.DEFAULT_CATEGORIES).slice().sort().join(',');
  const key = `${tool}|${params.url}|${params.viewport || CONFIG.DEFAULT_VIEWPORT}|${categories}`;
  const curr = summarizeRun(lhr);
  const delta = diffLine(history.get(key), curr);
  history.set(key, curr);
  return delta ? `${delta}\n${text}` : text;
}

// ─── run_audit ─────────────────────────────────────────────────────

server.registerTool(
  'run_audit',
  {
    description: 'Run a full Lighthouse audit on a web page. Returns compressed scores and top issues optimized for Claude\'s context window. Categories: performance, accessibility, best-practices, seo.',
    inputSchema: z.object({
      url: z.url().max(CONFIG.MAX_URL_LENGTH).describe('HTTP or HTTPS URL to audit'),
      categories: z.array(z.enum(['performance', 'accessibility', 'best-practices', 'seo'])).optional().describe('Which categories to audit (default: all 4)'),
      maxIssues: z.number().int().min(1).max(15).optional().describe('Top N failed audits per category (default 5, max 15)'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('Viewport emulation (default: desktop)'),
      directory: z.string().max(500).optional().describe('Save full HTML report to this directory'),
    }),
  },
  async (params) => {
    try {
      const { lhr, htmlPath } = await runLighthouse(params.url, {
        categories: params.categories,
        viewport: params.viewport,
        directory: params.directory,
      });

      let text = compressFullReport(lhr, params.maxIssues);
      text = withDiff('audit', params, lhr, text);

      if (htmlPath) {
        text += `\n\nFull HTML report saved: ${htmlPath}`;
      }

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      log('error', err.message);
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── run_a11y ──────────────────────────────────────────────────────

server.registerTool(
  'run_a11y',
  {
    description: 'Run an accessibility-only Lighthouse audit. Faster than full audit (~5s vs ~20s). Returns issues grouped by impact (critical/serious/moderate/minor) with WCAG criteria and CSS selectors.',
    inputSchema: z.object({
      url: z.url().max(CONFIG.MAX_URL_LENGTH).describe('HTTP or HTTPS URL to audit'),
      maxIssues: z.number().int().min(1).max(15).optional().describe('Top N failed audits per impact group (default 10, max 15)'),
      viewport: z.enum(['desktop', 'mobile']).optional().describe('Viewport emulation (default: desktop)'),
      wcagOnly: z.boolean().optional().describe('If true, only return issues with WCAG tags'),
      directory: z.string().max(500).optional().describe('Save full HTML report to this directory'),
    }),
  },
  async (params) => {
    try {
      const { lhr, htmlPath } = await runLighthouse(params.url, {
        categories: ['accessibility'],
        viewport: params.viewport,
        directory: params.directory,
      });

      let text = compressA11yReport(lhr, params.maxIssues, params.wcagOnly);
      text = withDiff('a11y', { ...params, categories: ['accessibility'] }, lhr, text);

      if (htmlPath) {
        text += `\n\nFull HTML report saved: ${htmlPath}`;
      }

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      log('error', err.message);
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── get_status ────────────────────────────────────────────────────

server.registerTool(
  'get_status',
  {
    description: 'Returns lightcap server version, installed Lighthouse version, and whether a newer version is available on npm.',
    inputSchema: z.object({}),
  },
  async () => {
    try {
      const latestLh = await latestLhPromise;
      const text = statusText({ serverVersion, lhVersion, latestLh });

      return { content: [{ type: 'text', text }] };
    } catch (err) {
      log('error', err.message);
      return { content: [{ type: 'text', text: `Error: ${sanitizeError(err)}` }] };
    }
  }
);

// ─── Start ─────────────────────────────────────────────────────────

console.error('[lightcap] Server started — tools: run_audit, run_a11y, get_status');
const transport = new StdioServerTransport();
await server.connect(transport);
