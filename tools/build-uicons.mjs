// Crea vendor/uicons/uicons.css con le sole icone Flaticon UIcons usate dall'app.
// Uso: node tools/build-uicons.mjs   (scarica il CSS completo dal pacchetto ufficiale @flaticon/flaticon-uicons)
import { readFileSync, writeFileSync } from 'node:fs';

const VERSION = '3.3.1';
const BASE = `https://cdn.jsdelivr.net/npm/@flaticon/flaticon-uicons@${VERSION}`;
const dir = new URL('../', import.meta.url);

// Nomi usati: valori di MAP in icons.js + LIST_ICONS in store.js + default delle liste
const icons = readFileSync(new URL('js/icons.js', dir), 'utf8');
const store = readFileSync(new URL('js/store.js', dir), 'utf8');
const names = new Set(['clipboard-list']);
for (const m of icons.match(/const MAP = \{([\s\S]*?)\};/)[1].matchAll(/:\s*'([a-z0-9-]+)'/g)) names.add(m[1]);
for (const m of store.match(/LIST_ICONS = \[([\s\S]*?)\]/)[1].matchAll(/'([a-z0-9-]+)'/g)) names.add(m[1]);

const css = await (await fetch(`${BASE}/css/regular/rounded.css`)).text();
const rules = [];
const missing = [];
for (const n of [...names].sort()) {
  const m = css.match(new RegExp(`\\.fi-rr-${n}:before\\{content:"([^"]+)"\\}`));
  if (m) rules.push(`.fi-rr-${n}:before{content:"${m[1]}"}`);
  else missing.push(n);
}
const fontWoff2 = css.match(/url\(\.\.\/(uicons-regular-rounded-[A-Z0-9]+\.woff2)\)/)[1];
const font = await (await fetch(`${BASE}/css/${fontWoff2}`)).arrayBuffer();
writeFileSync(new URL('vendor/uicons/uicons-regular-rounded.woff2', dir), Buffer.from(font));

const out = `/* Flaticon UIcons ${VERSION} (regular rounded) — solo le icone usate da MyList. UIcons by Flaticon: https://www.flaticon.com/uicons */
@font-face{font-family:uicons-regular-rounded;src:url(uicons-regular-rounded.woff2) format("woff2");font-display:block}
i[class^=fi-rr-]:before,i[class*=" fi-rr-"]:before{font-family:uicons-regular-rounded!important;font-style:normal;font-weight:400!important;font-variant:normal;text-transform:none;line-height:1;-webkit-font-smoothing:antialiased;-moz-osx-font-smoothing:grayscale}
${rules.join('\n')}
`;
writeFileSync(new URL('vendor/uicons/uicons.css', dir), out);
console.log(`${rules.length} icone incluse${missing.length ? `, MANCANTI: ${missing.join(', ')}` : ''}`);
