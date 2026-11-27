# MyList ✓

To-do list per smartphone Android: inserimento rapido, dettatura vocale, liste separate e smistamento intelligente con AI (OpenRouter).
È una **PWA**: HTML/CSS/JS puri, niente build, niente server. Si installa sulla Home e funziona anche offline.

## Cosa fa

- **Inserimento lampo**: barra fissa in basso. Scrivi e premi Invio; il campo resta pronto per la voce successiva.
- **Dettatura con invio automatico**: con il campo vuoto il pulsante tondo è un microfono. Lo tocchi e parli: quando smetti, una barra si svuota e la nota parte da sola. Se ti fermi su una frase lasciata a metà ("compra il latte e…") aspetta di più. Pausa regolabile in Impostazioni (Breve / Normale / Lunga); "Invia ora" per non aspettare. Dopo l'invio si apre la lista dove è finita la nota, evidenziata.
- **Scorciatoia dalla Home**: tieni premuta l'icona di MyList e scegli **Detta**: si apre già in ascolto. Trascina **Detta** sulla Home per avere un'icona a sé: icona normale = liste, icona Detta = dettatura immediata (lo stesso con **Scrivi** per la tastiera).
- **Condividi verso MyList**: da qualunque app (Chrome, WhatsApp…) usa *Condividi → MyList* per trasformare un testo in una voce.
- **Liste** con icona e colore: gialli, grigi e i toni morbidi *Natura* (salvia, eucalipto, azzurro polvere, terracotta, rosa argilla, oliva, lavanda, sabbia). Quando crei una lista, icona e colore si propongono da soli in base al nome ("Palestra" → manubrio verde salvia, "Viaggi" → aereo azzurro), finché non li scegli tu. Le chip in alto filtrano; **Tutte** mostra tutto, raggruppato per lista oppure in un elenco unico.
- **Gestisci liste** (icona etichette in alto o da Impostazioni): rinomina, cambia colore, elimina. Ogni lista è eliminabile (ne resta sempre almeno una); se contiene voci scegli se eliminarle o spostarle in un'altra lista.
- **Spunta a voce**: di' o scrivi cosa hai già fatto ("ho preso le patate", "comprato il latte e il pane", "la lavatrice è fatta") e MyList spunta la voce corrispondente ("Prendere le patate") invece di crearne una nuova. Con l'AI capisce anche frasi miste ("ho preso le patate, devo comprare le uova"); senza AI funziona lo stesso con un riconoscimento locale. Se non trova niente da spuntare te lo dice e ti propone di aggiungerla.
- **Date, orari e promemoria**: *"Alle 16:00 devo prendere la pasticca, avvisami mezz'ora prima"* → voce "Prendere la pasticca" per le 16:00 con avviso alle 15:30. *"Ricordami tra 20 minuti di aprire il cancello"* → avviso tra 20 minuti. *"Domani devo comprare l'acqua"* → scadenza domani, nessun avviso. Capisce anche *stasera alle 9*, *lunedì*, *il 5 novembre*, *un'ora / un giorno prima*. Orario e avviso si cambiano anche toccando la voce.
- **Promemoria ricorrenti**: *"ogni giorno alle 8 prendere la pasticca"*, *"tutte le sere…"*, *"ogni lunedì e giovedì alle 19 palestra"*, *"il lunedì portare fuori la carta"*, *"dal lunedì al venerdì…"*, *"ogni 2 giorni…"*, *"ogni mese…"*. Quando la completi non sparisce: passa alla volta successiva. Con un orario avvisa da sola. Si imposta anche toccando la voce (Ripeti).
- **Note (appunti)**: la chip **Note** raccoglie idee, informazioni e cose da ricordare. Detta "prendi nota…", "appunto…", "segna che…" da qualunque lista, oppure parla libero: con l'AI capisce da sola se è un appunto o una cosa da fare (anche entrambi nella stessa frase). Nella sezione Note tutto quello che detti è un appunto, con una pausa più lunga prima dell'invio. Ogni appunto riceve un **titolo scritto dall'AI** in base al contenuto (se lo scrivi tu, non lo tocca). Si può copiare, condividere, eliminare con uno swipe a sinistra; se l'AI sbaglia, un tocco lo sposta tra Note e liste.
- **Idee**: "si potrebbe dipingere la porta di rosso", "magari…", "sarebbe bello…", "idea…" finiscono nelle Note come 💡 Idea (con l'AI anche senza queste parole, se l'azione è solo ipotizzata). Nelle Note le schede Appunti · Idee.
- **Appunti eliminati**: gli appunti e le idee cancellati finiscono in *Eliminati di recente* (in fondo alle Impostazioni) e si possono ripristinare per **60 giorni**; poi spariscono da soli. Solo le note: le voci delle liste no.
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

