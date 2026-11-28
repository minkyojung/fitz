#!/bin/bash
# Make the development copy of the book: dev-data/out/book.db and dev-data/out/pages/.
#
# The source is the translator's working folder and is only ever read: the database is opened read-only and
# copied with SQLite's .backup (never a file copy), page images are cloned with cp -c. See docs/data-contract.md.
#
#   scripts/dev-data.sh           make the copy if there is none
#   scripts/dev-data.sh --force   make it again, replacing the one there
#
# FITZ_SOURCE_OUT  the folder holding book.db and pages/ (default: the prototype's out/)
# FITZ_DEV_DATA    where the copy goes (default: dev-data/ in this repository)
set -euo pipefail

SRC="${FITZ_SOURCE_OUT:-/Users/williamjung/octave/workspaces/fitz/riga/out}"
DEST="${FITZ_DEV_DATA:-$(cd "$(dirname "$0")/.." && pwd)/dev-data}"
OUT="$DEST/out"
FORCE=0
case "${1:-}" in
  "") ;;
  --force) FORCE=1 ;;
  *) echo "usage: scripts/dev-data.sh [--force]" >&2; exit 2 ;;
esac

ro() { sqlite3 "file:$1?mode=ro" "$2"; }
tables() { ro "$1" "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name;"; }
counts() { for t in $(tables "$1"); do echo "$t $(ro "$1" "SELECT count(*) FROM \"$t\";")"; done; }
images() { find "$1" -type f | wc -l | tr -d ' '; }
summary() {
  echo "  chapters $(ro "$1" "SELECT count(*) FROM chapter;"), segments $(ro "$1" "SELECT count(*) FROM segment;")," \
    "translated $(ro "$1" "SELECT count(*) FROM segment WHERE target_doc IS NOT NULL;"), page images $(images "$(dirname "$1")/pages")"
}

if [ -f "$OUT/book.db" ] && [ -d "$OUT/pages" ] && [ "$FORCE" = 0 ]; then
  echo "dev data is already at $OUT (scripts/dev-data.sh --force makes it again)"
  summary "$OUT/book.db"
  exit 0
fi

[ -f "$SRC/book.db" ] || { echo "no book.db in $SRC (set FITZ_SOURCE_OUT)" >&2; exit 1; }
[ -d "$SRC/pages" ] || { echo "no pages/ in $SRC (set FITZ_SOURCE_OUT)" >&2; exit 1; }

# Built beside the place it will take, and moved in only once it has been checked.
NEW="$DEST/out.new"
rm -rf "$NEW"
mkdir -p "$NEW"
trap 'rm -rf "$NEW"' EXIT

before="$(shasum -a 256 "$SRC/book.db" | cut -d' ' -f1)"
ro "$SRC/book.db" ".backup '$NEW/book.db'"
cp -c -R "$SRC/pages" "$NEW/pages"

check="$(ro "$NEW/book.db" "PRAGMA integrity_check;")"
[ "$check" = "ok" ] || { echo "the copy failed its integrity check: $check" >&2; exit 1; }
# The translator may be writing to the source: a copy is only compared with a source that stood still meanwhile.
after="$(shasum -a 256 "$SRC/book.db" | cut -d' ' -f1)"
[ "$before" = "$after" ] || { echo "the source changed while it was being copied; run this again" >&2; exit 1; }
[ "$(counts "$SRC/book.db")" = "$(counts "$NEW/book.db")" ] || { echo "row counts differ between the source and the copy" >&2; exit 1; }
[ "$(images "$SRC/pages")" = "$(images "$NEW/pages")" ] || { echo "page image counts differ between the source and the copy" >&2; exit 1; }
missing="$(ro "$NEW/book.db" "SELECT image_path FROM page;" | while read -r p; do [ -f "$NEW/pages/$(basename "$p")" ] || echo "$p"; done)"
[ -z "$missing" ] || { echo "page images named in the database are missing: $missing" >&2; exit 1; }

rm -rf "$OUT"
mv "$NEW" "$OUT"
trap - EXIT
echo "dev data made at $OUT from $SRC"
summary "$OUT/book.db"
