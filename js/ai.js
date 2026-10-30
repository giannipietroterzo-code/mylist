// Integrazione OpenRouter: trasforma una frase libera in voci ordinate nelle liste giuste
const API = 'https://openrouter.ai/api/v1';

export const aiReady = (s) => !!(s.apiKey && s.apiKey.trim() && s.aiMode !== 'off');

async function chat(settings, messages, { timeout = 20000, maxTokens = 600 } = {}) {
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

const fmtDate = (d) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

// lists: [{ name, examples: [testi di voci già presenti] }] — gli esempi aiutano a capire a cosa serve ogni lista
// todo: [{ text, list }] voci ancora da fare, numerate nel prompt: l'AI indica quali risultano già fatte
// Risultato: { items: [{ text, list, due }], done: [indici in todo] }
export async function organize(text, lists, settings, { openList, fallback, todo = [] }) {
  const now = new Date();
  const day = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const names = lists
    .map((l) => `- ${l.name}${l.examples.length ? ` (contiene già: ${l.examples.map((e) => `"${e}"`).join(', ')})` : ''}`)
    .join('\n');
  const todoLines = todo.map((t, i) => `${i + 1}: ${t.text} [${t.list}]`).join('\n');

  const system = `Sei l'assistente di una app di to-do list. L'utente ti scrive o ti detta a voce una nota (può contenere errori di trascrizione). Il tuo compito: capire cosa vuole fare e DOVE vuole metterla.

Oggi è ${day} (${fmtDate(now)}).

Liste dell'utente:
${names}
${openList ? `\nL'utente in questo momento sta guardando la lista "${openList}".` : ''}

Voci ancora da fare (numero: testo [lista]):
${todoLines || '(nessuna)'}

COSE GIÀ FATTE: se l'utente dice di aver già fatto qualcosa ("ho preso le patate", "comprato il latte", "ho chiamato Marco", "fatto il bonifico", "la lavatrice è fatta", "spunta il pane"), NON creare una nuova voce: trova tra le voci da fare quella che corrisponde, anche se scritta con parole diverse ("ho preso le patate" = "Prendere le patate", "Comprare patate", "Patate"), e metti il suo numero in "done". Se nessuna voce corrisponde davvero, ignora quella parte (non inventare numeri). Una stessa nota può contenere sia cose fatte sia cose nuove da aggiungere.

Come decidere la lista ("list"):
A. Se l'utente indica dove metterla, anche in modo approssimativo o informale ("mettilo nel lavoro", "per casa", "nella spesa", "lista ufficio", "aggiungi a regali"), usa la lista esistente che corrisponde, anche se il nome non coincide esattamente.
B. Se chiede esplicitamente una lista che non esiste ("crea la lista viaggi", "nella lista palestra"), usa quel nuovo nome: verrà creata.
C. Se non lo specifica, scegli TU la lista esistente più adatta in base al significato della nota e a cosa contiene già ogni lista (es. alimenti e prodotti da comprare → spesa; clienti, riunioni, email → lavoro; riparazioni, bollette, pulizie → casa).
D. Solo se nessuna lista è davvero adatta usa "${openList || fallback}".
Le parole usate per indicare la lista ("mettilo in…", "nella lista…") NON vanno nel testo della voce.

Come scrivere le voci:
1. Le voci nuove vanno in "items". Se la nota contiene più cose distinte (un elenco della spesa, "devo fare X e poi Y") crea una voce per ciascuna; se è un'unica attività, una sola voce. Cose diverse possono andare in liste diverse.
2. Testo breve e chiaro, iniziale maiuscola, senza punto finale, senza parole di servizio ("devo", "ricordami di", "aggiungi"). Mantieni nomi, numeri, quantità e dettagli utili. Correggi gli errori evidenti di dettatura.
3. "due": data YYYY-MM-DD se viene indicato un giorno (oggi, domani, venerdì, il 12…), altrimenti null. Togli l'indicazione temporale dal testo.

Rispondi SOLO con JSON valido, senza altro testo:
{"items":[{"text":"...","list":"...","due":null}],"done":[]}`;

  const { text: out } = await chat(settings, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]);
  const obj = extractJSON(out);
  const items = (Array.isArray(obj.items) ? obj.items : [])
    .filter((i) => i && typeof i.text === 'string' && i.text.trim())
    .map((i) => ({
      text: i.text.trim(),
      list: typeof i.list === 'string' ? i.list.trim() : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(i.due || '') ? i.due : null,
    }));
  const done = [...new Set((Array.isArray(obj.done) ? obj.done : [])
    .map((n) => parseInt(n, 10) - 1)
    .filter((n) => n >= 0 && n < todo.length))];
  return { items, done };
}

export async function testConnection(settings) {
  const t0 = performance.now();
  const r = await chat(settings, [{ role: 'user', content: 'Rispondi solo con: OK' }], { timeout: 20000, maxTokens: 10 });
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
