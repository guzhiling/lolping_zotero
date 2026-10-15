#!/bin/sh
# Packs the plugin into zotero-pingwheel-<version>.xpi, taking the version from manifest.json.
set -e
cd "$(dirname "$0")"
version=$(sed -n 's/.*"version": *"\([^"]*\)".*/\1/p' manifest.json | head -n 1)
out="zotero-pingwheel-$version.xpi"
rm -f "$out"
zip -r -X -9 -q "$out" manifest.json bootstrap.js pingwheel.js prefs.js prefs.xhtml icon.png icon@2x.png LICENSE README.md assets -x '*.DS_Store'
echo "Built $out"
