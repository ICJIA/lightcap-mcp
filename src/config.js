export const CONFIG = {
  MAX_ISSUES_DEFAULT: 5,
  MAX_ISSUES_A11Y_DEFAULT: 10,
  MAX_ISSUES_CAP: 15,
  MAX_ELEMENTS_PER_ISSUE: 5,
  SELECTOR_MAX_LENGTH: 60,
  AUDIT_TIMEOUT: 60_000,
  NAV_TIMEOUT: 30_000,
  DEFAULT_CATEGORIES: ['accessibility', 'performance', 'best-practices', 'seo'],
  DEFAULT_VIEWPORT: 'desktop',
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
  ],
  BLOCKED_IP_PREFIXES: [
    '169.254.',
    '10.',
    '172.16.', '172.17.', '172.18.', '172.19.',
    '172.20.', '172.21.', '172.22.', '172.23.',
    '172.24.', '172.25.', '172.26.', '172.27.',
    '172.28.', '172.29.', '172.30.', '172.31.',
    '192.168.',
    'fd00:',
    'fe80:',
  ],
  LOCALHOST_HOSTS: ['localhost', '127.0.0.1', '::1', '[::1]'],
  METRIC_THRESHOLDS: {
    'first-contentful-paint': 1800,
    'largest-contentful-paint': 2500,
    'total-blocking-time': 200,
    'cumulative-layout-shift': 0.1,
    'speed-index': 3400,
  },
  MAX_OUTPUT_LINES: 200,
};

// Logging — levels: error, info, debug
// Verbosity: 'quiet' = error only, 'normal' = error+info, 'verbose' = all
let verbosity = 'normal';

export function setVerbosity(level) { verbosity = level; }

export function log(level, msg) {
  if (verbosity === 'quiet' && level !== 'error') return;
  if (verbosity === 'normal' && level === 'debug') return;
  console.error(`[lightcap] ${msg}`);
}
