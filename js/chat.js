// Chiedi all'assistente (di base "Lisa"): una chat con l'IA su tutto quello che c'è in MyList.
// Legge liste, voci, appunti e idee; risponde citando le cose ([V3] → cartellino toccabile) e le modifica.
// Fino a 3 cose toccate (senza eliminazioni) le modifiche partono subito, con Annulla;
// se sono di più, o se elimina qualcosa, prima mostra l'anteprima con Applica / Scarta.
import { icon, listIcon } from './icons.js';
import { data, settings, saveData, snapshot, uid, findListByName, nextColor, suggestStyle, trashNote } from './store.js';
import { aiReady, converse } from './ai.js';
import { dayKey, hhmm, dayFor, firstDue, remindAt, repeatLabel, nagLabel, fromNow } from './when.js';
import { settle } from './reminders.js';
import { voiceSupported } from './voice.js';
import { openTalk, closeTalk, talkOpen, initTalk } from './talk.js';

const KEY = 'mylist.chat.v1';
const SMALL = 3; // modifiche che partono senza chiedere
export const DEFAULT_NAME = 'Lisa';
export const aiName = () => (settings.aiName || '').trim() || DEFAULT_NAME;
const SUGGEST = ['Cosa devo fare oggi?', 'Cosa è in ritardo?', 'Cosa scade questa settimana?', 'Riassumi le mie idee'];
const DAYS = ['domenica', 'lunedì', 'martedì', 'mercoledì', 'giovedì', 'venerdì', 'sabato'];

const $ = (s, el = document) => el.querySelector(s);
let app = {}; // funzioni dell'app (render, complete, editItem…), passate da initChat
// n: contatore dei riferimenti; refs: { id: 'V3' } stabili per tutta la chat; msgs: la conversazione
let st = load();
const undos = new Map(); // id messaggio → { restore, after }: l'Annulla vale solo finché l'app resta aperta
let busy = false;
let queue = Promise.resolve(); // una domanda alla volta: chi arriva dopo aspetta la risposta di prima

function load() {
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (s && Array.isArray(s.msgs) && s.refs) return s;
  } catch (err) { /* chat rovinata: si riparte */ }
  return { n: 0, refs: {}, msgs: [] };
}
function persist() {
  st.msgs = st.msgs.slice(-60);
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (err) { /* spazio pieno: la chat resta in memoria */ }
}

// ---------- Riferimenti: V = voce, N = appunto o idea ----------
function refOf(kind, id) {
  if (!st.refs[id]) st.refs[id] = kind + ++st.n;
  return st.refs[id];
}
function byRef(ref) {
  const r = String(ref || '').toUpperCase().replace(/[^VN0-9]/g, '');
  const id = Object.keys(st.refs).find((k) => st.refs[k] === r);
  if (!id) return null;
  // un appunto diventato voce tiene il suo id: si cerca in tutte e due
  const it = data.items.find((i) => i.id === id);
  if (it) return { type: 'item', it };
  const n = data.notes.find((x) => x.id === id);
  return n ? { type: 'note', n } : null;
}

