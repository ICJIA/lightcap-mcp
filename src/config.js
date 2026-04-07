export const CONFIG = {
  MAX_ISSUES_DEFAULT: 5,
  MAX_ISSUES_A11Y_DEFAULT: 10,
  MAX_ISSUES_CAP: 15,
  MAX_ELEMENTS_PER_ISSUE: 5,
  SELECTOR_MAX_LENGTH: 60,
  EXPLANATION_MAX_LENGTH: 120,
  MAX_URL_LENGTH: 2048,
  AUDIT_TIMEOUT: 60_000,
  NAV_TIMEOUT: 30_000,
  MAX_CONCURRENT_AUDITS: 2,
  DEFAULT_CATEGORIES: ['accessibility', 'performance', 'best-practices', 'seo'],
  DEFAULT_VIEWPORT: 'desktop',
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    '0.0.0.0',
  ],
  BLOCKED_IP_PREFIXES: [
    '169.254.',                // IPv4 link-local (AWS metadata)
    '10.',                     // RFC1918 Class A private
    '172.16.', '172.17.', '172.18.', '172.19.',  // RFC1918 Class B private
    '172.20.', '172.21.', '172.22.', '172.23.',
    '172.24.', '172.25.', '172.26.', '172.27.',
    '172.28.', '172.29.', '172.30.', '172.31.',
    '192.168.',                // RFC1918 Class C private
    '127.',                    // Full loopback range (127.0.0.0/8)
    '0.',                      // 0.0.0.0/8 "this network"
    'fd00:',                   // IPv6 unique-local
    'fe80:',                   // IPv6 link-local
    '::',                      // IPv6 unspecified / loopback
  ],
  LOCALHOST_HOSTS: ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', '[::]'],
  METRIC_THRESHOLDS: {
    'first-contentful-paint': 1800,
    'largest-contentful-paint': 2500,
    'total-blocking-time': 200,
    'cumulative-layout-shift': 0.1,
    'speed-index': 3400,
  },
  MAX_OUTPUT_LINES: 200,
  MAX_OUTPUT_CHARS: 50_000,
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
