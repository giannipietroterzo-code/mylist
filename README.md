# MyList ✓

To-do list per smartphone Android: inserimento rapido, dettatura vocale, liste separate e smistamento intelligente con AI (OpenRouter).
È una **PWA**: HTML/CSS/JS puri, niente build, niente server. Si installa sulla Home e funziona anche offline.

## Cosa fa

- **Inserimento lampo**: barra fissa in basso. Scrivi e premi Invio; il campo resta pronto per la voce successiva.
- **Dettatura con invio automatico**: con il campo vuoto il pulsante tondo è un microfono. Lo tocchi e parli: quando smetti, una barra si svuota e la nota parte da sola. Se ti fermi su una frase lasciata a metà ("compra il latte e…") aspetta di più. Pausa regolabile in Impostazioni (Breve / Normale / Lunga); "Invia ora" per non aspettare. Dopo l'invio si apre la lista dove è finita la nota, evidenziata.
- **Scorciatoia dalla Home**: tieni premuta l'icona di MyList e scegli **Detta**: si apre già in ascolto. Trascina **Detta** sulla Home per avere un'icona a sé: icona normale = liste, icona Detta = dettatura immediata (lo stesso con **Scrivi** per la tastiera).
- **Condividi verso MyList**: da qualunque app (Chrome, WhatsApp…) usa *Condividi → MyList* per trasformare un testo in una voce.
- **Liste** con emoji e colore (palette giallo/grigio). Le chip in alto filtrano; **Tutte** mostra tutto, raggruppato per lista oppure in un elenco unico.
- **Gestisci liste** (icona etichette in alto o da Impostazioni): rinomina, cambia colore, elimina. Ogni lista è eliminabile (ne resta sempre almeno una); se contiene voci scegli se eliminarle o spostarle in un'altra lista.
- **Spunta a voce**: di' o scrivi cosa hai già fatto ("ho preso le patate", "comprato il latte e il pane", "la lavatrice è fatta") e MyList spunta la voce corrispondente ("Prendere le patate") invece di crearne una nuova. Con l'AI capisce anche frasi miste ("ho preso le patate, devo comprare le uova"); senza AI funziona lo stesso con un riconoscimento locale. Se non trova niente da spuntare te lo dice e ti propone di aggiungerla.
- **Date, orari e promemoria**: *"Alle 16:00 devo prendere la pasticca, avvisami mezz'ora prima"* → voce "Prendere la pasticca" per le 16:00 con avviso alle 15:30. *"Ricordami tra 20 minuti di aprire il cancello"* → avviso tra 20 minuti. *"Domani devo comprare l'acqua"* → scadenza domani, nessun avviso. Capisce anche *stasera alle 9*, *lunedì*, *il 5 novembre*, *un'ora / un giorno prima*. Orario e avviso si cambiano anche toccando la voce.
- **Promemoria ricorrenti**: *"ogni giorno alle 8 prendere la pasticca"*, *"tutte le sere…"*, *"ogni lunedì e giovedì alle 19 palestra"*, *"il lunedì portare fuori la carta"*, *"dal lunedì al venerdì…"*, *"ogni 2 giorni…"*, *"ogni mese…"*. Quando la completi non sparisce: passa alla volta successiva. Con un orario avvisa da sola. Si imposta anche toccando la voce (Ripeti).
- **Note (appunti)**: la chip **Note** raccoglie idee, informazioni e cose da ricordare. Detta "prendi nota…", "appunto…", "segna che…" da qualunque lista, oppure parla libero: con l'AI capisce da sola se è un appunto o una cosa da fare (anche entrambi nella stessa frase). Nella sezione Note tutto quello che detti è un appunto, con una pausa più lunga prima dell'invio. Ogni appunto riceve un **titolo scritto dall'AI** in base al contenuto (se lo scrivi tu, non lo tocca). Si può copiare, condividere, eliminare con uno swipe a sinistra; se l'AI sbaglia, un tocco lo sposta tra Note e liste.
- **Idee**: "si potrebbe dipingere la porta di rosso", "magari…", "sarebbe bello…", "idea…" finiscono nelle Note come 💡 Idea (con l'AI anche senza queste parole, se l'azione è solo ipotizzata). Nelle Note il filtro Tutti · Idee · Appunti.
- **Cerca a voce**: "cerca il nome della clinica", "trova il codice del cancello", "qual era la password del wifi?". La ricerca guarda voci e appunti; con l'AI usa anche parole simili (clinica → veterinario, studio, ospedale) e **risponde in una frase** leggendo solo i risultati trovati. Se hai chiesto a voce, la risposta te la legge. Si chiude con la ×.
- **Gesti**: scorri a destra per completare, a sinistra per eliminare (basta anche una passata veloce, da qualunque punto della voce). C'è sempre **Annulla**.
- **Sintassi rapida** (anche senza AI):
  - `#spesa` → va nella lista Spesa
  - *oggi*, *domani*, *venerdì*, *il 5 novembre* → scadenza
  - *alle 16*, *tra 20 minuti*, *avvisami mezz'ora prima* → orario e avviso
  - *ogni giorno*, *il lunedì*, *dal lunedì al venerdì*, *ogni mese* → ricorrenza
  - *"nella lista lavoro …"* → funziona anche a voce
