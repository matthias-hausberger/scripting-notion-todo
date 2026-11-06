#!/bin/sh
# Builds dist/Notion Todo.scripting: a zip with script.json and index.tsx at its root.
set -eu
root="$(cd "$(dirname "$0")/.." && pwd)"
mkdir -p "$root/dist"
out="$root/dist/Notion Todo.scripting"
rm -f "$out"
cd "$root/app"
zip -rq "$out" . -x "*.DS_Store"
echo "$out"
