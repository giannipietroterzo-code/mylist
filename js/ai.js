// Intelligenza artificiale di MyList: trasforma una frase libera in voci, appunti, ricerche.
// Due motori:
//  - OpenRouter, se c'è una chiave (modelli grandi, italiano ottimo)
//  - l'IA integrata in Chrome (Gemini Nano, gratis e sul dispositivo): se l'utente la attiva risponde
//    per prima e OpenRouter resta di riserva; senza chiave OpenRouter si attiva da sola, se c'è.
//    Oggi esiste solo su Chrome per computer con hardware adeguato; su Android non ancora.
const API = 'https://openrouter.ai/api/v1';

const hasKey = (s) => !!(s.apiKey && s.apiKey.trim());
// stato dell'IA di Chrome: none (il browser non ce l'ha) | unavailable | downloadable | downloading | available
export const chromeAI = { state: 'none', progress: 0 };

export async function detectChromeAI() {
  try {
    chromeAI.state = 'LanguageModel' in self ? await self.LanguageModel.availability() : 'none';
  } catch (err) { chromeAI.state = 'unavailable'; }
  return chromeAI.state;
}

// Il primo uso scarica il modello (serve un tocco dell'utente): onProgress(0..1)
export async function downloadChromeAI(onProgress) {
  chromeAI.state = 'downloading';
  const session = await self.LanguageModel.create({
    monitor(m) { m.addEventListener('downloadprogress', (e) => { chromeAI.progress = e.loaded; onProgress?.(e.loaded); }); },
  });
  session.destroy?.();
  chromeAI.state = 'available';
}

export const chromeAuto = (s) => !hasKey(s) && chromeAI.state === 'available'; // accesa da sola: manca la chiave
const chromeOn = (s) => (!!s.chromeAI || !hasKey(s)) && chromeAI.state === 'available';
// Quale motore risponde per primo: 'chrome' | 'openrouter' | null
export const aiSource = (s) => (s.aiMode === 'off' ? null : chromeOn(s) ? 'chrome' : hasKey(s) ? 'openrouter' : null);
export const aiReady = (s) => !!aiSource(s);

async function chat(settings, messages, opts = {}) {
  const first = aiSource(settings);
  const backup = first === 'chrome' ? (hasKey(settings) ? 'openrouter' : null) : chromeOn(settings) ? 'chrome' : null;
  const run = (engine) => (engine === 'chrome' ? chatChrome(messages, opts) : chatOpenRouter(settings, messages, opts));
  try {
    return await run(first);
  } catch (err) {
    // il primo motore non risponde: se c'è, prova con l'altro
    if (backup) return run(backup);
    throw err;
  }
}

async function chatChrome(messages, { timeout = 20000 } = {}) {
  const ctrl = new AbortController();
  // il modello sul dispositivo è più lento: un po' più di pazienza
  const t = setTimeout(() => ctrl.abort(), timeout * 2);
  let session;
  try {
    const sys = messages.filter((m) => m.role === 'system').map((m) => m.content).join('\n\n');
    const user = messages.filter((m) => m.role !== 'system').map((m) => m.content).join('\n\n');
    session = await self.LanguageModel.create({ initialPrompts: sys ? [{ role: 'system', content: sys }] : [], signal: ctrl.signal });
    const text = await session.prompt(user, { signal: ctrl.signal });
    if (!text) throw new Error('Risposta vuota dall\'IA di Chrome');
    return { text, model: 'IA di Chrome (Gemini Nano)' };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('L\'IA di Chrome ci mette troppo, riprova');
    throw e;
  } finally {
    clearTimeout(t);
    session?.destroy?.();
  }
}

