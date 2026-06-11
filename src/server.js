#!/usr/bin/env node

import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { execFile } from 'child_process';
import { McpServer, StdioServerTransport } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { runLighthouse, sanitizeError } from './runner.js';
import { compressFullReport, compressA11yReport } from './compress.js';
import { CONFIG, setVerbosity, log } from './config.js';

if (process.argv.includes('--verbose')) setVerbosity('verbose');
if (process.argv.includes('--quiet')) setVerbosity('quiet');

// ─── Version tracking (loaded once on startup) ────────────────────

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
const serverVersion = pkg.version;

let lhVersion = 'unknown';
try {
  // Resolve through Node's module algorithm rather than a fixed relative path:
  // under npx/npm flat installs, lighthouse is hoisted to a parent node_modules
  // (not ./node_modules/lighthouse), so the old '../node_modules/...' path
  // failed there and get_status reported "vunknown".
  const lhPkg = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('lighthouse/package.json')));
  lhVersion = lhPkg.version;
} catch { /* ignore */ }

// Kick off npm registry check at startup (non-blocking).
// Use execFile to avoid shell interpretation.
let _latestLhVersion = null;
const _latestLhPromise = new Promise((resolve) => {
  execFile('npm', ['view', 'lighthouse', 'version'], { timeout: 5000 }, (err, stdout) => {
    const raw = err ? 'unknown' : stdout.trim();
    // Sanitize: only accept semver-shaped strings
    _latestLhVersion = /^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown';
    resolve(_latestLhVersion);
  });
});

async function getLatestLhVersion() {
  if (_latestLhVersion) return _latestLhVersion;
  return _latestLhPromise;
}

log('info', `Server v${serverVersion} | Lighthouse v${lhVersion}`);

// ─── MCP Server ────────────────────────────────────────────────────

const server = new McpServer({
  name: 'lightcap',
  version: serverVersion,
});

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
      const latest = await getLatestLhVersion();
      const updateNote = (latest === 'unknown' || latest === lhVersion)
        ? '(latest)'
        : `(latest: v${latest} — update available)`;

      const text = [
        'lightcap status',
        `  Server:     @icjia/lightcap v${serverVersion}`,
        `  Lighthouse: v${lhVersion} ${updateNote}`,
        `  Node:       v${process.versions.node}`,
        `  Platform:   ${process.platform} ${process.arch}`,
      ].join('\n');

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
