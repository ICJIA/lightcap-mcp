#!/usr/bin/env node

import { program } from 'commander';
import { runLighthouse, sanitizeError } from './runner.js';
import { compressFullReport, compressA11yReport } from './compress.js';
import { CONFIG, setVerbosity } from './config.js';
import { pkg, installedLighthouseVersion, latestNpmVersion, statusText } from './versions.js';
import { extractVerbosity, isServerInvocation } from './cli-args.js';
import { recordRun } from './cli-history.js';

const lhVersion = installedLighthouseVersion();

program
  .name('lightcap')
  .description('Lighthouse audit tool — compressed reports optimized for Claude\'s context window')
  .version(`lightcap v${pkg.version} (Lighthouse v${lhVersion})`, '-V, --version', 'Show lightcap and Lighthouse versions')
  .addHelpText('before', `lightcap v${pkg.version} — Lighthouse v${lhVersion}\n`)
  .addHelpText('after', `
Examples:
  lightcap audit https://example.com                 full audit (perf, a11y, BP, SEO)
  lightcap a11y http://localhost:3000                accessibility only (~5s)
  lightcap a11y http://localhost:3000 --wcag-only    WCAG-tagged issues only
  lightcap audit http://localhost:3000 -c performance,seo -v mobile
  lightcap status                                    versions + update check

Re-auditing the same URL/viewport/categories prints a "Δ vs last run" line
(score changes, fixed and new issues). Use --no-diff to skip it.

Global flags (any position):
  --quiet     errors only on stderr (keeps output to the report itself)
  --verbose   log timing, Chrome lifecycle, compression details

Run 'lightcap <command> --help' for a command's options.
With no arguments and piped stdin (as MCP clients launch it), lightcap runs as an MCP server.`);

// --verbose / --quiet are handled before commander (see dispatch at the
// bottom), so their position relative to a subcommand does not matter.

function clampInt(val, min, max, fallback) {
  const n = parseInt(val);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function withDelta(tool, params, lhr, text, diff) {
  if (!diff) return text;
  const delta = recordRun(tool, params, lhr);
  return delta ? `${delta}\n${text}` : text;
}

program
  .command('audit <url>')
  .description('Run a full Lighthouse audit (performance, accessibility, best-practices, seo)')
  .option('-c, --categories <list>', 'Comma-separated categories', 'performance,accessibility,best-practices,seo')
  .option('-n, --max-issues <n>', 'Top N failed audits per category', '5')
  .option('-v, --viewport <type>', 'desktop or mobile', 'desktop')
  .option('-d, --directory <path>', 'Save full HTML report to directory')
  .option('--no-diff', 'Skip the "Δ vs last run" line (and don\'t record this run)')
  .action(async (url, opts) => {
    try {
      const categories = opts.categories.split(',').map(s => s.trim()).filter(Boolean);
      const maxIssues = clampInt(opts.maxIssues, 1, CONFIG.MAX_ISSUES_CAP, CONFIG.MAX_ISSUES_DEFAULT);

      const { lhr, htmlPath } = await runLighthouse(url, {
        categories,
        viewport: opts.viewport,
        directory: opts.directory,
      });

      let text = compressFullReport(lhr, maxIssues);
      text = withDelta('audit', { url, viewport: opts.viewport, categories }, lhr, text, opts.diff);
      console.log(text);

      if (htmlPath) {
        console.log(`\nFull HTML report saved: ${htmlPath}`);
      }
    } catch (err) {
      console.error(`Error: ${sanitizeError(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('a11y <url>')
  .description('Run an accessibility-only audit (~5s vs ~20s for full)')
  .option('-n, --max-issues <n>', 'Top N failed audits per impact group', '10')
  .option('-v, --viewport <type>', 'desktop or mobile', 'desktop')
  .option('--wcag-only', 'Only return issues with WCAG tags')
  .option('-d, --directory <path>', 'Save full HTML report to directory')
  .option('--no-diff', 'Skip the "Δ vs last run" line (and don\'t record this run)')
  .action(async (url, opts) => {
    try {
      const maxIssues = clampInt(opts.maxIssues, 1, CONFIG.MAX_ISSUES_CAP, CONFIG.MAX_ISSUES_A11Y_DEFAULT);

      const { lhr, htmlPath } = await runLighthouse(url, {
        categories: ['accessibility'],
        viewport: opts.viewport,
        directory: opts.directory,
      });

      let text = compressA11yReport(lhr, maxIssues, opts.wcagOnly);
      text = withDelta('a11y', { url, viewport: opts.viewport, categories: ['accessibility'] }, lhr, text, opts.diff);
      console.log(text);

      if (htmlPath) {
        console.log(`\nFull HTML report saved: ${htmlPath}`);
      }
    } catch (err) {
      console.error(`Error: ${sanitizeError(err)}`);
      process.exitCode = 1;
    }
  });

program
  .command('status')
  .description('Show lightcap version, Lighthouse version, and update availability')
  .action(async () => {
    const latestLh = await latestNpmVersion('lighthouse');
    console.log(statusText({ serverVersion: pkg.version, lhVersion, latestLh }));
  });

// Handle global flags first (position-independent), then dispatch: a bare
// invocation with piped stdin (how MCP clients launch us) starts the MCP
// server; a bare invocation at an interactive terminal prints help instead of
// silently waiting for JSON-RPC; anything else goes to commander.
const { verbosity, rest } = extractVerbosity(process.argv.slice(2));
if (verbosity) setVerbosity(verbosity);

if (isServerInvocation(rest, Boolean(process.stdin.isTTY))) {
  await import('./server.js');
} else if (rest.length === 0) {
  // Bare `lightcap` typed at a terminal: show help on stdout and exit 0.
  program.help();
} else {
  program.parse(rest, { from: 'user' });
}