// ---------- Tutto MyList in testo, per il modello ----------
const clip = (t, max) => (t.length > max ? t.slice(0, max) + '…' : t);
const noteName = (n) => n.title || clip(n.text.split('\n')[0], 60);
function whenOf(it) {
  if (!it.due) return '';
  const today = dayKey(new Date());
  let s = ` · scade ${DAYS[new Date(it.due + 'T12:00:00').getDay()]} ${it.due}${it.time ? ` alle ${it.time}` : ''}`;
  if (!it.done && (it.due < today || (it.due === today && it.time && it.time < hhmm(new Date())))) s += ' (IN RITARDO)';
  if (remindAt(it) != null) s += ` · avviso ${it.remind ? `${it.remind} min prima` : "all'ora"}`;
  if (it.repeat) s += ` · si ripete: ${repeatLabel(it.repeat).toLowerCase()}`;
  if (it.nag && remindAt(it) != null) s += ` · avviso insistente ${nagLabel(it.nag)} finché non è fatta`;
  return s;
}
function context() {
  const open = data.items.filter((i) => !i.done);
  const due = (i) => `${i.due || '9999'} ${i.time || '99:99'}`;
  const lists = data.lists.map((l) => {
    const its = open.filter((i) => app.listOf(i).id === l.id).sort((a, b) => (due(a) < due(b) ? -1 : due(a) > due(b) ? 1 : 0));
    return `## ${l.name}\n${its.length ? its.map((i) => `[${refOf('V', i.id)}] ${clip(i.text, 300)}${whenOf(i)}`).join('\n') : '(niente da fare)'}`;
  });
  const since = Date.now() - 30 * 864e5;
  const done = data.items.filter((i) => i.done && (i.doneAt || 0) > since).sort((a, b) => b.doneAt - a.doneAt).slice(0, 60);
  let budget = 90000; // gli appunti più recenti entrano tutti; se sono tantissimi, i più vecchi restano fuori
  const noteLine = (n) => {
    const body = clip(n.text, 2500).replace(/\s*\n+\s*/g, ' / ');
    budget -= body.length;
    return budget > 0 ? `[${refOf('N', n.id)}] ${n.title ? n.title + ': ' : ''}${body} (scritto il ${dayKey(new Date(n.createdAt))})` : null;
  };
  const notes = data.notes.filter((n) => !n.idea).map(noteLine).filter(Boolean);
  const ideas = data.notes.filter((n) => n.idea).map(noteLine).filter(Boolean);
  return [
    `LISTE: ${data.lists.map((l) => l.name).join(', ')}`,
    `\nCOSE DA FARE\n${lists.join('\n\n')}`,
    `\nFATTE NEGLI ULTIMI 30 GIORNI\n${done.map((i) => `[${refOf('V', i.id)}] ${clip(i.text, 200)} · ${app.listOf(i).name} · fatta il ${dayKey(new Date(i.doneAt))}`).join('\n') || '(nessuna)'}`,
    `\nAPPUNTI\n${notes.join('\n') || '(nessuno)'}`,
    `\nIDEE\n${ideas.join('\n') || '(nessuna)'}`,
  ].join('\n');
}

// ---------- Azioni del modello: prima si descrivono (niente cambia), poi si applicano ----------
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^\d{1,2}:\d{2}$/;
const str = (v) => (typeof v === 'string' ? v.trim() : '');
const has = (a, k) => Object.prototype.hasOwnProperty.call(a, k);
const mins = (v) => (v == null || v === '' || !Number.isFinite(+v) ? null : Math.max(0, Math.round(+v)));
const cleanTime = (v) => (TIME.test(v || '') ? v.padStart(5, '0') : null);
function cleanRepeat(r) {
  if (!r || !['day', 'week', 'month'].includes(r.every)) return null;
  const days = Array.isArray(r.days) ? [...new Set(r.days.map(Number).filter((d) => d >= 0 && d <= 6))] : [];
  return { every: r.every, n: Math.max(1, parseInt(r.n, 10) || 1), days: r.every === 'week' && days.length ? days : null };
}
const listName = (name) => {
  if (!str(name)) return app.targetList().name;
  return findListByName(name)?.name || `${str(name)} (nuova lista)`;
};
function listFor(name) {
  if (!str(name)) return app.targetList();
  const l = findListByName(name);
  if (l) return l;
  const n = str(name);
  const nl = { id: uid(), name: n[0].toUpperCase() + n.slice(1), icon: 'clipboard-list', color: nextColor(), ...suggestStyle(n) };
  data.lists.push(nl);
  return nl;
}
const whenTxt = (due, time) => (due ? ` · ${app.dueLabel(due, time).text}` : time ? ` · alle ${time}` : '');

// Scadenza, orario, avviso e ripetizione coerenti tra loro (come nella modifica a mano)
function fix(it) {
  // insistente senza un momento: il primo avviso tra un intervallo
  if (it.nag && it.remind == null) { if (!it.due && !it.time && !it.repeat) Object.assign(it, fromNow(it.nag)); it.remind = 0; }
  if (it.remind != null && !it.time) it.time = '09:00';
  if (it.repeat) {
    if (it.repeat.every === 'week' && !it.repeat.days) it.repeat.days = [new Date((it.due || dayKey(new Date())) + 'T12:00:00').getDay()];
    if (!it.due) it.due = firstDue(it.repeat, it.time);
  }
  if (it.time && !it.due) it.due = dayFor(it.time);
  settle(it);
}