async function chatOpenRouter(settings, messages, { timeout = 20000, maxTokens = 600 } = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), timeout);
  try {
    const res = await fetch(`${API}/chat/completions`, {
      method: 'POST',
      signal: ctrl.signal,
      headers: {
        Authorization: `Bearer ${settings.apiKey.trim()}`,
        'Content-Type': 'application/json',
        'HTTP-Referer': location.origin,
        'X-Title': 'MyList',
      },
      body: JSON.stringify({
        // le varianti :batch non rispondono in tempo reale: usa sempre il modello normale
        model: (settings.model || 'openrouter/auto').replace(/:batch$/, ''),
        messages,
        temperature: 0,
        max_tokens: maxTokens,
      }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message || `Errore ${res.status}`);
    const msg = body?.choices?.[0]?.message?.content;
    if (!msg) throw new Error('Risposta vuota dal modello');
    return { text: msg, model: body.model };
  } catch (e) {
    if (e.name === 'AbortError') throw new Error('Il modello ci mette troppo, riprova');
    throw e;
  } finally {
    clearTimeout(t);
  }
}

function extractJSON(text) {
  const clean = text.replace(/```(?:json)?/gi, '').trim();
  const start = clean.indexOf('{');
  const end = clean.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('Il modello non ha risposto in JSON');
  return JSON.parse(clean.slice(start, end + 1));
}

// minuti dal JSON del modello: numero intero o null
const mins = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.round(+v));

function cleanRepeat(r) {
  if (!r || !['day', 'week', 'month'].includes(r.every)) return null;
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [];
  return { every: r.every, n: Math.max(1, mins(r.n) || 1), days: r.every === 'week' && days.length ? days : null };
}

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// lists: [{ name, examples: [testi di voci già presenti] }] — gli esempi aiutano a capire a cosa serve ogni lista
// todo: [{ text, list }] voci ancora da fare, numerate nel prompt: l'AI indica quali risultano già fatte
// Risultato: { items: [{ text, list, due, time, in, remind, repeat }], done: [indici in todo], notes: [{ title, text, idea }], search: { query, keywords } | null }
export async function organize(text, lists, settings, { openList, fallback, todo = [], inNotes = false }) {
  const now = new Date();
  const hm = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
  const day = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const names = lists
    .map((l) => `- ${l.name}${l.examples.length ? ` (contiene già: ${l.examples.map((e) => `"${e}"`).join(', ')})` : ''}`)
    .join('\n');
  const todoLines = todo.map((t, i) => `${i + 1}: ${t.text} [${t.list}]`).join('\n');

  const system = `Sei l'assistente di una app di cose da fare e di appunti. L'utente ti scrive o ti detta a voce una frase (può contenere errori di trascrizione).

PRIMA DI TUTTO decidi di che tipo è ogni parte della frase:
- APPUNTO ("notes"): descrive come stanno le cose, un dato o un'informazione da conservare, SENZA chiedere di fare qualcosa. Vale anche senza "prendi nota": "il codice del garage è 123123", "la password del wifi è pippo123", "il PIN della carta è 4455", "la targa della macchina è AB123CD", "il dentista si chiama Rossi", "il numero dell'idraulico è 333 1234567", "l'indirizzo di Luca è via Roma 3", "Marco ha detto che il preventivo arriva a fine mese", "idea per il regalo di Anna: un corso di ceramica".
- IDEA ("notes" con "idea": true): una proposta o un'ipotesi, non un impegno preso. Si riconosce dal condizionale o dal tono possibilista: "si potrebbe dipingere la porta di rosso", "potremmo andare in Portogallo quest'estate", "sarebbe bello fare un orto", "magari regalo a Luca una bici", "e se aprissi un blog?", "mi piacerebbe imparare il piano", "perché non cambiamo il divano", "idea: …". Anche se contiene un verbo d'azione NON è una cosa da fare.
- COSA DA FARE ("items"): c'è un'azione da compiere ("comprare il latte", "devo chiamare il tecnico", "cambiare il codice del garage", "ricordami di pagare la bolletta").
- RICERCA ("search"): vuole ritrovare qualcosa che ha già salvato.
- COSA GIÀ FATTA ("done"): dice di aver fatto qualcosa che era da fare.
Nel dubbio fra appunto e cosa da fare chiediti: c'è un verbo d'azione da spuntare? Se no, è un appunto. Se l'azione è solo ipotizzata ("si potrebbe", "magari", "sarebbe bello"), è un'idea.

Oggi è ${day} (${fmtDate(now)}), sono le ${hm}.

Liste dell'utente:
${names}
${openList ? `\nL'utente in questo momento sta guardando la lista "${openList}".` : ''}

Voci ancora da fare (numero: testo [lista]):
${todoLines || '(nessuna)'}

COSE GIÀ FATTE: se l'utente dice di aver già fatto qualcosa ("ho preso le patate", "comprato il latte", "ho chiamato Marco", "fatto il bonifico", "la lavatrice è fatta", "spunta il pane"), NON creare una nuova voce: trova tra le voci da fare quella che corrisponde, anche se scritta con parole diverse ("ho preso le patate" = "Prendere le patate", "Comprare patate", "Patate"), e metti il suo numero in "done". Se nessuna voce corrisponde davvero, ignora quella parte (non inventare numeri). Una stessa nota può contenere sia cose fatte sia cose nuove da aggiungere.

RICERCA: se l'utente vuole TROVARE o RICORDARE qualcosa che ha già salvato ("cerca il nome della clinica", "trova il codice del cancello", "dov'è il numero dell'idraulico", "qual era la password del wifi?", "come si chiamava il ristorante che mi hanno consigliato?", "mostrami le cose della spesa") NON creare voci né appunti: metti in "search" {"query": la domanda riformulata in breve, "keywords": 3-8 parole chiave in minuscolo, al singolare, comprese parole simili e sinonimi utili a trovarla (es. clinica → ["clinica","ospedale","veterinario","studio","medico","dottore"])}. Attenzione: "cercare un idraulico" o "devo cercare casa" sono cose da FARE, non ricerche. Se non è una ricerca, "search" è null.

APPUNTI: non tutto è una cosa da fare. Un'informazione da conservare, un dato (codici, password, PIN, numeri di telefono, indirizzi, nomi, targhe, misure), un'idea, un pensiero, il riassunto di una telefonata o di una riunione va in "notes" e NON in "items", anche se l'utente non dice "prendi nota". Un appunto non ha un'azione da spuntare. Se invece c'è un'azione da compiere ("devo", "comprare", "chiamare", "ricordami di") è una voce in "items". Una stessa frase può contenere entrambi.
Per ogni appunto: "idea" true se è un'idea, altrimenti false; "title" breve (2-5 parole, iniziale maiuscola, senza punto) e "text" con TUTTO il contenuto dettato, fedele, con punteggiatura e maiuscole corrette e gli errori di trascrizione evidenti sistemati; dividilo in paragrafi (\\n) se è lungo. Non riassumere e non inventare. Togli solo le parole di servizio iniziali ("prendi nota", "appunto", "annota che").
${inNotes ? '\nL\'utente è nella sezione NOTE: tutto quello che detta è un appunto (metti tutto in "notes"), a meno che non dica esplicitamente di aggiungere una cosa da fare.\n' : ''}
Come decidere la lista ("list"):
A. Se l'utente indica dove metterla, anche in modo approssimativo o informale ("mettilo nel lavoro", "per casa", "nella spesa", "lista ufficio", "aggiungi a regali"), usa la lista esistente che corrisponde, anche se il nome non coincide esattamente.
B. Se chiede esplicitamente una lista che non esiste ("crea la lista viaggi", "nella lista palestra"), usa quel nuovo nome: verrà creata.
C. Se non lo specifica, scegli TU la lista esistente più adatta in base al significato della nota e a cosa contiene già ogni lista (es. alimenti e prodotti da comprare → spesa; clienti, riunioni, email → lavoro; riparazioni, bollette, pulizie → casa).
D. Solo se nessuna lista è davvero adatta usa "${openList || fallback}".
Le parole usate per indicare la lista ("mettilo in…", "nella lista…") NON vanno nel testo della voce.

Come scrivere le voci:
1. Le voci nuove vanno in "items". Se la nota contiene più cose distinte (un elenco della spesa, "devo fare X e poi Y") crea una voce per ciascuna; se è un'unica attività, una sola voce. Cose diverse possono andare in liste diverse.
2. Testo breve e chiaro, iniziale maiuscola, senza punto finale, senza parole di servizio ("devo", "ricordami di", "aggiungi"). Mantieni nomi, numeri, quantità e dettagli utili. Correggi gli errori evidenti di dettatura.
3. "due": data YYYY-MM-DD se viene indicato un giorno (oggi, domani, venerdì, il 12…), altrimenti null.
4. "time": orario HH:MM (24 ore) se viene indicato un'ora precisa ("alle 16" → "16:00", "alle 4 del pomeriggio" → "16:00", "stasera alle 9" → "21:00", "a mezzogiorno" → "12:00"), altrimenti null. Se c'è l'orario ma non il giorno, lascia "due" null: lo calcola l'app.
5. "in": se il momento è relativo ("tra 20 minuti" → 20, "fra un'ora" → 60, "tra un quarto d'ora" → 15) metti i minuti da adesso e lascia "due" e "time" null; altrimenti null.
6. "remind": l'utente vuole essere AVVISATO? Metti quanti minuti PRIMA del momento indicato ("avvisami mezz'ora prima" → 30, "un'ora prima" → 60, "il giorno prima" → 1440, "avvisami alle 16" o "ricordami tra 20 minuti" → 0). Con "in" l'avviso è sempre implicito: 0. Se chiede di essere avvisato per un giorno senza orario ("ricordami domani di…") metti "time" "09:00" e "remind" 0. Se non chiede un avviso: null. "Ricordami di X" senza nessun giorno né orario NON è un avviso: null.
7. "repeat": se è una cosa che si ripete ("ogni giorno", "tutte le sere", "il lunedì", "ogni lunedì e giovedì", "dal lunedì al venerdì", "ogni 2 giorni", "ogni mese") metti {"every":"day"|"week"|"month","n":1,"days":null}. Per giorni precisi della settimana usa "week" con "days" (0=domenica, 1=lunedì … 6=sabato), es. lunedì e giovedì → {"every":"week","n":1,"days":[1,4]}; "ogni 2 giorni" → {"every":"day","n":2,"days":null}. "due" = la prima volta (se non è chiaro lascia null). Una ricorrenza con un orario ("ogni giorno alle 8 prendere la pasticca") è un promemoria: "remind" 0 se non viene indicato un anticipo. "ogni mattina" senza orario → "08:00", "ogni sera" → "20:00". Altrimenti "repeat" null.
Togli sempre dal testo le indicazioni di giorno, orario, ricorrenza e avviso ("domani", "alle 16", "avvisami mezz'ora prima", "tra 20 minuti").

Esempi di risposta:
- "il codice del garage è 123123" → {"items":[],"done":[],"notes":[{"idea":false,"title":"Codice del garage","text":"Il codice del garage è 123123."}],"search":null}
- "si potrebbe dipingere la porta di rosso" → {"items":[],"done":[],"notes":[{"idea":true,"title":"Porta rossa","text":"Si potrebbe dipingere la porta di rosso."}],"search":null}
- "comprare il latte" → {"items":[{"text":"Comprare il latte","list":"(la lista adatta)","due":null,"time":null,"in":null,"remind":null,"repeat":null}],"done":[],"notes":[],"search":null}
- "la password del wifi è pippo123 e domani devo chiamare il tecnico" → un appunto in "notes" ("Password del wifi") e una voce in "items" ("Chiamare il tecnico", due domani).

Rispondi SOLO con JSON valido, senza altro testo:
{"items":[{"text":"...","list":"...","due":null,"time":null,"in":null,"remind":null,"repeat":null}],"done":[],"notes":[],"search":null}`;

  const { text: out } = await chat(settings, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ], { maxTokens: 1500 });
  const obj = extractJSON(out);
  const items = (Array.isArray(obj.items) ? obj.items : [])
    .filter((i) => i && typeof i.text === 'string' && i.text.trim())
    .map((i) => ({
      text: i.text.trim(),
      list: typeof i.list === 'string' ? i.list.trim() : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(i.due || '') ? i.due : null,
      time: /^\d{1,2}:\d{2}$/.test(i.time || '') ? i.time.padStart(5, '0') : null,
      in: mins(i.in) > 0 ? mins(i.in) : null,
      remind: mins(i.remind) != null && mins(i.remind) >= 0 ? mins(i.remind) : null,
      repeat: cleanRepeat(i.repeat),
    }));
  const done = [...new Set((Array.isArray(obj.done) ? obj.done : [])
    .map((n) => parseInt(n, 10) - 1)
    .filter((n) => n >= 0 && n < todo.length))];
  const notes = (Array.isArray(obj.notes) ? obj.notes : [])
    .filter((n) => n && typeof n.text === 'string' && n.text.trim())
    .map((n) => ({ title: typeof n.title === 'string' ? n.title.trim().slice(0, 80) : '', text: n.text.trim(), idea: n.idea === true }));
  const sq = obj.search && typeof obj.search === 'object' && typeof obj.search.query === 'string' && obj.search.query.trim() ? obj.search : null;
  const search = sq ? {
    query: sq.query.trim(),
    keywords: (Array.isArray(sq.keywords) ? sq.keywords : []).filter((k) => typeof k === 'string' && k.trim()).map((k) => k.trim().toLowerCase()).slice(0, 10),
  } : null;
  return { items, done, notes, search };
}

// Risponde a una domanda usando SOLO le voci e gli appunti trovati.
// Risultato: { text, source } (source = indice in docs da cui viene la risposta) oppure null se lì non c'è
export async function answer(question, docs, settings) {
  const ctx = docs.map((d, i) => `[${i + 1}] (${d.kind}) ${d.text}`).join('\n');
  const system = `Sei l'assistente di una app di to-do list e appunti. L'utente cerca un'informazione tra le cose che ha salvato. Rispondi in italiano, in modo diretto e breve (al massimo 2 frasi), usando SOLO le informazioni qui sotto: non inventare nulla.

Cose salvate dall'utente:
${ctx}

Rispondi SOLO con JSON: {"answer":"...","source":N} dove N è il numero tra parentesi quadre della cosa da cui hai preso la risposta. Se l'informazione non c'è: {"answer":null,"source":null}`;
  const { text } = await chat(settings, [{ role: 'system', content: system }, { role: 'user', content: question }], { maxTokens: 250, timeout: 15000 });
  let obj;
  try { obj = extractJSON(text); } catch (err) { obj = { answer: text.trim(), source: null }; } // modello che non rispetta il JSON: tieni il testo
  const t = typeof obj.answer === 'string' ? obj.answer.trim() : '';
  if (!t || /^null\.?$/i.test(t)) return null;
  const n = parseInt(obj.source, 10) - 1;
  return { text: t, source: n >= 0 && n < docs.length ? n : null };
}

// Titolo breve per un appunto, scritto in base al contenuto
export async function makeTitle(text, settings) {
  const system = `Dai un titolo a questo appunto: 2-5 parole in italiano, che dicano di cosa parla (es. "Password Wi-Fi di casa", "Preventivo di Marco", "Regalo per Anna"). Iniziale maiuscola, niente punto finale, niente virgolette. Rispondi SOLO con il titolo.`;
  const { text: t } = await chat(settings, [{ role: 'system', content: system }, { role: 'user', content: text.slice(0, 1500) }], { maxTokens: 30, timeout: 15000 });
  return t.trim().split('\n')[0].replace(/^["“'«]+|["”'».]+$/g, '').trim().slice(0, 60);
}

// engine: 'openrouter' | 'chrome' — prova quel motore e solo quello
export async function testConnection(settings, engine = 'openrouter') {
  const t0 = performance.now();
  const msg = [{ role: 'user', content: 'Rispondi solo con: OK' }];
  const r = engine === 'chrome' ? await chatChrome(msg) : await chatOpenRouter(settings, msg, { timeout: 20000, maxTokens: 10 });
  return { ms: Math.round(performance.now() - t0), model: r.model, reply: r.text.trim() };
}

let modelsCache = null;
export async function listModels() {
  if (modelsCache) return modelsCache;
  const res = await fetch(`${API}/models`);
  if (!res.ok) throw new Error('Impossibile caricare i modelli');
  const body = await res.json();
  modelsCache = (body.data || []).map((m) => ({
    id: m.id,
    name: m.name || m.id,
    created: m.created || 0,
    prompt: parseFloat(m.pricing?.prompt || '0') * 1e6,
    completion: parseFloat(m.pricing?.completion || '0') * 1e6,
    ctx: m.context_length || 0,
  }));
  return modelsCache;
}
