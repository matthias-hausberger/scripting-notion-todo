#!/bin/sh
# Copies app/ into the Scripting dev-server workspace without touching the app-created script.json.
# Usage: scripts/sync-dev.sh [workspace-dir]   (default: ~/Documents/scripting-dev/notion-todo)
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
ws="${1:-$HOME/Documents/scripting-dev/notion-todo}"
rsync -a --exclude script.json --exclude .DS_Store "$root/app/" "$ws/scripts/Notion Todo/"
