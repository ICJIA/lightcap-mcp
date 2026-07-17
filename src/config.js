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
  MAX_QUEUE_DEPTH: 3,
  DEFAULT_CATEGORIES: ['accessibility', 'performance', 'best-practices', 'seo'],
  DEFAULT_VIEWPORT: 'desktop',
  BLOCKED_HOSTNAMES: [
    '169.254.169.254',
    'metadata.google.internal',
    'metadata.azure.com',
    '0.0.0.0',
    '[::]',
  ],
  // CIDR ranges checked via net.BlockList after DNS resolution.
  // [address, prefixLength, family]
  BLOCKED_IP_RANGES: [
    ['0.0.0.0', 8, 'ipv4'],        // "this network" (0.0.0.0/8)
    ['10.0.0.0', 8, 'ipv4'],       // RFC1918
    ['100.64.0.0', 10, 'ipv4'],    // CGNAT (RFC6598)
    ['127.0.0.0', 8, 'ipv4'],      // loopback
    ['169.254.0.0', 16, 'ipv4'],   // link-local / cloud metadata
    ['172.16.0.0', 12, 'ipv4'],    // RFC1918
    ['192.168.0.0', 16, 'ipv4'],   // RFC1918
    ['::', 128, 'ipv6'],           // unspecified
    ['::1', 128, 'ipv6'],          // loopback
    ['fc00::', 7, 'ipv6'],         // unique-local (fc00::/7, includes fd00::/8)
    ['fe80::', 10, 'ipv6'],        // link-local
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
