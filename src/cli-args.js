// Pure argv helpers for the CLI entry point. Kept side-effect-free so they
// can be unit-tested without triggering the dispatch in cli.js.

// Pull the global --verbose/--quiet flags out of the args regardless of
// position, returning the chosen verbosity (last wins, or null) and the
// remaining args. Handling them here means `lightcap --verbose audit <url>`
// runs the audit instead of starting the MCP server.
export function extractVerbosity(args) {
  let verbosity = null;
  const rest = [];
  for (const arg of args) {
    if (arg === '--verbose') verbosity = 'verbose';
    else if (arg === '--quiet') verbosity = 'quiet';
    else rest.push(arg);
  }
  return { verbosity, rest };
}

const COMMANDER_FLAGS = new Set(['--help', '-h', '--version', '-V']);

// Decide whether to start the MCP server (vs. run a CLI command), given the
// args with the global flags already removed:
//   - bare invocation with piped stdin (how MCP clients launch us) → server
//   - bare invocation at an interactive terminal → not the server (show help)
//   - a leading unknown flag (e.g. a server arg some MCP config passes) →
//     server, preserving the pre-0.3.0 behavior for MCP configs
//   - a subcommand, --help or --version → commander
export function isServerInvocation(rest, stdinIsTTY = false) {
  if (rest.length === 0) return !stdinIsTTY;
  const first = rest[0];
  return first.startsWith('-') && !COMMANDER_FLAGS.has(first);
}
