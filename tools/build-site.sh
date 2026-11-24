#!/bin/sh
# Collects the public files into _site/ for deployment. Nothing is compiled or transformed:
# the deployed files are byte-for-byte the ones in the repository.
# Not published: tests/, tools/, img/ (source scans), node_modules/, dev config.
set -eu
cd "$(dirname "$0")/.."
rm -rf _site
mkdir _site
cp -R index.html 404.html favicon.svg robots.txt sitemap.xml _headers app guia landing locales shared templates why _site/
echo "Published files:"
find _site -type f | sort
