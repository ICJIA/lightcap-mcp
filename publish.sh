#!/usr/bin/env bash
set -euo pipefail

# LightCap publish script
# Usage:
#   ./publish.sh                 — first-time setup + publish
#   ./publish.sh patch           — bump patch version and publish (default)
#   ./publish.sh minor           — bump minor version and publish
#   ./publish.sh major           — bump major version and publish
#   ./publish.sh patch 123456    — bump + publish, passing a 2FA OTP (skips the
#                                  y/N confirm; needed for npm 2FA / non-interactive)
#   ./publish.sh --dry-run       — dry run only, no publish

PACKAGE_NAME="@icjia/lightcap"
BUMP="${1:-patch}"
OTP="${2:-}"
DRY_RUN=false

if [[ "$BUMP" == "--dry-run" ]]; then
  DRY_RUN=true
  BUMP="patch"
fi

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

info()  { echo -e "${GREEN}[lightcap]${NC} $1"; }
warn()  { echo -e "${YELLOW}[lightcap]${NC} $1"; }
error() { echo -e "${RED}[lightcap]${NC} $1" >&2; }

# Helper to read package.json fields (ESM-safe — project uses "type": "module")
pkg_field() {
  node --input-type=commonjs -e "console.log(require('./package.json').$1)"
}

# ─── Preflight checks ───────────────────────────────────────────────

# Must be in project root
if [[ ! -f "package.json" ]]; then
  error "No package.json found. Run this from the lightcap project root."
  exit 1
fi

# Verify correct package
ACTUAL_NAME=$(pkg_field name)
if [[ "$ACTUAL_NAME" != "$PACKAGE_NAME" ]]; then
  error "package.json name is '$ACTUAL_NAME', expected '$PACKAGE_NAME'"
  exit 1
fi

# Check npm login
if ! npm whoami &>/dev/null; then
  warn "Not logged in to npm. Logging in now..."
  npm login
fi

NPM_USER=$(npm whoami)
info "Logged in as: $NPM_USER"

# Check for uncommitted changes
if [[ -n "$(git status --porcelain)" ]]; then
  error "Uncommitted changes detected. Commit or stash before publishing."
  git status --short
  exit 1
fi

# Validate bump type
if [[ "$BUMP" != "patch" && "$BUMP" != "minor" && "$BUMP" != "major" ]]; then
  error "Invalid bump type: '$BUMP'. Use patch, minor, or major."
  exit 1
fi

# Sanity-check OTP format if provided (npm 2FA codes are 6 digits)
if [[ -n "$OTP" && ! "$OTP" =~ ^[0-9]{6}$ ]]; then
  warn "OTP '$OTP' doesn't look like a 6-digit code — passing it through anyway."
fi

# ─── First-time detection ───────────────────────────────────────────

FIRST_TIME=false
if ! npm view "$PACKAGE_NAME" version &>/dev/null 2>&1; then
  FIRST_TIME=true
  warn "Package '$PACKAGE_NAME' not found on npm — this is a first-time publish."
fi

# ─── Version bump ───────────────────────────────────────────────────

CURRENT_VERSION=$(pkg_field version)
info "Current version: $CURRENT_VERSION"
info "Bumping: $BUMP"
NEW_VERSION=$(npm version "$BUMP" --no-git-tag-version)
NEW_VERSION="${NEW_VERSION#v}" # strip leading 'v'
info "New version: $NEW_VERSION"

# ─── CHANGELOG check ────────────────────────────────────────────────

# Require a CHANGELOG entry for the new version before publishing.
if ! grep -qE "\[$NEW_VERSION\]|## $NEW_VERSION( |$)" CHANGELOG.md; then
  error "CHANGELOG.md has no entry for [$NEW_VERSION]. Add one before publishing."
  git checkout package.json package-lock.json
  exit 1
fi
info "CHANGELOG.md entry for $NEW_VERSION found."

# ─── Dry run ────────────────────────────────────────────────────────

info "Running dry run..."
echo ""

if [[ "$FIRST_TIME" == true ]]; then
  npm publish --access public --dry-run
else
  npm publish --dry-run
fi

echo ""

if [[ "$DRY_RUN" == true ]]; then
  # Revert the version bump since we're not publishing
  git checkout package.json package-lock.json
  info "Dry run complete. No changes made."
  exit 0
fi

# ─── Confirm ────────────────────────────────────────────────────────

# An OTP is an explicit, time-sensitive signal of intent — skip the prompt so
# the code doesn't expire while waiting (and so non-interactive runs work).
if [[ -n "$OTP" ]]; then
  info "OTP provided — skipping confirmation and publishing now."
else
  echo ""
  if [[ "$FIRST_TIME" == true ]]; then
    warn "About to publish $PACKAGE_NAME@$NEW_VERSION for the FIRST TIME."
  else
    warn "About to publish $PACKAGE_NAME@$NEW_VERSION"
  fi
  read -p "Proceed? (y/N) " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    # Revert the version bump
    git checkout package.json package-lock.json
    info "Aborted. No changes made."
    exit 0
  fi
fi

# ─── Publish ────────────────────────────────────────────────────────

# ${OTP:+--otp "$OTP"} expands to nothing when no OTP was given, or to the
# --otp flag and code when one was. If omitted and 2FA is on, npm prompts.
if [[ "$FIRST_TIME" == true ]]; then
  npm publish --access public ${OTP:+--otp "$OTP"}
else
  npm publish ${OTP:+--otp "$OTP"}
fi

# ─── Git commit + tag ───────────────────────────────────────────────

git add package.json package-lock.json
git commit -m "release: v$NEW_VERSION"
git tag "v$NEW_VERSION"

git push && git push --tags

# ─── Done ───────────────────────────────────────────────────────────

echo ""
info "Published $PACKAGE_NAME@$NEW_VERSION"
info "npm: https://www.npmjs.com/package/$PACKAGE_NAME"
info ""
info "Users will get this version on next Claude Code restart via:"
info "  npx -y $PACKAGE_NAME"
