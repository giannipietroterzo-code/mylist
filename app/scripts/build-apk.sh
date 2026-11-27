#!/bin/bash
# Crea l'APK di MyList: copia l'app web, la passa ad Android e compila.
# Uso: app/scripts/build-apk.sh   → l'APK firmato finisce in app/MyList-<versione>.apk
# La firma usa la chiave in ~/Lavori/MyList-firma (fuori dal repo): senza, si ferma.
set -e
cd "$(dirname "$0")/.."
FIRMA=~/Lavori/MyList-firma/keystore.properties
[ -f "$FIRMA" ] || { echo "Manca la chiave di firma: $FIRMA"; exit 1; }
export JAVA_HOME="${JAVA_HOME:-$(ls -d ~/Library/Java/JavaVirtualMachines/jdk-21*/Contents/Home | head -1)}"
VER=$(grep -o "'[0-9.]*'" ../js/version.js | tr -d "'")
# la versione dell'APK segue quella dell'app web: 1.31 → versionCode 1031, 2.0 → 2000 (deve solo crescere)
CODE=$(( ${VER%%.*} * 1000 + 10#${VER#*.} ))
sed -i '' -E "s/versionCode [0-9]+/versionCode $CODE/; s/versionName \"[^\"]*\"/versionName \"$VER\"/" android/app/build.gradle
[ -f android/local.properties ] || echo "sdk.dir=$HOME/Library/Android/sdk" > android/local.properties
npm run sync --silent
(cd android && ./gradlew assembleRelease --console=plain -q)
cp android/app/build/outputs/apk/release/app-release.apk "MyList-$VER.apk"
echo "Pronto: app/MyList-$VER.apk"
