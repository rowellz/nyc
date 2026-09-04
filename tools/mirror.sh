#!/usr/bin/env bash
# Re-mirror the client + world data from the origin into public/.
#
# This is the script that produced public/. It is idempotent: existing, non-empty
# files are skipped, so re-running it only fetches what is missing. The origin
# rate-limits at high concurrency, hence the modest -P values and the retry pass.
#
#   usage: tools/mirror.sh [origin]
set -uo pipefail

ORIGIN="${1:-https://somethingbig.ai}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
PUB="$ROOT/public/world"
A="$PUB/assets"
UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36'

get() { # get <url-path> <dest>
  [ -s "$2" ] && return 0
  mkdir -p "$(dirname "$2")"
  local code
  code=$(curl -sS -A "$UA" -o "$2" -w '%{http_code}' "$ORIGIN$1" --max-time 90 2>/dev/null)
  if [ "$code" = "200" ] && [ -s "$2" ]; then return 0; fi
  rm -f "$2"; return 1
}
export -f get; export ORIGIN UA

echo "==> entry points"
get /world/ "$PUB/index.html"       && echo "  index.html"
get /world/safe.html "$PUB/safe.html" && echo "  safe.html"

echo "==> JS/CSS chunk closure"
# The entry bundle names its lazy chunks; each chunk may name more. Iterate to closure.
for round in 1 2 3 4 5 6; do
  new=0
  refs=$(grep -ohE 'assets/[A-Za-z0-9_.-]+\.(js|css|wasm|jpg|jpeg|png|webp|json|mp3|ogg|svg)' \
           "$PUB"/index.html "$A"/*.js "$A"/*.css 2>/dev/null | sed 's|assets/||' | sort -u)
  for f in $refs; do
    get "/world/assets/$f" "$A/$f" && { echo "  + $f"; new=$((new+1)); }
  done
  [ "$new" -eq 0 ] && break
done

echo "==> world index, areas, tiles"
get /world/world/index.json "$PUB/world/index.json" && echo "  index.json"
get /world/world/areas.json "$PUB/world/areas.json" && echo "  areas.json"
python3 -c "import json;print('\n'.join(json.load(open('$PUB/world/index.json'))['tiles']))" > /tmp/nyc-tiles.txt
echo "  $(wc -l < /tmp/nyc-tiles.txt) tiles listed"
tile() { get "/world/world/tiles/$1.json.gz" "$2/$1.json.gz"; }
export -f tile
for pass in 1 2 3 4 5; do
  missing=$(while read -r k; do [ -s "$PUB/world/tiles/$k.json.gz" ] || echo "$k"; done < /tmp/nyc-tiles.txt)
  n=$(echo "$missing" | grep -c . || true)
  echo "  pass $pass: $n missing"
  [ "$n" -eq 0 ] && break
  echo "$missing" | xargs -P 6 -I{} bash -c 'tile "$@"' _ {} "$PUB/world/tiles"
  sleep 2
done

echo "==> textures (desktop + mobile variants)"
get /world/assets/textures/manifest.json "$A/textures/manifest.json" && echo "  manifest.json"
python3 - "$A/textures/manifest.json" > /tmp/nyc-tex.txt <<'PY'
import json, sys
for e in json.load(open(sys.argv[1])):
    for f in e.get('files', {}).values():
        print(e['path'].rstrip('/') + '/' + f)
PY
tex() {
  for v in "$1" "${1/assets\/textures\//assets/textures-mobile/}"; do
    get "/world/$v" "$2/../$v"
  done
}
export -f tex
xargs -P 6 -I{} bash -c 'tex "$@"' _ {} "$A" < /tmp/nyc-tex.txt
echo "  desktop $(find "$A/textures" -name '*.jpg' | wc -l) / mobile $(find "$A/textures-mobile" -name '*.jpg' 2>/dev/null | wc -l)"

echo "==> character models"
for m in civilian-male civilian-female hair-simpleparted hair-buzzed hair-buzzedfemale hair-long hair-buns hair-beard; do
  get "/world/assets/characters/$m.glb" "$A/characters/$m.glb" && echo "  + $m.glb"
done

echo "==> web fonts (vendored for offline use)"
FONTCSS='https://fonts.googleapis.com/css2?family=Barlow+Condensed:wght@500;600;700;800&family=Inter:wght@400;500;600;700&display=swap'
if [ ! -s "$A/fonts/fonts.css" ]; then
  mkdir -p "$A/fonts"
  curl -sS -A "$UA" "$FONTCSS" -o "$A/fonts/fonts.css" --max-time 60
  grep -oE 'https://fonts.gstatic.com/[^)]+' "$A/fonts/fonts.css" | sort -u | while read -r u; do
    curl -sS -o "$A/fonts/$(basename "$u")" "$u" --max-time 60
  done
  python3 - "$A/fonts/fonts.css" <<'PY'
import re, sys
p = sys.argv[1]
s = open(p).read()
open(p, 'w').write(re.sub(r'https://fonts\.gstatic\.com/[^)]+/([^/)]+)', lambda m: m.group(1), s))
PY
  echo "  $(ls "$A"/fonts/*.woff2 | wc -l) woff2 files"
fi

echo "==> rewriting the font <link> to the local copy"
node "$ROOT/tools/patch-offline.js"

echo
echo "done. public/ is $(du -sh "$ROOT/public" | cut -f1)"
