// Copia l'app web (la radice del repo, quella pubblicata su GitHub Pages) in app/www, che Capacitor impacchetta.
// Si copia solo quello che serve all'app: niente README, strumenti o la cartella app stessa.
import { cpSync, rmSync, mkdirSync } from 'node:fs';
const root = new URL('../../', import.meta.url);
const www = new URL('../www/', import.meta.url);
rmSync(www, { recursive: true, force: true });
mkdirSync(www);
for (const f of ['index.html', 'manifest.webmanifest', 'sw.js', 'css', 'js', 'icons', 'vendor']) {
  cpSync(new URL(f, root), new URL(f, www), { recursive: true });
}
console.log('app web copiata in app/www');