function editParts(it, a) {
  const p = [];
  if (str(a.text) && str(a.text) !== it.text) p.push(`testo "${clip(str(a.text), 60)}"`);
  if (str(a.list) && findListByName(a.list)?.id !== app.listOf(it).id) p.push(`in ${listName(a.list)}`);
  if (has(a, 'due')) p.push(DATE.test(a.due || '') ? `scadenza ${app.dueLabel(a.due).text.replace(/^In ritardo$/, a.due)}` : 'senza scadenza');
  if (has(a, 'time')) p.push(cleanTime(a.time) ? `alle ${cleanTime(a.time)}` : 'senza orario');
  if (has(a, 'remind')) p.push(mins(a.remind) == null ? 'senza avviso' : mins(a.remind) ? `avviso ${mins(a.remind)} min prima` : "avviso all'ora");
  if (has(a, 'repeat')) p.push(cleanRepeat(a.repeat) ? repeatLabel(cleanRepeat(a.repeat)).toLowerCase() : 'non si ripete');
  if (has(a, 'nag')) p.push(mins(a.nag) ? `avviso insistente ${nagLabel(mins(a.nag))}` : 'avviso una volta sola');
  return p;
}
function editFields(it, a) {
  if (str(a.text)) it.text = str(a.text);
  if (str(a.list)) it.listId = listFor(a.list).id;
  if (has(a, 'due')) it.due = DATE.test(a.due || '') ? a.due : null;
  if (has(a, 'time')) it.time = cleanTime(a.time);
  if (has(a, 'remind')) it.remind = mins(a.remind);
  if (has(a, 'repeat')) it.repeat = cleanRepeat(a.repeat);
  if (has(a, 'nag')) it.nag = mins(a.nag) || null;
  if (has(a, 'due') && !it.due) { it.time = null; it.remind = null; it.repeat = null; }
  if (it.repeat || it.due || it.time) it.fired = null;
  fix(it);
  app.ui.fresh.add(it.id);
}

// Ogni azione valida → { ico, desc, del, run }. Quelle con riferimenti inesistenti si scartano.
function plan(actions) {
  const ops = [];
  for (const a of actions || []) {
    const t = a.ref ? byRef(a.ref) : null;
    const item = t?.type === 'item' ? t.it : null;
    const note = t?.type === 'note' ? t.n : null;
    switch (a.op) {
      case 'add': {
        const text = str(a.text);
        if (!text) break;
        const due = DATE.test(a.due || '') ? a.due : null;
        ops.push({
          ico: 'plus', desc: `Nuova in ${listName(a.list)}: ${text}${whenTxt(due, cleanTime(a.time))}${mins(a.nag) ? ` · avviso ${nagLabel(mins(a.nag))} finché non è fatta` : mins(a.remind) != null ? ' · con avviso' : ''}`,
          run: () => {
            const it = { id: uid(), text, listId: listFor(a.list).id, done: false, due, time: cleanTime(a.time), remind: mins(a.remind), repeat: cleanRepeat(a.repeat), nag: mins(a.nag) || null, createdAt: Date.now() };
            fix(it);
            data.items.push(it);
            app.ui.fresh.add(it.id);
          },
        });
        break;
      }
      case 'done':
        if (item && !item.done) ops.push({ ico: 'check', desc: `${item.repeat ? 'Fatta questa volta' : 'Fatta'}: ${item.text}`, run: () => app.complete(item) });
        break;
      case 'reopen':
        if (item?.done) ops.push({ ico: 'restore', desc: `Di nuovo da fare: ${item.text}`, run: () => { item.done = false; item.doneAt = null; app.ui.fresh.add(item.id); } });
        break;
      case 'edit': {
        const parts = item ? editParts(item, a) : [];
        if (parts.length) ops.push({ ico: 'pencil', desc: `${item.text} → ${parts.join(', ')}`, run: () => editFields(item, a) });
        break;
      }
      case 'delete':
        if (item) ops.push({ ico: 'trash', del: true, desc: `Elimina la voce: ${item.text}`, run: () => { data.items = data.items.filter((i) => i !== item); } });
        else if (note) ops.push({ ico: 'trash', del: true, desc: `Elimina ${note.idea ? "l'idea" : "l'appunto"}: ${noteName(note)}`, run: () => trashNote(note.id) });
        break;
      case 'note': {
        const text = str(a.text);
        if (!text) break;
        const idea = a.idea === true;
        ops.push({
          ico: idea ? 'bulb' : 'notes', desc: `${idea ? 'Nuova idea' : 'Nuovo appunto'}: ${str(a.title) || clip(text, 80)}`,
          run: () => {
            const now = Date.now();
            const n = { id: uid(), title: str(a.title), titleFor: str(a.title) ? text : null, text, idea, createdAt: now, updatedAt: now };
            data.notes.unshift(n);
            app.ui.fresh.add(n.id);
            if (!n.title) app.autoTitle(n);
          },
        });
        break;
      }
      case 'edit_note':
        if (note && (str(a.text) || str(a.title))) {
          ops.push({
            ico: 'pencil', desc: `${note.idea ? 'Idea' : 'Appunto'} riscritto: ${str(a.title) || noteName(note)}`,
            run: () => {
              if (str(a.text)) note.text = str(a.text);
              if (str(a.title)) { note.title = str(a.title); note.titleFor = note.text; }
              note.updatedAt = Date.now();
              if (!str(a.title) && !note.userTitle) app.autoTitle(note);
            },
          });
        }
        break;
      case 'to_item':
        if (note) {
          ops.push({
            ico: 'check', desc: `${note.idea ? "L'idea" : "L'appunto"} diventa una cosa da fare in ${listName(a.list)}: ${noteName(note)}`,
            run: () => {
              data.notes = data.notes.filter((x) => x !== note);
              data.items.push({ id: note.id, text: note.text.replace(/\s*\n+\s*/g, ' ').trim() || note.title, listId: listFor(a.list).id, done: false, due: null, createdAt: Date.now() });
              app.ui.fresh.add(note.id);
            },
          });
        }
        break;
      default:
    }
  }
  return ops;
}

