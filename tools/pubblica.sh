#!/bin/bash
# Pubblica una versione di MyList: sito (GitHub Pages) e app Android (GitHub Releases) insieme.
# Uso: tools/pubblica.sh "cosa è cambiato"
#   Prima: alza la versione in js/version.js e fai il commit delle modifiche.
#   1. manda il codice su main (il sito si aggiorna da solo)
#   2. compila l'APK firmato (app/scripts/build-apk.sh, chiave in ~/Lavori/MyList-firma)
#   3. crea la release vX.Y su GitHub con l'APK allegato
#   4. pubblica apk.json: le app installate lo leggono e mostrano "Aggiorna"
set -e
cd "$(dirname "$0")/.."
REPO=giannipietroterzo-code/mylist
VER=$(grep -o "'[0-9.]*'" js/version.js | tr -d "'")
NOTE=${1:-"MyList $VER"}
[ -z "$(git status --porcelain -- . ':!app/MyList-*.apk')" ] || { echo "Ci sono modifiche non committate: prima il commit."; exit 1; }
if gh release view "v$VER" -R $REPO >/dev/null 2>&1; then echo "La release v$VER esiste già: alza la versione in js/version.js."; exit 1; fi

git push -q origin main
app/scripts/build-apk.sh
gh release create "v$VER" "app/MyList-$VER.apk" -R $REPO --target main --title "MyList $VER" --notes "$NOTE"

URL="https://github.com/$REPO/releases/download/v$VER/MyList-$VER.apk"
python3 - "$VER" "$URL" "$NOTE" <<'PY'
import json, sys
v, url, notes = sys.argv[1:4]
open('apk.json', 'w').write(json.dumps({'version': v, 'url': url, 'notes': notes}, ensure_ascii=False, indent=2) + '\n')
PY
git add apk.json
git commit -q -m "apk.json: MyList $VER per Android" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -q origin main
echo "Pubblicata MyList $VER: sito, release v$VER e apk.json"
