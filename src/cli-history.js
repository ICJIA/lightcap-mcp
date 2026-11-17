import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'fs';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { CONFIG } from './config.js';
import { summarizeRun, diffLine, RunHistory } from './diff.js';

// Persistent run history for the CLI. The MCP server keeps re-audit history
// in memory for the life of its session; a CLI process exits after each
// audit, so it stores the same summaries (scores + failed audit ids, no page
// content) in a small JSON file instead. That gives `lightcap audit` /
// `lightcap a11y` the same "Δ vs last run" line as the MCP tools.

export function historyPath(env = process.env) {
  if (env.LIGHTCAP_HISTORY) return env.LIGHTCAP_HISTORY;
  const base = env.XDG_CACHE_HOME || join(homedir(), '.cache');
  return join(base, 'lightcap', 'cli-history.json');
}

// Same key shape as server.js withDiff(), so the semantics match exactly.
export function historyKey(tool, { url, viewport, categories }) {
  const cats = (categories || CONFIG.DEFAULT_CATEGORIES).slice().sort().join(',');
  return `${tool}|${url}|${viewport || CONFIG.DEFAULT_VIEWPORT}|${cats}`;
}

export function loadHistory(path) {
  const history = new RunHistory();
  try {
    const data = JSON.parse(readFileSync(path, 'utf8'));
    if (Array.isArray(data)) {
      for (const [key, value] of data) {
        if (typeof key === 'string' && value && typeof value === 'object') history.set(key, value);
      }
    }
  } catch {
    // Missing or corrupt file: start fresh.
  }
  return history;
}

export function saveHistory(path, history) {
  try {
    mkdirSync(dirname(path), { recursive: true });
    const tmp = `${path}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify([...history.entries]), { mode: 0o600 });
    renameSync(tmp, path); // atomic replace, so concurrent runs never read a half-written file
  } catch {
    // History is a convenience; never fail an audit because it can't be saved.
  }
}

// Record this run and return the Δ line (or null on the first run).
export function recordRun(tool, params, lhr, path = historyPath()) {
  const history = loadHistory(path);
  const key = historyKey(tool, params);
  const curr = summarizeRun(lhr);
  const delta = diffLine(history.get(key), curr);
  history.set(key, curr);
  saveHistory(path, history);
  return delta;
}
