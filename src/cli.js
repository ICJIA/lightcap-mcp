#!/usr/bin/env node

import { program } from 'commander';
import { readFileSync } from 'fs';
import { execFile } from 'child_process';
import { runLighthouse } from './runner.js';
import { compressFullReport, compressA11yReport } from './compress.js';
import { CONFIG, setVerbosity } from './config.js';

const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

program
  .name('lightcap')
  .description('Lighthouse audit tool — compressed reports optimized for Claude\'s context window')
  .version(pkg.version);

// Global options
program
  .option('--verbose', 'Verbose logging')
  .option('--quiet', 'Errors only');

function applyGlobalOptions(opts) {
  if (opts.verbose) setVerbosity('verbose');
  if (opts.quiet) setVerbosity('quiet');
}

function clampInt(val, min, max, fallback) {
  const n = parseInt(val);
  if (isNaN(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

program
  .command('audit <url>')
  .description('Run a full Lighthouse audit (performance, accessibility, best-practices, seo)')
  .option('-c, --categories <list>', 'Comma-separated categories', 'performance,accessibility,best-practices,seo')
  .option('-n, --max-issues <n>', 'Top N failed audits per category', '5')
  .option('-v, --viewport <type>', 'desktop or mobile', 'desktop')
  .option('-d, --directory <path>', 'Save full HTML report to directory')
  .action(async (url, opts) => {
    applyGlobalOptions(program.opts());
    try {
      const categories = opts.categories.split(',').map(s => s.trim()).filter(Boolean);
      const maxIssues = clampInt(opts.maxIssues, 1, CONFIG.MAX_ISSUES_CAP, CONFIG.MAX_ISSUES_DEFAULT);

      const { lhr, htmlPath } = await runLighthouse(url, {
        categories,
        viewport: opts.viewport,
        directory: opts.directory,
      });

      console.log(compressFullReport(lhr, maxIssues));

      if (htmlPath) {
        console.log(`\nFull HTML report saved: ${htmlPath}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
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
  .action(async (url, opts) => {
    applyGlobalOptions(program.opts());
    try {
      const maxIssues = clampInt(opts.maxIssues, 1, CONFIG.MAX_ISSUES_CAP, CONFIG.MAX_ISSUES_A11Y_DEFAULT);

      const { lhr, htmlPath } = await runLighthouse(url, {
        categories: ['accessibility'],
        viewport: opts.viewport,
        directory: opts.directory,
      });

      console.log(compressA11yReport(lhr, maxIssues, opts.wcagOnly));

      if (htmlPath) {
        console.log(`\nFull HTML report saved: ${htmlPath}`);
      }
    } catch (err) {
      console.error(`Error: ${err.message}`);
      process.exitCode = 1;
    }
  });

program
  .command('status')
  .description('Show server version, Lighthouse version, and update availability')
  .action(async () => {
    applyGlobalOptions(program.opts());

    let lhVersion = 'unknown';
    try {
      const lhPkg = JSON.parse(readFileSync(new URL('../node_modules/lighthouse/package.json', import.meta.url)));
      lhVersion = lhPkg.version;
    } catch { /* ignore */ }

    let latestVersion = 'unknown';
    try {
      latestVersion = await new Promise((resolve, reject) => {
        execFile('npm', ['view', 'lighthouse', 'version'], { timeout: 5000 }, (err, stdout) => {
          if (err) reject(err);
          else {
            const raw = stdout.trim();
            resolve(/^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown');
          }
        });
      });
    } catch { /* ignore */ }

    const updateNote = (latestVersion === 'unknown' || latestVersion === lhVersion)
      ? '(latest)'
      : `(latest: v${latestVersion} — update available)`;

    console.log('lightcap status');
    console.log(`  Server:     @icjia/lightcap v${pkg.version}`);
    console.log(`  Lighthouse: v${lhVersion} ${updateNote}`);
    console.log(`  Node:       v${process.versions.node}`);
    console.log(`  Platform:   ${process.platform} ${process.arch}`);
  });

// Default: start MCP server (when no subcommand given)
const subcommands = ['audit', 'a11y', 'status', 'help'];
const arg2 = process.argv[2];
const isSubcommand = arg2 && (subcommands.includes(arg2) || arg2 === '--help' || arg2 === '-h' || arg2 === '--version' || arg2 === '-V');

if (!arg2 || (!isSubcommand && arg2.startsWith('-'))) {
  await import('./server.js');
} else {
  program.parse();
}
