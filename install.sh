#!/usr/bin/env bash
#
# Install / update the opencode agent-memory bundle into a project's .opencode/.
#
# Usage:
#   ./install.sh <project-dir> [--force]
#
# Copies bundle/.opencode/{plugin,memory,skill,command} into <project>/.opencode/,
# ensures the .opencode/.gitignore ignores node artifacts, and seeds the store
# schema doc at <project>/.ai_agents/memory/README.md if absent.
set -euo pipefail

usage() {
  echo "usage: $0 <project-dir> [--force]" >&2
  exit 2
}

[ $# -ge 1 ] || usage
PROJECT="$1"
FORCE="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BUNDLE="$SCRIPT_DIR/bundle/.opencode"
SEED="$SCRIPT_DIR/bundle/seed/memory-README.md"

[ -d "$BUNDLE" ] || { echo "bundle not found: $BUNDLE" >&2; exit 1; }
[ -d "$PROJECT" ] || { echo "project dir not found: $PROJECT" >&2; exit 1; }
PROJECT="$(cd "$PROJECT" && pwd)"
TARGET="$PROJECT/.opencode"

VERSION="$(cat "$BUNDLE/memory/VERSION" 2>/dev/null || echo unknown)"
INSTALLED=""
[ -f "$TARGET/memory/VERSION" ] && INSTALLED="$(cat "$TARGET/memory/VERSION")"

if [ "$FORCE" != "--force" ] && [ -n "$INSTALLED" ] && [ "$INSTALLED" = "$VERSION" ]; then
  echo "opencode-memory $VERSION already installed in $TARGET (use --force to overwrite)"
else
  mkdir -p "$TARGET"
  for dir in plugin memory skill command; do
    cp -R "$BUNDLE/$dir" "$TARGET/"
  done
  echo "installed opencode-memory $VERSION -> $TARGET"
fi

# Ensure .opencode/.gitignore covers node artifacts (append, never clobber).
GITIGNORE="$TARGET/.gitignore"
touch "$GITIGNORE"
for entry in node_modules package.json package-lock.json bun.lock; do
  if ! grep -qxF "$entry" "$GITIGNORE" 2>/dev/null; then
    echo "$entry" >> "$GITIGNORE"
  fi
done

# Seed the local store schema doc if the store has no README yet.
STORE="$PROJECT/.ai_agents/memory"
if [ -f "$SEED" ] && [ ! -f "$STORE/README.md" ]; then
  mkdir -p "$STORE"
  cp "$SEED" "$STORE/README.md"
  echo "seeded $STORE/README.md"
fi

echo
echo "Next:"
echo "  git -C \"$PROJECT\" add .opencode"
echo "  git -C \"$PROJECT\" commit -m 'chore: vendor opencode-memory plugin'"
