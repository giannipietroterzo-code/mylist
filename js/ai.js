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
        model: settings.model || 'openrouter/auto',
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

export async function organize(text, lists, settings, currentList) {
  const now = new Date();
  const day = now.toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
  const names = lists.map((l) => `- ${l.name}`).join('\n');

  const system = `Sei il motore di una app di to-do list. Ricevi una frase scritta o dettata a voce (può contenere errori di trascrizione) e la trasformi in voci da fare.

Oggi è ${day} (${fmtDate(now)}).

Liste esistenti:
${names}

Lista attualmente aperta: ${currentList}

Regole:
1. Se la frase contiene più cose distinte (es. un elenco della spesa, o "devo fare X e poi Y") crea una voce per ciascuna. Se è un'unica attività, una sola voce.
2. Ogni voce: breve e chiara, iniziale maiuscola, senza punto finale, senza parole di servizio ("devo", "ricordami di", "aggiungi"). Mantieni nomi, numeri e dettagli utili. Correggi gli errori evidenti di dettatura.
3. "list": il nome ESATTO di una lista esistente che meglio si adatta (es. alimenti → lista della spesa). Se l'utente nomina esplicitamente una lista, usa quella. Se non c'è una lista adatta usa la lista attualmente aperta, oppure "Inbox". Inventa un nome nuovo SOLO se l'utente chiede esplicitamente una lista che non esiste.
4. "due": data in formato YYYY-MM-DD se viene indicato un giorno (oggi, domani, venerdì, il 12…), altrimenti null. Togli l'indicazione temporale dal testo.
5. "important": true solo se l'utente dice che è urgente/importante.

Rispondi SOLO con JSON valido, senza altro testo:
{"items":[{"text":"...","list":"...","due":null,"important":false}]}`;

  const { text: out } = await chat(settings, [
    { role: 'system', content: system },
    { role: 'user', content: text },
  ]);
  const obj = extractJSON(out);
  const items = Array.isArray(obj.items) ? obj.items : [];
  return items
    .filter((i) => i && typeof i.text === 'string' && i.text.trim())
    .map((i) => ({
      text: i.text.trim(),
      list: typeof i.list === 'string' ? i.list.trim() : '',
      due: /^\d{4}-\d{2}-\d{2}$/.test(i.due || '') ? i.due : null,
      important: !!i.important,
    }));
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
