import { readFileSync } from 'fs';
import { createRequire } from 'module';
import { execFile } from 'child_process';

export const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));

// Resolve through Node's module algorithm rather than a fixed relative path:
// under npx/npm flat installs, lighthouse is hoisted to a parent node_modules
// (not ./node_modules/lighthouse), so a '../node_modules/...' path fails there
// and version reporting silently degrades to "unknown".
export function installedLighthouseVersion() {
  try {
    const lhPkg = JSON.parse(readFileSync(createRequire(import.meta.url).resolve('lighthouse/package.json')));
    return lhPkg.version;
  } catch {
    return 'unknown';
  }
}

// Only accept semver-shaped strings — a malicious .npmrc could otherwise
// inject arbitrary text into status output.
export function parseNpmVersionOutput(err, stdout) {
  const raw = err ? 'unknown' : String(stdout).trim();
  return /^\d+\.\d+\.\d+/.test(raw) ? raw : 'unknown';
}

// Use execFile to avoid shell interpretation.
export function latestNpmVersion(name) {
  return new Promise((resolve) => {
    execFile('npm', ['view', name, 'version'], { timeout: 5000 }, (err, stdout) => {
      resolve(parseNpmVersionOutput(err, stdout));
    });
  });
}

export function statusText({ serverVersion, lhVersion, latestLh }) {
  const updateNote = (latestLh === 'unknown' || latestLh === lhVersion)
    ? '(latest)'
    : `(latest: v${latestLh} — update available)`;

  return [
    'lightcap status',
    `  Server:     @icjia/lightcap v${serverVersion}`,
    `  Lighthouse: v${lhVersion} ${updateNote}`,
    `  Node:       v${process.versions.node}`,
    `  Platform:   ${process.platform} ${process.arch}`,
  ].join('\n');
}