- **Smistamento AI** (opzionale): scrivi o detta una nota libera. L'AI capisce cosa vuoi fare e **dove metterla**: se lo dici ("mettilo nel lavoro", "per casa") usa quella lista, altrimenti sceglie lei la più adatta guardando anche cosa contiene già ogni lista. Più cose nella stessa nota diventano più voci, anche in liste diverse.
- Grafica piatta a tinta unita: tema chiaro (testata gialla su grigio), tre medi (Medio 1-2-3, grafite sempre più scura) e scuro (grafite e giallo), vibrazioni, animazioni, backup/ripristino in JSON.
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
3. **Modello**: tocca il campo e scegli tra i consigliati (Auto, Claude Haiku, GPT Luna, Gemini Flash Lite, DeepSeek Flash). L'elenco prende da OpenRouter la versione più recente di ogni famiglia e mostra il costo stimato al mese con circa 20 dettature al giorno: qualche decina di centesimi.
4. **Prova connessione** per verificare.
5. **Quando usarlo**: *Sempre* (default: testo scritto e dettato), *Solo dettatura* o *Mai*. Scrivere `#lista` salta l'AI e va dritto in quella lista.

Se l'AI non risponde, la voce viene aggiunta comunque, così com'è, nella lista corrente.

**IA di Chrome.** In Impostazioni → IA di Chrome vedi se il browser ce l'ha (presente, da scaricare, non utilizzabile, non presente), puoi scaricarla e provarla col pulsante *Prova l'IA di Chrome*. Con l'interruttore **Usala per prima** risponde lei (Gemini Nano, gratis e sul dispositivo) e OpenRouter resta di riserva se non ce la fa; da spenta non viene mai usata. Oggi esiste solo su Chrome per computer con hardware adeguato (Windows, macOS, Linux; tanta memoria e spazio libero). **Su Chrome per Android non è ancora disponibile.** L'italiano non è ancora tra le lingue ufficiali di Gemini Nano, quindi la qualità è inferiore a OpenRouter.

**Privacy**: liste e chiave restano solo nel `localStorage` del telefono. All'AI vengono inviati solo la nota, i nomi delle liste e le ultime voci di ciascuna (per capire a cosa serve ogni lista).

## Promemoria

Un'app web non può svegliarsi da sola a telefono in tasca, quindi ci sono due canali:

1. **Notifiche di MyList** (Impostazioni → Promemoria → *Attiva notifiche*): arrivano se l'app è aperta o in background da poco. All'apertura ti mostra comunque gli avvisi persi.
2. **Avvisi sicuri con ntfy** (consigliato): installa l'app gratuita [ntfy](https://play.google.com/store/apps/details?id=io.heckel.ntfy), poi in Impostazioni → Promemoria scegli *Con ntfy*, tocca **Collega** e **Prova**. MyList programma ogni avviso sul server ntfy.sh, che lo consegna all'ora giusta anche con MyList chiusa. Completare, eliminare o spostare una voce annulla o aggiorna il suo avviso. ntfy.sh accetta avvisi fino a 3 giorni avanti: quelli più lontani vengono programmati alle aperture successive. Il canale ha un nome casuale; il testo del promemoria passa dal server ntfy.sh. In ntfy attiva la *consegna istantanea* per evitare ritardi.

Sulla notifica di ntfy ci sono due tasti che funzionano **senza aprire MyList**:
- **Fatto**: lascia un messaggio nel canale privato `<canale>-fatto`; MyList lo legge quando la riapri (entro 12 ore, quanto ntfy.sh conserva i messaggi) e spunta la voce, o la passa alla volta successiva se è ricorrente.
- **+10 min**: il telefono riprogramma l'avviso su ntfy da solo (fino a 3 rinvii).

**Suono**: in Impostazioni → Promemoria scegli *Forte* (default: priorità massima di ntfy, suono e vibrazione lunga sopra le altre app; con l'app aperta un din-don ripetuto tre volte) o *Normale*. Per farlo suonare **finché non rispondi**: in ntfy, impostazioni del canale MyList → *Avvisi insistenti* (Insistent max priority). La suoneria si cambia da Android → App → ntfy → Notifiche → Priorità massima.

Le ricorrenti vengono programmate su ntfy per tutte le volte dei prossimi 3 giorni, così la pasticca suona anche se non apri MyList per un paio di giorni.

## Struttura

```
index.html              pagina unica
css/style.css           tutta la grafica (tema chiaro/scuro)
js/version.js           numero di versione (unico punto da cambiare)
js/app.js               UI, gesti, sheet, impostazioni
js/store.js             dati e salvataggio locale
js/voice.js             dettatura (Web Speech API)
js/ai.js                OpenRouter: smistamento, test, elenco modelli
js/when.js              date, orari e promemoria senza AI ("alle 16", "tra 20 minuti", "mezz'ora prima")
js/reminders.js         avvisi: notifiche locali + programmazione su ntfy
js/sound.js             din-don dei promemoria con l'app aperta (sintetizzato, nessun file)
sw.js                   service worker (offline)
manifest.webmanifest    installazione, scorciatoie, condivisione
icons/                  logo (onda vocale + spunta) e icone dell'app, disegnati a mano (rigenerabili con: node tools/make-icons.mjs)
vendor/uicons/          Flaticon UIcons: solo le icone usate (rigenera con: node tools/build-uicons.mjs)
```

## Sviluppo

```bash
python3 -m http.server 8790
```

Poi apri <http://localhost:8790>. Quando pubblichi una nuova versione, cambia il numero in `js/version.js` (es. `1.9` → `2.0`): compare accanto al titolo e fa scaricare ai telefoni i file aggiornati, che si ricaricano da soli.