function apply(m, ops) {
  const restore = snapshot();
  for (const o of ops) {
    try { o.run(); } catch (err) { console.warn('azione', err); }
  }
  saveData();
  app.render();
  undos.set(m.id, { restore, after: JSON.stringify(data) });
  m.state = 'applied';
}
function revert(m) {
  const u = undos.get(m.id);
  if (!u) return;
  // dopo queste modifiche ne sono arrivate altre: tornare indietro le cancellerebbe
  if (JSON.stringify(data) !== u.after) return app.toast('Nel frattempo è cambiato altro: sistemalo a mano');
  u.restore();
  app.render();
  undos.delete(m.id);
  m.state = 'undone';
  persist();
  draw();
}

// ---------- Conversazione ----------
// dalla chat scritta
function send(text) {
  text = text.trim();
  if (!text || busy) return;
  if (!aiReady(settings)) {
    $('#chatInput').value = text;
    return app.toast(`Per parlare con ${aiName()} serve l'IA`, 'Impostazioni', () => { closeChat(); app.openSettings(); });
  }
  return ask(text);
}
// Una battuta: la domanda va nella conversazione, la risposta torna (la usa anche la schermata a voce, js/talk.js)
export function ask(text) {
  const run = queue.then(() => turn(text.trim()));
  queue = run.catch(() => {});
  return run;
}
async function turn(text) {
  if (!aiReady(settings)) return { err: true, noAi: true, text: `Per risponderti mi serve l'IA: aggiungi una chiave OpenRouter nelle Impostazioni.` };
  st.msgs.push({ id: uid(), role: 'user', text, t: Date.now() });
  busy = true;
  persist();
  draw();
  let m;
  try {
    // le ultime 20 battute; le risposte dell'assistente tornano al modello nel loro JSON
    const history = st.msgs.filter((x) => x.role === 'user' || x.raw).slice(-20)
      .map((x) => (x.role === 'user' ? { role: 'user', content: x.text } : { role: 'assistant', content: x.raw }));
    const r = await converse(history, context(), settings, aiName());
    const ops = plan(r.actions);
    m = {
      id: uid(), role: 'assistant', t: Date.now(), raw: r.raw, actions: r.actions,
      text: r.reply || (ops.length ? 'Ecco cosa cambio:' : 'Non ho capito, me lo ridici?'),
      changes: ops.map((o) => ({ ico: o.ico, desc: o.desc, del: !!o.del })),
    };
    st.msgs.push(m);
    if (ops.length) {
      if (ops.length > SMALL || ops.some((o) => o.del)) m.state = 'pending';
      else apply(m, ops);
    }
  } catch (err) {
    m = { id: uid(), role: 'assistant', err: true, t: Date.now(), text: `Non riesco a rispondere: ${err.message}` };
    st.msgs.push(m);
  } finally {
    busy = false;
    persist();
    draw();
  }
  return m;
}
// l'ultima risposta dell'assistente (per "sì", "no", "annulla" detti a voce)
export const lastReply = () => [...st.msgs].reverse().find((m) => m.role === 'assistant');
export const canUndo = (m) => !!m && undos.has(m.id);

