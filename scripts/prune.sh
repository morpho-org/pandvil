#!/bin/bash
set -euo pipefail

# cd to repository root
cd "$(git rev-parse --show-toplevel)"

# clean and recreate out dirs
rm -rf out/json out/full
mkdir -p out/json out/full

# json copy
for f in .npmrc package.json pnpm-lock.yaml pnpm-workspace.yaml; do
  if [ -f "$f" ]; then
    cp "$f" out/json/
  fi
done

# full copy
git ls-files --cached --others --exclude-standard -z \
  | while IFS= read -r -d '' file; do
      [ -e "$file" ] && printf '%s\0' "$file"
    done \
  | tar --null -T - -cf - \
  | (cd out/full && tar xf -)

rm -rf out/full/.git*