## L'app Android vera

Oltre al sito c'è un APK, la stessa app impacchettata con Capacitor (cartella `app/`). In più del sito ha:
- **promemoria nativi**: suonano all'ora esatta anche ad app chiusa e dopo un riavvio, fino a 14 giorni avanti, con **Fatto** e **+10 min** sulla notifica, anche insistenti; il testo non esce dal telefono;
- **dettatura e voce di Android** al posto di quelle di Chrome (che nella WebView non ci sono);
- il **tasto indietro** che chiude quello che è aperto.

I dati dell'app sono separati da quelli del sito: si portano con Impostazioni → Esporta / Importa.

**Installare**: scarica l'APK dall'ultima [release](https://github.com/giannipietroterzo-code/mylist/releases/latest), aprilo sul telefono, consenti l'installazione da quella fonte e tocca Installa.

**Aggiornare**: all'apertura l'app controlla `apk.json` sul sito. Se c'è una versione nuova, la versione accanto al titolo diventa **↻ 1.32** e compare *Aggiorna*: il telefono scarica l'APK e chiede di installarlo sopra, i dati restano. Toccando la versione si controlla a mano.

**Firma**: ogni APK va firmato con la stessa chiave, che sta **fuori dal repo** in `~/Lavori/MyList-firma` (con `keystore.properties`). Va tenuta con una copia di sicurezza: se si perde, l'app installata non si aggiorna più e va reinstallata da zero.

## Configurare OpenRouter

1. Crea una chiave su <https://openrouter.ai/keys> (consiglio: imposta un **limite di spesa** sulla chiave).
2. In MyList: ⚙️ **Impostazioni → Smistamento intelligente** → incolla la chiave.
3. **Modello**: tocca il campo e scegli tra i consigliati (Auto, Claude Haiku, GPT Luna, Gemini Flash Lite, DeepSeek Flash). L'elenco prende da OpenRouter la versione più recente di ogni famiglia e mostra il costo stimato al mese con circa 20 dettature al giorno: qualche decina di centesimi.
4. **Prova connessione** per verificare.
5. **Quando usarlo**: *Solo dettatura* (default: quello che scrivi va dritto nella lista scelta nel box), *Sempre* (anche il testo scritto) o *Mai*. Scrivere `#lista` salta l'AI e va dritto in quella lista.

Se l'AI non risponde, la voce viene aggiunta comunque, così com'è, nella lista corrente.

**IA di Chrome.** In Impostazioni → IA di Chrome vedi se il browser ce l'ha (presente, da scaricare, non utilizzabile, non presente), puoi scaricarla e provarla col pulsante *Prova l'IA di Chrome*. Con l'interruttore **Usala per prima** risponde lei (Gemini Nano, gratis e sul dispositivo) e OpenRouter resta di riserva se non ce la fa. Senza chiave OpenRouter si attiva da sola, se il browser ce l'ha. Oggi esiste solo su Chrome per computer con hardware adeguato (Windows, macOS, Linux; tanta memoria e spazio libero). **Su Chrome per Android non è ancora disponibile.** L'italiano non è ancora tra le lingue ufficiali di Gemini Nano, quindi la qualità è inferiore a OpenRouter.

**Privacy**: liste e chiave restano solo nel `localStorage` del telefono. All'AI vengono inviati solo la nota, i nomi delle liste e le ultime voci di ciascuna (per capire a cosa serve ogni lista).

## Chiedi a Lisa (la chat)

Un assistente che conosce **tutto** quello che c'è in MyList: liste, voci (anche quelle fatte negli ultimi 30 giorni), appunti e idee. Si apre:
- toccando ✨ in alto: si apre a voce, già in ascolto (tenendolo premuto, la chat scritta);
- iniziando una frase col suo nome, scritta o dettata, da qualsiasi punto dell'app: *"Lisa, cosa devo fare oggi?"*, *"ehi Lisa, sposta il dentista a giovedì"*.

Il nome si cambia in Impostazioni → Smistamento intelligente → *Il nome del tuo assistente*.

**Cosa fa**
- **Risponde**: cosa c'è da fare, cosa è in ritardo o scade, cosa avevi scritto, riassunti delle idee. Le cose che cita diventano cartellini colorati: toccandoli si aprono.
- **Modifica**: aggiunge voci (con data, orario, avviso, ripetizione), le segna fatte, le sposta, le cambia, le elimina; crea e riscrive appunti e idee, trasforma un appunto in una cosa da fare.
  - **Fino a 3 modifiche, senza eliminazioni**: le fa subito; sotto la risposta compare cosa è cambiato, con **Annulla**.
  - **Più di 3, o se elimina qualcosa**: prima mostra l'anteprima, con **Applica** / **Scarta**.
  - L'Annulla vale finché l'app resta aperta e finché non cambi altro nel frattempo (altrimenti cancellerebbe anche quello).
- Ricorda la conversazione (ultime 60 battute) finché non tocchi **Nuova chat**.

**A voce, a mani libere** (come Mino in MyMind). È il modo di base: si apre toccando ✨, col pulsante **A voce** in testa alla chat o col microfono nella sua barra, e anche quando la chiami per nome dettando nel box. Al centro c'è il nucleo: il logo di MyList con intorno cinque linee sottili e morbide, gialle, che si intrecciano e si deformano piano.
- **ascolta**: le barre del logo e le linee seguono la voce; una linea punteggiata intorno si accorcia col tempo che resta prima che consideri finita la frase (2 secondi di silenzio, di più se resta in sospeso: *"compra il latte e…"*). «Ti ascolto» compare solo quando il microfono è davvero aperto;
- **pensa**: la spunta si ridisegna e le linee si stringono e girano svelte;
- **parla**: la spunta si accende e barre e linee pulsano. Legge una frase alla volta, e le voci di un elenco una per riga. Poi il microfono si riapre da solo; se non dici niente torna a riposo.
- Toccando il nucleo parli, la interrompi, o mandi subito quello che hai detto.
- Le modifiche si confermano a voce: dopo un'anteprima chiede *"Confermi?"* e basta dire **sì** o **no** (*"no, mettilo giovedì"* scarta e richiede). **Annulla** annulla l'ultima modifica, **basta** la mette a riposo.
- Nella riga in fondo puoi anche scriverle: allora risponde per iscritto. **Conversazione** torna alla chat scritta, con cartellini e Annulla.
- In testata si cambiano la voce (quelle italiane del telefono) e la velocità; toccandole senti una frase di prova.
- Se l'app va in sottofondo, microfono e voce si fermano; una risposta in arrivo resta scritta.
- Ascolto e voce sono quelli di Chrome (Web Speech): sul telefono le parole possono passare dai server Google, come nella dettatura.

**Serve l'IA via OpenRouter**: l'IA di Chrome è troppo piccola per tenere in testa tutto MyList, e su Android non c'è. **Privacy**: a ogni domanda tutto il contenuto di MyList (anche appunti e idee) va al modello scelto, tramite OpenRouter. Costo: dipende dal modello, di solito frazioni di centesimo a domanda.

## Promemoria

- **Nell'app Android** gli avvisi sono notifiche native: suonano all'ora esatta anche ad app chiusa e dopo un riavvio, programmate fino a 14 giorni avanti. Il testo non esce dal telefono. Sulla notifica ci sono **Fatto** (spunta la voce, o la passa alla volta dopo se è ricorrente) e **+10 min**.
- **Sul sito** sono notifiche del browser: arrivano solo con MyList aperta o in background da poco, perché un'app web non può svegliarsi da sola. All'apertura ti mostra comunque gli avvisi persi.

**Avvisi insistenti**: *"bonifico, ricordamelo ogni ora finché non l'ho fatto"*, *"chiamare Marco ogni mezz'ora finché non risponde"*, *"pagare la bolletta, insisti"*. Dopo il primo avviso ne arriva un altro ogni ora (o ogni quanto hai detto) finché non tocchi **Fatto**. Senza un momento, il primo arriva dopo il primo intervallo. Si capiscono scritti, dettati, dall'IA e da Lisa; nell'editor della voce c'è la riga **Insisti finché non è fatta** (una volta, ogni 15 min, ogni mezz'ora, ogni ora, ogni 2 ore). Nella lista la voce ha un'etichetta gialla «ogni ora». Nell'app Android se ne programmano 24 in anticipo per volta; le altre alle aperture successive.