// Applica / Scarta / Annulla, dalla chat scritta o da quella a voce
export function act(what, id) {
  const m = st.msgs.find((x) => x.id === id);
  if (!m) return;
  if (what === 'apply') {
    if (m.state !== 'pending') return;
    const ops = plan(m.actions);
    if (!ops.length) { m.state = 'discarded'; app.toast('Le cose da cambiare non ci sono più'); }
    else { m.changes = ops.map((o) => ({ ico: o.ico, desc: o.desc, del: !!o.del })); apply(m, ops); }
  } else if (what === 'discard') { if (m.state === 'pending') m.state = 'discarded'; }
  else if (what === 'undo') return revert(m);
  persist();
  draw();
}
// un cartellino toccato: apre la voce o l'appunto sopra la chat
export function openRef(ref) {
  const t = byRef(ref);
  if (!t) return app.toast('Non c\'è più');
  return t.type === 'item' ? app.editItem(t.it.id) : app.editNote(t.n.id);
}

// ---------- Disegno ----------
function chipHTML(ref) {
  const t = byRef(ref);
  if (!t) return '';
  if (t.type === 'item') {
    const l = app.listOf(t.it);
    return `<button class="ref ${t.it.done ? 'done' : ''}" data-ref="${ref}" style="${app.cv(l.color)}">${listIcon(l)}<span>${app.esc(t.it.text)}</span></button>`;
  }
  return `<button class="ref" data-ref="${ref}" style="--c:var(--accent)">${icon(t.n.idea ? 'bulb' : 'notes')}<span>${app.esc(noteName(t.n))}</span></button>`;
}
const REFS = /\[\s*([VN]\d+(?:\s*[,;]\s*[VN]\d+)*)\s*\]/gi;
export function inline(s) {
  return app.esc(s)
    .replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')
    .replace(REFS, (m, list) => list.split(/\s*[,;]\s*/).map((r) => chipHTML(r.toUpperCase())).join(' '));
}
// Testo del modello: paragrafi ed elenchi "- …"
export function fmt(text) {
  const out = [];
  let ul = [];
  const flush = () => { if (ul.length) out.push(`<ul>${ul.map((li) => `<li>${li}</li>`).join('')}</ul>`); ul = []; };
  for (const line of String(text).split('\n')) {
    const b = line.match(/^\s*(?:[-•*]|\d+[.)])\s+/);
    if (b) ul.push(inline(line.slice(b[0].length)));
    else { flush(); if (line.trim()) out.push(`<p>${inline(line)}</p>`); }
  }
  flush();
  return out.join('');
}
// Da leggere ad alta voce: i riferimenti diventano il nome della cosa
export function spoken(text) {
  return String(text).replace(REFS, (m, list) => list.split(/\s*[,;]\s*/).map((r) => {
    const t = byRef(r);
    return t ? (t.type === 'item' ? t.it.text : noteName(t.n)) : '';
  }).join(', ')).replace(/\*\*/g, '').replace(/^\s*[-•*]\s+/gm, '');
}

export function changesHTML(m) {
  if (!m.changes?.length) return '';
  const rows = m.changes.map((c) => `<div class="change ${c.del ? 'del' : ''}">${icon(c.ico)}<span>${app.esc(c.desc)}</span></div>`).join('');
  const foot = {
    pending: `<p class="changes-ask">${m.changes.some((c) => c.del) ? 'Ci sono eliminazioni' : `Sono ${m.changes.length} modifiche`}: controlla e conferma.</p>
      <div class="row"><button class="pill-btn ghost" data-act="discard" data-id="${m.id}">Scarta</button><button class="pill-btn grow" data-act="apply" data-id="${m.id}">${icon('check')}Applica</button></div>`,
    applied: `<div class="changes-foot">${icon('check')}<span>Fatto</span>${undos.has(m.id) ? `<button data-act="undo" data-id="${m.id}">${icon('restore')}Annulla</button>` : ''}</div>`,
    undone: `<div class="changes-foot off">${icon('restore')}<span>Annullato</span></div>`,
    discarded: `<div class="changes-foot off">${icon('x')}<span>Scartato</span></div>`,
  }[m.state] || '';
  return `<div class="changes ${m.state || ''}">${rows}${foot}</div>`;
}

