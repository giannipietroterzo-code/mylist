# MyList ✓

To-do list per smartphone Android: inserimento rapido, dettatura vocale, liste separate e smistamento intelligente con AI (OpenRouter).
È una **PWA**: HTML/CSS/JS puri, niente build, niente server. Si installa sulla Home e funziona anche offline.

## Cosa fa

- **Inserimento lampo**: barra fissa in basso. Scrivi e premi Invio; il campo resta pronto per la voce successiva.
- **Dettatura**: con il campo vuoto il pulsante tondo è un microfono 🎙️. Lo tocchi, parli e la voce viene aggiunta.
- **Scorciatoia dalla Home**: tieni premuta l'icona di MyList e scegli **Detta**: si apre già in ascolto.
- **Condividi verso MyList**: da qualunque app (Chrome, WhatsApp…) usa *Condividi → MyList* per trasformare un testo in una voce.
- **Liste** con emoji e colore (palette giallo/grigio). Le chip in alto filtrano; **Tutte** mostra tutto, raggruppato per lista oppure in un elenco unico.
- **Gestisci liste** (icona etichette in alto o da Impostazioni): rinomina, cambia colore, elimina. Ogni lista è eliminabile (ne resta sempre almeno una); se contiene voci scegli se eliminarle o spostarle in un'altra lista.
- **Gesti**: scorri a destra per completare, a sinistra per eliminare. C'è sempre **Annulla**.
- **Sintassi rapida** (anche senza AI):
  - `#spesa` → va nella lista Spesa
  - *oggi*, *domani*, *dopodomani* → scadenza
  - *"nella lista lavoro …"* → funziona anche a voce
- **Smistamento AI** (opzionale): scrivi o detta una nota libera. L'AI capisce cosa vuoi fare e **dove metterla**: se lo dici ("mettilo nel lavoro", "per casa") usa quella lista, altrimenti sceglie lei la più adatta guardando anche cosa contiene già ogni lista. Più cose nella stessa nota diventano più voci, anche in liste diverse.
- Tema chiaro (testata gialla su grigio) e scuro (grafite e giallo), vibrazioni, animazioni, backup/ripristino in JSON.
- Icone: [UIcons by Flaticon](https://www.flaticon.com/uicons) (regular rounded), incluse nell'app per funzionare offline.

## Metterla sul telefono

Per l'installazione e per il microfono serve **HTTPS**. Il modo più rapido, gratis:

1. **Netlify Drop**: vai su <https://app.netlify.com/drop> e trascina l'intera cartella `MyList`. Ti dà subito un URL `https://…netlify.app`.
   In alternativa vanno bene GitHub Pages o Cloudflare Pages.
2. Sul telefono apri l'URL con **Chrome**.
3. Menu ⋮ → **Installa app** (oppure *Aggiungi a schermata Home*).
4. Al primo tocco sul microfono Chrome chiede il permesso: concedilo.

> Nota: la dettatura usa il riconoscimento vocale di Chrome, che lavora online. Senza rete puoi sempre usare il 🎙️ della tastiera (Gboard).

## Configurare OpenRouter

1. Crea una chiave su <https://openrouter.ai/keys> (consiglio: imposta un **limite di spesa** sulla chiave).
2. In MyList: ⚙️ **Impostazioni → Smistamento intelligente** → incolla la chiave.
3. **Modello**: tocca il campo e scegli dall'elenco (caricato in tempo reale da OpenRouter, con i prezzi). In cima ci sono i consigliati veloci ed economici; per questo compito basta un modello piccolo: costa frazioni di centesimo a voce.
4. **Prova connessione** per verificare.
5. **Quando usarlo**: *Sempre* (default: testo scritto e dettato), *Solo dettatura* o *Mai*. Scrivere `#lista` salta l'AI e va dritto in quella lista.

Se l'AI non risponde, la voce viene aggiunta comunque, così com'è, nella lista corrente.

**Privacy**: liste e chiave restano solo nel `localStorage` del telefono. All'AI vengono inviati solo la nota, i nomi delle liste e le ultime voci di ciascuna (per capire a cosa serve ogni lista).

## Struttura

```
index.html              pagina unica
css/style.css           tutta la grafica (tema chiaro/scuro)
js/app.js               UI, gesti, sheet, impostazioni
js/store.js             dati e salvataggio locale
js/voice.js             dettatura (Web Speech API)
js/ai.js                OpenRouter: smistamento, test, elenco modelli
sw.js                   service worker (offline)
manifest.webmanifest    installazione, scorciatoie, condivisione
icons/                  icone dell'app (rigenerabili con: node tools/make-icons.mjs)
vendor/uicons/          Flaticon UIcons: solo le icone usate (rigenera con: node tools/build-uicons.mjs)
```

## Sviluppo

```bash
python3 -m http.server 8790
```

Poi apri <http://localhost:8790>. Quando pubblichi una nuova versione, incrementa `CACHE` in `sw.js` (es. `mylist-v2`) così i telefoni scaricano i file aggiornati.