**Suono**: in Impostazioni → Promemoria scegli *Forte* (con l'app aperta un din-don ripetuto tre volte e una vibrazione lunga) o *Normale*. Nell'app Android la suoneria della notifica si cambia da Impostazioni Android → App → MyList → Notifiche → Promemoria.

Fino alla 1.32 c'era anche **ntfy**: dalla 1.33 non serve più. Alla prima apertura MyList cancella da ntfy.sh gli avvisi che aveva già programmato e dimentica il canale; l'app ntfy si può disinstallare.

## Struttura

```
index.html              pagina unica
css/style.css           tutta la grafica (tema chiaro/scuro)
js/version.js           numero di versione (unico punto da cambiare)
js/app.js               UI, gesti, sheet, impostazioni
js/store.js             dati e salvataggio locale
js/voice.js             dettatura (Web Speech API)
js/ai.js                OpenRouter: smistamento, chat dell'assistente, test, elenco modelli
js/chat.js              la chat con l'assistente (Lisa): contesto, cartellini, modifiche con Annulla / Applica
js/talk.js              la chat a voce a mani libere: il nucleo che ascolta, pensa e parla
js/when.js              date, orari e promemoria senza AI ("alle 16", "tra 20 minuti", "mezz'ora prima")
js/reminders.js         avvisi: notifiche native (app Android) o del browser, avvisi insistenti
js/sound.js             din-don dei promemoria con l'app aperta (sintetizzato, nessun file)
js/native.js            solo nell'app Android: dettatura, voce, tasto indietro e aggiornamenti coi plugin nativi
sw.js                   service worker (offline)
manifest.webmanifest    installazione, scorciatoie, condivisione
app/                    l'app Android (Capacitor): scripts/build-apk.sh crea l'APK firmato
tools/pubblica.sh       pubblica sito + APK (GitHub Releases) + apk.json in un colpo
icons/                  logo (onda vocale + spunta) e icone dell'app, disegnati a mano (rigenerabili con: node tools/make-icons.mjs)
vendor/uicons/          Flaticon UIcons: solo le icone usate (rigenera con: node tools/build-uicons.mjs)
```

## Sviluppo

```bash
python3 -m http.server 8790
```

Poi apri <http://localhost:8790>. Quando pubblichi una nuova versione, cambia il numero in `js/version.js` (es. `1.9` → `2.0`): compare accanto al titolo e fa scaricare ai telefoni i file aggiornati, che si ricaricano da soli.

Per pubblicare anche l'app Android, dopo il commit: `tools/pubblica.sh "cosa è cambiato"` (manda il sito, compila l'APK firmato, crea la release e aggiorna `apk.json`). Serve Java 21 in `~/Library/Java/JavaVirtualMachines` e l'SDK Android in `~/Library/Android/sdk`.