function hello() {
  const ready = aiReady(settings);
  return `<div class="chat-hello">
    <span class="chat-avatar big">${icon('sparkles')}</span>
    <h2>Ciao, sono ${app.esc(aiName())}</h2>
    <p class="muted">Conosco tutto quello che hai in MyList: chiedimi qualcosa o dimmi cosa cambiare.</p>
    ${ready
      ? `<div class="suggest">${SUGGEST.map((s) => `<button class="chip soft" data-say="${app.esc(s)}">${app.esc(s)}</button>`).join('')}</div>
         ${voiceSupported ? `<button class="pill-btn talk-start" data-act="talk">${icon('talk')}Parlami a voce</button>` : ''}
         <p class="muted small">Da qualsiasi punto dell'app basta iniziare con il mio nome: <i>"${app.esc(aiName())}, sposta il dentista a giovedì"</i>.</p>`
      : `<p class="chat-warn">Per rispondere mi serve l'IA: aggiungi una chiave OpenRouter.</p>
         <button class="pill-btn" data-act="settings">${icon('gear')}Apri le Impostazioni</button>`}
  </div>`;
}

function draw() {
  const box = $('#chatMsgs');
  if (!box) return;
  $('#chatNew').hidden = !st.msgs.length;
  if (!st.msgs.length && !busy) { box.innerHTML = hello(); return; }
  box.innerHTML = st.msgs.map((m) => (m.role === 'user'
    ? `<div class="msg me">${app.esc(m.text)}</div>`
    : `<div class="msg ai ${m.err ? 'err' : ''}">${fmt(m.text)}${changesHTML(m)}</div>`)).join('')
    + (busy ? '<div class="msg ai typing" aria-label="Sto pensando"><i></i><i></i><i></i></div>' : '');
  requestAnimationFrame(() => { box.scrollTop = box.scrollHeight; });
}

// ---------- Apertura, chiusura, eventi ----------
export function openChat(text = '', { viaVoice = false } = {}) {
  const dlg = $('#chat');
  $('#chatName').textContent = aiName();
  $('#chatInput').placeholder = `Chiedi a ${aiName()}…`;
  if (!dlg.open) dlg.showModal();
  draw();
  // detto a voce → risponde a voce, nella schermata col nucleo
  if (viaVoice) return openTalk(text.trim() ? { text } : { listen: true });
  if (talkOpen()) closeTalk();
  if (text.trim()) send(text);
}
function closeChat() {
  $('#chat').close();
}

// "Lisa, cosa devo fare oggi?" (anche "ehi Lisa…", "ok Lisa…"): il resto della frase, o null se non la chiami
export function calledAssistant(text) {
  // senza accenti da tutte e due le parti: «Totò» si chiama anche scrivendo «Toto» (la lunghezza resta la stessa)
  const plain = (t) => String(t).normalize('NFC').normalize('NFD').replace(/\p{M}/gu, '');
  const src = String(text).normalize('NFC');
  const name = plain(aiName()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = plain(src).match(new RegExp(`^\\s*(?:(?:ehi|ehy|hey|ei|ok|okay|ciao|senti|allora)[\\s,!]+)?${name}(?![\\p{L}\\p{N}])[\\s,:;.!?]*`, 'iu'));
  return m ? src.slice(m[0].length).trim() : null;
}

export function initChat(deps) {
  app = deps;
  initTalk(deps);
  const dlg = $('#chat');
  $('#chatAvatar').innerHTML = icon('sparkles');
  $('#chatClose').innerHTML = icon('x');
  $('#chatSend').innerHTML = icon('send');
  $('#chatMic').innerHTML = icon('talk');
  $('#chatMic').hidden = !voiceSupported;
  $('#chatTalk').innerHTML = `${icon('talk')}<span>A voce</span>`;
  $('#chatTalk').hidden = !voiceSupported;
  $('#chatClose').onclick = closeChat;
  dlg.addEventListener('close', () => closeTalk());
  $('#chatNew').onclick = () => {
    st = { n: 0, refs: {}, msgs: [] };
    undos.clear();
    persist();
    draw();
  };
  $('#chatForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('#chatInput');
    const t = input.value;
    input.value = '';
    send(t);
  });
  $('#chatMic').onclick = () => openTalk({ listen: true });
  $('#chatTalk').onclick = () => openTalk();
  $('#chatMsgs').addEventListener('click', (e) => {
    const ref = e.target.closest('[data-ref]');
    if (ref) return openRef(ref.dataset.ref);
    const say = e.target.closest('[data-say]');
    if (say) return send(say.dataset.say);
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'settings') { closeChat(); return app.openSettings(); }
    if (b.dataset.act === 'talk') return openTalk({ listen: true });
    act(b.dataset.act, b.dataset.id);
  });
  // dopo aver modificato una voce aperta da un cartellino, i cartellini si aggiornano
  $('#sheet').addEventListener('close', () => { if (dlg.open) draw(); });
}
