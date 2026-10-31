import { icon, listIcon } from './icons.js';
import {
  data, settings, saveData, saveSettings, snapshot, replaceData, resetAll,
  uid, norm, findListByName, nextColor, LIST_COLORS, LIST_ICONS,
} from './store.js';
import { voiceSupported, listen } from './voice.js';

const PAUSE_MS = { short: 900, normal: 1500, long: 2500 };
const VERSION = window.MYLIST_VERSION || '';
import { aiReady, aiSource, chromeAI, detectChromeAI, downloadChromeAI, organize, answer, makeTitle, testConnection, listModels } from './ai.js';
import { dayKey, addDays, hhmm, parseWhen, remindAt, fromNow, dayFor, firstDue, advance, repeatLabel, sameRepeat } from './when.js';
import { chime, primeSound } from './sound.js';
import { initReminders, settle, notifySupported, notifyPermission, askNotify, newTopic, ntfyLink, sendTest } from './reminders.js';

const $ = (s, el = document) => el.querySelector(s);
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const buzz = (ms = 8) => navigator.vibrate?.(ms);

const ui = { search: '', fresh: new Set(), voice: null, installEvt: null };

// ---------- Utilità sulle liste ----------
const listById = (id) => data.lists.find((l) => l.id === id);
// Lista di riserva: la prima rimasta (tutte le liste sono eliminabili, ne resta sempre almeno una)
const fallbackList = () => data.lists[0];
const listOf = (item) => listById(item.listId) || fallbackList();
const openCount = (listId) => data.items.filter((i) => !i.done && (!listId || listOf(i).id === listId)).length;
const currentList = () => (settings.view === 'all' ? null : listById(settings.view));
const inNotes = () => settings.view === 'notes';
const targetList = () => currentList() || listById(settings.target) || fallbackList();
// Colore del testo leggibile sopra il colore della lista (scuro sui gialli, bianco sui grigi scuri)
function ink(hex) {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const L = 0.2126 * lin(n >> 16) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
  return L > 0.33 ? '#1E1E1E' : '#FFFFFF';
}
const cv = (color) => `--c:${color};--on:${ink(color)}`;

// ---------- Date ----------
function dueLabel(due, time = null) {
  if (!due) return null;
  const now = new Date();
  const today = dayKey(now);
  const at = time ? ` ${time}` : '';
  if (due < today || (due === today && time && time < hhmm(now))) return { text: due === today ? `Oggi${at}` : 'In ritardo', cls: 'late' };
  if (due === today) return { text: `Oggi${at}`, cls: 'today' };
  if (due === addDays(1)) return { text: `Domani${at}`, cls: '' };
  const d = new Date(due + 'T12:00:00');
  return { text: d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }) + at, cls: '' };
}
const fmtTime = (ms) => hhmm(new Date(ms));

function sortOpen(items) {
  const k = (i) => `${i.due || '9999'} ${i.time || '99:99'}`;
  return items.sort((a, b) => (k(a) < k(b) ? -1 : k(a) > k(b) ? 1 : 0) || (b.createdAt - a.createdAt));
}

// ---------- Inserimento rapido (senza AI) ----------
// Sintassi: "#lista" sposta nella lista; giorno, orario e avviso li capisce parseWhen ("alle 16", "tra 20 minuti", "avvisami mezz'ora prima")
function parseQuick(raw, fallbackListId) {
  let text = ' ' + raw.trim() + ' ';
  let listId = fallbackListId;

  text = text.replace(/\s#([\p{L}\p{N}_-]+)/gu, (m, tag) => {
    const l = findListByName(tag);
    if (l) { listId = l.id; return ' '; }
    return m;
  });
  // "nella lista spesa" / "lista spesa" (comodo in dettatura)
  text = text.replace(/\s(?:(?:nella|alla|in|sulla)\s+)?lista\s+([\p{L}\p{N}_-]+)/giu, (m, name) => {
    const l = findListByName(name);
    if (l) { listId = l.id; return ' '; }
    return m;
  });
  const w = parseWhen(text);
  return { text: w.text, listId, due: w.due, time: w.time, remind: w.remind, repeat: w.repeat };
}

// ---------- Appunti senza AI: "prendi nota…", "appunto:", "annota che…", "segna che…" ----------
const NOTE_HEAD = /^\s*(?:(?:ok|allora)[\s,]+)?(?:prendi(?:\s+un)?\s+(?:nota|appunt[oi])|prendere\s+nota|appunto|annota(?:mi|re)?|nota(?:\s+bene)?|memo|segna(?:ti)?\s+che|scrivi\s+che|ricorda\s+che)\b[\s,:.\-]*(?:che\s+|di\s+)?/iu;
// Idee: "idea: …", e il tono possibilista ("si potrebbe…", "magari…", "sarebbe bello…", "e se…")
const IDEA_LABEL = /^\s*(?:(?:ok|allora)[\s,]+)?(?:ho\s+un['’]?\s*)?idea\b[\s,:.\-]*/iu;
const IDEA_TONE = /^\s*(?:(?:ok|allora)[\s,]+)?(?:si\s+potrebbe(?:ro)?|potremmo|potrei|sarebbe\s+(?:bello|carino|utile|meglio|ora)|magari|e\s+se|mi\s+piacerebbe|ci\s+piacerebbe|perch[eé]\s+non)\b/iu;
const cap = (t) => (t ? t[0].toUpperCase() + t.slice(1) : t);
// null = non è un appunto
function localNote(text, force = false) {
  const t = text.trim();
  // "idea per il regalo di Anna: …" → tolgo "idea"; "si potrebbe…" resta com'è, è l'idea stessa
  if (IDEA_LABEL.test(t)) return { title: '', text: cap(t.replace(IDEA_LABEL, '').trim()) || cap(t), idea: true };
  if (IDEA_TONE.test(t)) return { title: '', text: cap(t), idea: true };
  if (!force && !NOTE_HEAD.test(t)) return null;
  return { title: '', text: cap(t.replace(NOTE_HEAD, '').trim()) || cap(t), idea: false };
}
// Il titolo lo scrive l'AI in base al contenuto (finché non lo scrivi tu); si rifà se cambi il testo
async function autoTitle(n) {
  if (n.userTitle || !aiReady(settings) || n.titleFor === n.text || !n.text.trim()) return;
  const text = n.text;
  try {
    const t = await makeTitle(text, settings);
    if (!t || n.userTitle || n.text !== text) return;
    n.title = t;
    n.titleFor = text;
    saveData();
    if ($('#nTitle')?.dataset.id === n.id) $('#nTitle').value = t;
    renderMain();
  } catch (err) { console.warn('titolo', err); }
}
const noteTitle = (n) => n.title || n.text.split(/\n|[.!?](?:\s|$)/)[0].slice(0, 60);
function noteDate(ms) {
  const d = new Date(ms);
  if (dayKey(d) === dayKey(new Date())) return `Oggi ${hhmm(d)}`;
  if (dayKey(d) === addDays(-1)) return `Ieri ${hhmm(d)}`;
  return d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' });
}

// ---------- "Ho preso le patate" → spunta "Prendere le patate" (anche senza AI) ----------
// Frasi al passato: "ho preso…", "abbiamo pagato…", "comprato il latte", "fatta la lavatrice", "spunta il pane", "la spesa è fatta"
const DONE_HEAD = /^(?:ok|okay|ecco|allora|bene)?[\s,]*(?:(?:ho|abbiamo|hai)\s+(?:già\s+|appena\s+|finalmente\s+)?\p{L}+[ts][oaie]|\p{L}+(?:at|ut|it)[oaie]|fatt[oaie]|pres[oaie]|mess[oaie]|scritt[oaie]|spunta|completa|segna)(?=[\s,:.!]|$)/iu;
const DONE_TAIL = /\s+(?:è\s+|sono\s+)?(?:fatt[oaie]|complet[ao]t[oaie]|finit[oaie]|pres[oaie]|comprat[oaie]|sistemat[oaie])(?:\s+come\s+fatt[oaie])?[.!]*$/iu;
const STOP = new Set(['del', 'della', 'dello', 'dei', 'degli', 'delle', 'dal', 'dalla', 'dai', 'nel', 'nella', 'nei', 'nelle', 'per', 'con', 'sul', 'sulla', 'tra', 'fra',
  'che', 'una', 'uno', 'gli', 'alla', 'allo', 'agli', 'alle', 'mio', 'mia', 'miei', 'mie', 'tuo', 'tua', 'suo', 'sua', 'poi', 'anche', 'gia', 'ancora',
  'tutto', 'tutta', 'tutti', 'tutte', 'quel', 'quella', 'quello', 'questo', 'questa', 'ora', 'adesso', 'oggi', 'come', 'fatto', 'fatta', 'lista']);
const stem = (w) => (w.length > 4 ? w.slice(0, -2) : w);
const words = (t) => norm(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2 && !STOP.has(w));
const looksDone = (t) => DONE_HEAD.test(t.trim()) || DONE_TAIL.test(t.trim());

// null = non è una frase "già fatto"; altrimenti gli id delle voci aperte che corrispondono (può essere vuoto)
function findDoneLocally(text) {
  const t = text.trim();
  if (!looksDone(t)) return null;
  const rest = t.replace(DONE_HEAD, '').replace(DONE_TAIL, '');
  const open = data.items.filter((i) => !i.done);
  const cur = currentList()?.id;
  const ids = new Set();
  for (const part of rest.split(/\s*(?:,|;|\be\b|\bed\b|\bpoi\b|\banche\b)\s*/iu)) {
    let ws = words(part);
    // "fatto: comprare il latte" → conta il latte, il verbo all'infinito può mancare nella voce
    const nouns = ws.filter((w) => !/(?:are|ere|ire)$/.test(w));
    if (nouns.length) ws = nouns;
    if (!ws.length) continue;
    const need = ws.map(stem);
    let best = null;
    for (const it of open) {
      if (ids.has(it.id)) continue;
      const have = new Set(words(it.text).map(stem));
      if (!need.every((w) => have.has(w))) continue;
      // la voce più "aderente" (meno parole in più), poi quella nella lista aperta, poi la più recente
      const score = need.length / Math.max(have.size, 1) + (listOf(it).id === cur ? 0.01 : 0) + it.createdAt / 1e16;
      if (!best || score > best.score) best = { id: it.id, score };
    }
    if (best) ids.add(best.id);
  }
  return [...ids];
}

// Completa una voce. Le ricorrenti non finiscono tra le completate: passano alla volta successiva.
// Restituisce la prossima scadenza (ricorrente) o null
function complete(it, doneDue = it.due) {
  if (it.repeat && it.due) {
    it.due = advance(it.repeat, doneDue > it.due ? doneDue : it.due);
    it.fired = null;
    ui.fresh.add(it.id);
    return it.due;
  }
  it.done = true;
  it.doneAt = Date.now();
  return null;
}
const nextMsg = (it) => `Fatto · prossima ${dueLabel(it.due, it.time).text.replace(/^In ritardo$/, '').toLowerCase() || it.due}`;

// reveal: dopo una dettatura apre la lista dove è finita la nota e la evidenzia
// done: id di voci già esistenti da spuntare ("ho preso le patate")
// notes: appunti da salvare nella sezione Note
function addItems(entries, { reveal = false, done = [], notes = [] } = {}) {
  const restore = snapshot();
  const now = Date.now();
  const added = [];
  entries.forEach((e, i) => {
    if (!e.text) return;
    const it = { id: uid(), text: e.text, listId: e.listId || fallbackList().id, done: false, due: e.due || null, time: e.time || null, remind: e.remind ?? null, repeat: e.repeat || null, createdAt: now - i };
    settle(it);
    data.items.push(it);
    ui.fresh.add(it.id);
    added.push(it);
  });
  const finishing = done.map((id) => data.items.find((i) => i.id === id && !i.done)).filter(Boolean);
  const noted = notes.filter((n) => n.text).map((n, i) => ({ id: uid(), title: n.title || '', titleFor: n.title ? n.text : null, text: n.text, idea: !!n.idea, createdAt: now - i, updatedAt: now - i }));
  if (reveal && noted.length) ui.noteFilter = noted.every((n) => n.idea) ? 'ideas' : 'notes';
  data.notes.unshift(...noted);
  noted.forEach((n) => { ui.fresh.add(n.id); autoTitle(n); });
  if (!added.length && !finishing.length && !noted.length) return;
  if (added.length || noted.length) saveData();
  if (reveal) {
    const ids = [...new Set([...added, ...finishing].map((a) => listOf(a).id))];
    // solo appunti → apri le Note; altrimenti la lista dove sono finite le voci
    const view = !ids.length ? 'notes' : ids.length === 1 ? ids[0] : 'all';
    if (settings.view !== view) {
      settings.view = view;
      if (view !== 'all' && view !== 'notes') settings.target = view;
      saveSettings();
    }
    clearSearch();
  }
  render();
  buzz(12);
  let undone = false;
  const undo = () => { undone = true; restore(); render(); };
  requestAnimationFrame(() => {
    const find = (arr) => arr.map((a) => document.querySelector(`.item[data-id="${a.id}"]`)).filter(Boolean);
    const els = reveal ? find(added.length ? added : noted) : [];
    const fin = find(finishing);
    if (reveal) (els[0] || fin[0])?.scrollIntoView({ block: 'center', behavior: 'smooth' });
    els.forEach((el) => el.classList.add('flash'));
    setTimeout(() => els.forEach((el) => el.classList.remove('flash')), 2400);
    if (!finishing.length) return;
    // le voci si spuntano sotto i tuoi occhi, poi spariscono tra le completate
    fin.forEach((el) => el.classList.add('completing'));
    setTimeout(() => {
      if (undone) return;
      finishing.forEach((it) => complete(it));
      saveData();
      if (!fin.length) return render();
      fin.forEach((el, i) => collapseThen(el, i ? () => {} : render));
    }, fin.length ? (reveal ? 900 : 550) : 0);
  });
  const lists = [...new Set(added.map((a) => listOf(a).name))];
  const bell = added.map(remindAt).filter((at) => at && at > Date.now());
  const addMsg = !added.length ? ''
    : added.length === 1 && bell.length ? `Ti avviso ${dayKey(new Date(bell[0])) === dayKey(new Date()) ? '' : dueLabel(dayKey(new Date(bell[0]))).text.toLowerCase() + ' '}alle ${fmtTime(bell[0])} · ${listOf(added[0]).name}`
    : added.length === 1 ? `Aggiunta in ${listOf(added[0]).name}` : `${added.length} voci → ${lists.join(', ')}`;
  if (bell.length) nudgeNotify();
  const doneMsg = !finishing.length ? ''
    : finishing.length === 1 ? (added.length ? '1 completata' : finishing[0].repeat ? `Fatto: ${finishing[0].text} · si ripete` : `Fatto: ${finishing[0].text}`) : `${finishing.length} completate`;
  const ideas = noted.filter((n) => n.idea).length;
  const noteMsg = !noted.length ? ''
    : noted.length === 1 ? (added.length || finishing.length ? (ideas ? '1 idea' : '1 appunto') : ideas ? 'Idea salvata nelle Note' : 'Appunto salvato nelle Note')
    : ideas === noted.length ? `${ideas} idee` : `${noted.length} appunti`;
  toast([addMsg, doneMsg, noteMsg].filter(Boolean).join(' · '), 'Annulla', undo);
}

// "Fatto" toccato su una notifica (ntfy o MyList): id della voce e giorno di quella volta
function remoteDone(id, due) {
  const it = data.items.find((i) => i.id === id);
  if (!it || it.done || (it.repeat && due && it.due > due)) return; // già fatta (o già passata alla volta dopo)
  const restore = snapshot();
  const next = complete(it, due || it.due);
  saveData();
  render();
  toast(next ? `Dalla notifica: ${it.text} · prossima ${dueLabel(it.due, it.time).text.toLowerCase()}` : `Fatto dalla notifica: ${it.text}`, 'Annulla', () => { restore(); render(); });
}

// Primo promemoria senza un canale per gli avvisi: dopo la conferma, proponi di attivarli
function nudgeNotify() {
  if (ui.nudged || settings.ntfyTopic || !notifySupported || notifyPermission() !== 'default') return;
  ui.nudged = true;
  setTimeout(() => toast('Per ricevere gli avvisi attiva le notifiche', 'Attiva', async () => {
    const p = await askNotify();
    toast(p === 'granted' ? 'Notifiche attive. Per gli avvisi ad app chiusa vedi Impostazioni → Promemoria' : 'Notifiche non concesse');
  }), 4700);
}

// "Ho fatto X" ma X non c'è tra le cose da fare
function notFound(text, viaVoice) {
  toast('Non trovo una voce da spuntare', 'Aggiungi', () => addItems([parseQuick(text, targetList().id)], { reveal: viaVoice }));
}

// Le cose ancora da fare che l'AI può spuntare: prima la lista aperta, poi le più recenti
function todoForAI() {
  const cur = currentList()?.id;
  return data.items
    .filter((i) => !i.done)
    .sort((a, b) => (listOf(b).id === cur) - (listOf(a).id === cur) || b.createdAt - a.createdAt)
    .slice(0, 150);
}

// Usa l'AI per smistare, con fallback automatico al parser locale
async function smartAdd(text, { viaVoice = false } = {}) {
  const useAI = aiReady(settings) && (settings.aiMode === 'always' || (settings.aiMode === 'voice' && viaVoice));
  // Se l'utente ha usato #lista esplicitamente, non serve l'AI
  if (!useAI || /\s?#[\p{L}]/u.test(text)) {
    const sq = /#/.test(text) ? null : localSearch(text);
    if (sq) return startSearch(sq, null, { viaVoice });
    const note = /#/.test(text) ? null : localNote(text, inNotes());
    if (note) return addItems([], { notes: [note], reveal: viaVoice });
    const done = /#/.test(text) ? null : findDoneLocally(text);
    if (done?.length) addItems([], { done, reveal: viaVoice });
    else if (done) notFound(text, viaVoice);
    else addItems([parseQuick(text, targetList().id)], { reveal: viaVoice });
    return;
  }
  const composer = $('#composer');
  if (!viaVoice) {
    composer.classList.add('thinking');
    $('#btnGo').innerHTML = icon('sparkles');
  }
  try {
    const lists = data.lists.map((l) => ({
      name: l.name,
      examples: data.items.filter((i) => i.listId === l.id).sort((a, b) => b.createdAt - a.createdAt).slice(0, 4).map((i) => i.text.slice(0, 60)),
    }));
    const todo = todoForAI();
    const res = await organize(text, lists, settings, {
      openList: currentList()?.name,
      fallback: targetList().name,
      todo: todo.map((i) => ({ text: i.text.slice(0, 80), list: listOf(i).name })),
      inNotes: inNotes(),
    });
    if (res.search) return startSearch(res.search.query, res.search.keywords, { viaVoice });
    if (!res.items.length && !res.done.length && !res.notes.length) {
      if (looksDone(text)) return notFound(text, viaVoice);
      throw new Error('Nessuna voce trovata');
    }
    const entries = res.items.map((r) => {
      let l = r.list ? findListByName(r.list) : null;
      if (!l && r.list) {
        l = { id: uid(), name: r.list[0].toUpperCase() + r.list.slice(1), icon: 'clipboard-list', color: nextColor() };
        data.lists.push(l);
      }
      // "tra 20 minuti" → orario esatto; orario senza giorno → oggi o domani; avviso senza orario → alle 9
      let { due, time } = r.in ? fromNow(r.in) : r;
      let remind = r.remind;
      const repeat = r.in ? null : r.repeat;
      if (repeat) {
        if (repeat.every === 'week' && !repeat.days && due) repeat.days = [new Date(due + 'T12:00:00').getDay()];
        due = due || firstDue(repeat, time);
        if (time && remind == null) remind = 0;
      }
      if (remind != null && !time) time = '09:00';
      if (time && !due) due = dayFor(time);
      return { text: r.text, listId: (l || targetList()).id, due, time, remind, repeat };
    });
    addItems(entries, { reveal: viaVoice, done: res.done.map((n) => todo[n].id), notes: res.notes });
  } catch (err) {
    console.warn(err);
    const sq = localSearch(text);
    if (sq) return startSearch(sq, null, { viaVoice });
    const note = localNote(text, inNotes());
    const done = note ? null : findDoneLocally(text);
    if (note) addItems([], { notes: [note], reveal: viaVoice });
    else if (done?.length) addItems([], { done, reveal: viaVoice });
    else addItems([parseQuick(text, targetList().id)], { reveal: viaVoice });
    toast(`AI non disponibile: ${note ? 'appunto salvato così com\'è' : done?.length ? 'spuntata col riconoscimento locale' : "aggiunta così com'è"} (${err.message})`);
  } finally {
    composer.classList.remove('thinking');
    updateGoButton();
  }
}

// ---------- Render ----------
function render() {
  renderHeader();
  renderChips();
  renderMain();
  renderComposer();
}

function renderHeader() {
  const l = currentList();
  const searching = !!ui.search.trim();
  const notes = inNotes() && !searching;
  const title = searching ? 'Risultati' : notes ? `<span class="t-ico">${icon('notes')}</span><span class="t-txt">Note</span>`
    : l ? `<span class="t-ico" style="${cv(l.color)}">${listIcon(l)}</span><span class="t-txt">${esc(l.name)}</span>` : '<span class="t-txt">Tutte</span>';
  $('#viewTitle').innerHTML = title;
  const n = openCount(l?.id);
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  const nn = data.notes.length;
  $('#viewSub').textContent = notes
    ? `${nn ? (nn === 1 ? '1 appunto' : `${nn} appunti`) : 'Nessun appunto'} · ${today}`
    : `${n ? (n === 1 ? '1 cosa da fare' : `${n} cose da fare`) : 'Tutto fatto'} · ${today}`;
  $('#btnEditList').hidden = !l;
  $('#btnGroup').hidden = !!l || searching || notes;
  $('#btnGroup').innerHTML = icon(settings.grouped ? 'group' : 'flat');
  $('#btnGroup').setAttribute('aria-label', settings.grouped ? 'Vista a elenco unico' : 'Raggruppa per lista');
  document.documentElement.style.setProperty('--list', l ? l.color : 'var(--accent)');
}

function renderChips() {
  const chips = $('#chips');
  const all = `<button class="chip ${settings.view === 'all' ? 'on all' : ''}" data-view="all">Tutte <b>${openCount()}</b></button>`;
  const ls = data.lists.map((l) => {
    const n = openCount(l.id);
    return `<button class="chip ${settings.view === l.id ? 'on' : ''}" data-view="${l.id}" style="${cv(l.color)}">
      ${listIcon(l, 'chip-emo')}${esc(l.name)}${n ? ` <b>${n}</b>` : ''}</button>`;
  }).join('');
  const nn = data.notes.length;
  const notes = `<button class="chip notes ${inNotes() ? 'on' : ''}" data-view="notes">${icon('notes', 'chip-emo')}Note${nn ? ` <b>${nn}</b>` : ''}</button>`;
  // Note sempre in fondo, dopo le categorie
  chips.innerHTML = all + ls + `<button class="chip add" id="chipAdd" aria-label="Nuova lista">${icon('plus')}</button>` + notes;
  chips.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function itemHTML(it, showList) {
  const l = listOf(it);
  const due = dueLabel(it.due, it.time);
  const at = remindAt(it);
  const meta = [
    showList ? `<span class="tag" style="${cv(l.color)}">${listIcon(l)}${esc(l.name)}</span>` : '',
    due && !it.done ? `<span class="tag due ${due.cls}">${icon(it.time ? 'clock' : 'calendar')}${due.text}</span>` : '',
    it.repeat && !it.done ? `<span class="tag rep">${icon('repeat')}${repeatLabel(it.repeat)}</span>` : '',
    at && !it.done ? `<span class="tag bell ${it.fired === at ? 'past' : ''}" title="Avviso">${icon('bell')}${it.remind ? fmtTime(at) : ''}</span>` : '',
  ].join('');
  return `<li class="item ${it.done ? 'is-done' : ''} ${ui.fresh.has(it.id) ? 'pop' : ''}" data-id="${it.id}" style="${cv(l.color)}">
    <div class="swipe-bg"><span class="sw-l">${icon('check')}</span><span class="sw-r">${icon('trash')}</span></div>
    <div class="item-body">
      <button class="check" aria-label="${it.done ? 'Segna da fare' : 'Completa'}">${icon('check')}</button>
      <div class="item-main" data-edit>
        <div class="item-text">${esc(it.text)}</div>
        ${meta ? `<div class="meta">${meta}</div>` : ''}
      </div>
    </div>
  </li>`;
}

function emptyHTML() {
  const l = currentList();
  const lines = l
    ? [listIcon(l), `Niente in ${esc(l.name)}`, 'Scrivi qui sotto o tocca il microfono']
    : [icon('coffee'), 'Niente da fare', 'Goditi il momento, oppure detta la prossima idea'];
  if (ui.search.trim()) return `<div class="empty"><div class="empty-emo">${icon('search')}</div><h2>Non ho trovato niente</h2><p>Nessuna voce o appunto su «${esc(ui.search.trim())}»</p></div>`;
  return `<div class="empty"><div class="empty-emo">${lines[0]}</div><h2>${lines[1]}</h2><p>${lines[2]}</p></div>`;
}

function noteHTML(n) {
  return `<li class="item note ${n.idea ? 'is-idea' : ''} ${ui.fresh.has(n.id) ? 'pop' : ''}" data-id="${n.id}" data-kind="note">
    <div class="swipe-bg"><span class="sw-l"></span><span class="sw-r">${icon('trash')}</span></div>
    <div class="item-body">
      <div class="item-main" data-note>
        <div class="note-title">${esc(noteTitle(n))}</div>
        ${n.title || n.text.length > noteTitle(n).length + 2 ? `<div class="note-text">${esc(n.text)}</div>` : ''}
        <div class="meta">${n.idea ? `<span class="tag idea">${icon('bulb')}Idea</span>` : ''}<span class="tag due">${icon('notes')}${noteDate(n.updatedAt || n.createdAt)}</span></div>
      </div>
    </div>
  </li>`;
}

function renderNotes() {
  const all = [...data.notes].sort((a, b) => (b.updatedAt || b.createdAt) - (a.updatedAt || a.createdAt));
  const nIdeas = all.filter((n) => n.idea).length;
  const nNotes = all.length - nIdeas;
  // Appunti | Idee: le schede compaiono solo quando c'è almeno un'idea
  const f = nIdeas ? (ui.noteFilter === 'ideas' ? 'ideas' : 'notes') : 'notes';
  const notes = !nIdeas ? all : all.filter((n) => (f === 'ideas') === !!n.idea);
  const seg = nIdeas ? `<div class="seg note-filter" id="noteFilter">
      <button class="${f === 'notes' ? 'on' : ''}" data-f="notes">${icon('notes')}Appunti <span>${nNotes}</span></button>
      <button class="${f === 'ideas' ? 'on' : ''}" data-f="ideas">${icon('bulb')}Idee <span>${nIdeas}</span></button>
    </div>` : '';
  const none = `<div class="empty small"><p>${f === 'ideas' ? 'Nessuna idea' : 'Nessun appunto'}: detta o scrivi qui sotto.</p></div>`;
  $('#main').innerHTML = all.length
    ? `${seg}${notes.length ? `<ul class="items notes">${notes.map(noteHTML).join('')}</ul>` : none}`
    : `<div class="empty"><div class="empty-emo">${icon('notes')}</div><h2>Nessun appunto</h2><p>Detta o scrivi qui sotto: idee, informazioni, cose da ricordare.<br>Da qualsiasi lista basta iniziare con <i>"prendi nota…"</i></p></div>`;
  ui.fresh.clear();
}

// ---------- Ricerca (a voce: "cerca il nome della clinica…") ----------
// ui.search = la domanda; ui.terms = parole chiave e sinonimi suggeriti dall'AI (se c'è)
function searchResults() {
  const q = norm(ui.search);
  const terms = ui.terms?.length ? ui.terms.map(norm) : words(ui.search);
  const sc = (txt) => {
    if (!terms.length) return norm(txt).includes(q) ? 1 : 0;
    const t = norm(txt);
    const ws = new Set(words(txt).map(stem));
    return terms.reduce((n, k) => n + (k.includes(' ') ? (t.includes(k) ? 2 : 0) : ws.has(stem(k)) || t.includes(k) ? 1 : 0), 0);
  };
  const rank = (arr, txt) => arr.map((x) => [x, sc(txt(x))]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]).map(([x]) => x);
  return {
    items: rank(data.items, (i) => `${i.text} ${listOf(i).name}`),
    notes: rank(data.notes, (n) => `${n.title} ${n.text}${n.idea ? ' idea idee' : ''}`),
  };
}
function clearSearch() {
  ui.search = '';
  ui.terms = null;
  ui.answer = null;
  ui.searchToken = null;
  $('#searchBox').hidden = true;
  $('#searchInput').value = '';
}
function closeSearch() { clearSearch(); render(); }

async function startSearch(query, keywords = null, { viaVoice = false } = {}) {
  ui.search = query;
  ui.terms = keywords?.length ? keywords : null;
  ui.answer = null;
  $('#searchBox').hidden = false;
  $('#searchInput').value = query;
  render();
  window.scrollTo({ top: 0 });
  buzz(8);
  if (!aiReady(settings)) return;
  // l'AI legge solo i risultati migliori e risponde in una frase
  const { items, notes } = searchResults();
  const docs = [
    ...notes.slice(0, 6).map((n) => ({ kind: n.idea ? 'idea' : 'appunto', ref: { type: 'note', id: n.id }, text: `${n.title ? n.title + ': ' : ''}${n.text}`.slice(0, 700) })),
    ...items.slice(0, 6).map((i) => ({ kind: i.done ? 'voce completata' : `voce in ${listOf(i).name}`, ref: { type: 'item', id: i.id }, text: `${i.text}${i.due ? ` (${dueLabel(i.due, i.time).text})` : ''}` })),
  ];
  if (!docs.length) return;
  const token = (ui.searchToken = {});
  ui.answer = { loading: true };
  renderMain();
  try {
    const a = await answer(query, docs, settings);
    if (ui.searchToken !== token) return;
    ui.answer = a ? { text: a.text, ref: a.source != null ? docs[a.source].ref : null } : null;
    renderMain();
    if (a && viaVoice) speak(a.text);
  } catch (err) {
    if (ui.searchToken !== token) return;
    ui.answer = null;
    renderMain();
  }
}
// Hai chiesto a voce? Allora la risposta te la leggo
function speak(text) {
  try {
    const u = new SpeechSynthesisUtterance(text);
    u.lang = settings.lang;
    speechSynthesis.cancel();
    speechSynthesis.speak(u);
  } catch (err) { /* sintesi vocale non disponibile */ }
}
// "cerca…", "trova…", "dov'è…", "qual era…", "come si chiama…" (senza AI)
const SEARCH_HEAD = /^\s*(?:(?:ok|allora|ehi)[\s,]+)?(?:cerca(?:mi)?|trova(?:mi)?|ricerca|mostra(?:mi)?|fammi\s+vedere|dov['’]?\s*è|dove\s+(?:ho\s+(?:messo|scritto|segnato|annotato)|sta|si\s+trova)|qual\s+(?:è|era)|com['’]?\s*era|come\s+si\s+chiama(?:va)?)\b[\s,:]*/iu;
function localSearch(text) {
  const t = text.trim();
  if (!SEARCH_HEAD.test(t)) return null;
  return t.replace(SEARCH_HEAD, '').replace(/[?.!]+$/, '').trim() || t;
}

function renderMain() {
  const q = norm(ui.search);
  if (inNotes() && !q) return renderNotes();
  let items = data.items;
  let ns = [];
  if (q) ({ items, notes: ns } = searchResults());
  else if (settings.view !== 'all') items = items.filter((i) => listOf(i).id === settings.view);

  // in ricerca l'ordine è per pertinenza, altrimenti per scadenza
  const open = q ? items.filter((i) => !i.done) : sortOpen(items.filter((i) => !i.done));
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const isAll = settings.view === 'all' || q;
  let html = '';

  if (q && ui.answer) {
    // un tocco sulla risposta apre l'appunto (o la voce) da cui viene
    const ref = !ui.answer.loading && ui.answer.ref;
    const src = ref && (ref.type === 'note' ? data.notes.find((n) => n.id === ref.id) : data.items.find((i) => i.id === ref.id));
    html += `<${src ? 'button' : 'div'} class="answer ${ui.answer.loading ? 'loading' : ''}" ${src ? `data-ref="${ref.type}:${ref.id}"` : ''}>
      <span class="answer-ico">${icon('sparkles')}</span>
      <span class="answer-body">${ui.answer.loading ? 'Cerco tra le tue cose…' : esc(ui.answer.text)}
        ${src ? `<span class="answer-src">${icon(ref.type === 'note' ? 'notes' : 'check')}<span>${esc(ref.type === 'note' ? noteTitle(src) : src.text)}</span>${icon('chevron')}</span>` : ''}
      </span>
    </${src ? 'button' : 'div'}>`;
  }
  if (!open.length && !ns.length) html += emptyHTML();
  else if (isAll && settings.grouped && !q) {
    for (const l of data.lists) {
      const its = open.filter((i) => listOf(i).id === l.id);
      if (!its.length) continue;
      html += `<section class="group" style="${cv(l.color)}">
        <button class="group-h" data-view="${l.id}"><span class="g-emo">${listIcon(l)}</span>${esc(l.name)}</button>
        <ul class="items">${its.map((i) => itemHTML(i, false)).join('')}</ul></section>`;
    }
  } else if (open.length) {
    html += `<ul class="items">${open.map((i) => itemHTML(i, isAll)).join('')}</ul>`;
  }
  // in ricerca compaiono anche gli appunti
  if (ns.length) {
    html += `<section class="group search-notes"><div class="group-h"><span class="g-emo">${icon('notes')}</span>Note</div><ul class="items notes">${ns.map(noteHTML).join('')}</ul></section>`;
  }

  if (done.length) {
    html += `<section class="done-sec ${settings.showDone ? 'open' : ''}">
      <div class="done-head">
        <button class="done-toggle" id="doneToggle">${icon('chevron')}Completate <span>${done.length}</span></button>
        ${settings.showDone ? `<button class="link danger" id="clearDone">Svuota</button>` : ''}
      </div>
      ${settings.showDone ? `<ul class="items">${done.slice(0, 100).map((i) => itemHTML(i, isAll)).join('')}</ul>` : ''}
    </section>`;
  }
  $('#main').innerHTML = html;
  ui.fresh.clear();
}

function renderComposer() {
  const t = targetList();
  const btn = $('#btnTarget');
  btn.innerHTML = listIcon(t);
  btn.style.setProperty('--c', t.color);
  btn.style.setProperty('--on', ink(t.color));
  const ai = aiReady(settings) && settings.aiMode === 'always';
  if (inNotes()) {
    btn.innerHTML = icon('notes');
    btn.style.setProperty('--c', 'var(--accent)');
    btn.style.setProperty('--on', 'var(--on-accent)');
    btn.title = 'Gli appunti finiscono nelle Note';
    $('#newText').placeholder = 'Scrivi un appunto…';
    return updateGoButton();
  }
  btn.title = ai ? `Se non serve altro, finisce in ${t.name}` : `Aggiungi in ${t.name}`;
  $('#newText').placeholder = ai ? 'Scrivi una nota, la smisto io…' : `Aggiungi in ${t.name}…`;
  updateGoButton();
}

function updateGoButton() {
  const hasText = !!$('#newText').value.trim();
  const go = $('#btnGo');
  go.classList.toggle('send', hasText);
  go.innerHTML = icon(hasText ? 'up' : 'mic');
  go.setAttribute('aria-label', hasText ? 'Aggiungi' : 'Detta');
}

// ---------- Azioni sulle voci ----------
function toggleDone(id) {
  const it = data.items.find((i) => i.id === id);
  if (!it) return;
  const el = document.querySelector(`.item[data-id="${id}"]`);
  const restore = snapshot();
  if (!it.done) {
    buzz(15);
    el?.classList.add('completing');
    setTimeout(() => {
      const next = complete(it);
      saveData();
      collapseThen(el, render);
      toast(next ? nextMsg(it) : 'Fatto!', 'Annulla', () => { restore(); render(); });
    }, 380);
  } else {
    it.done = false;
    it.doneAt = null;
    ui.fresh.add(it.id);
    saveData();
    render();
  }
}

function deleteItem(id) {
  const restore = snapshot();
  data.items = data.items.filter((i) => i.id !== id);
  saveData();
  collapseThen(document.querySelector(`.item[data-id="${id}"]`), render);
  buzz(10);
  toast('Voce eliminata', 'Annulla', () => { restore(); render(); });
}


function deleteNote(id) {
  const restore = snapshot();
  data.notes = data.notes.filter((n) => n.id !== id);
  saveData();
  collapseThen(document.querySelector(`.item[data-id="${id}"]`), render);
  buzz(10);
  toast('Appunto eliminato', 'Annulla', () => { restore(); render(); });
}

// Animazione di chiusura riga prima del re-render
function collapseThen(el, fn) {
  if (!el) return fn();
  el.style.height = el.offsetHeight + 'px';
  requestAnimationFrame(() => {
    el.classList.add('collapse');
    el.style.height = '0px';
  });
  setTimeout(fn, 260);
}

// ---------- Swipe sulle voci ----------
function setupSwipe() {
  const main = $('#main');
  let sw = null;
  const TH = 80; // distanza per confermare
  const FLICK = 0.45; // px/ms: una passata veloce conferma anche se corta
  const FLICK_MIN = 40;

  main.addEventListener('pointerdown', (e) => {
    const body = e.target.closest('.item-body');
    // si può partire ovunque sulla voce, anche dal cerchietto (il tocco semplice resta un clic)
    if (!body || e.button > 0 || body.closest('.item.collapse')) return;
    sw = { body, li: body.parentElement, x0: e.clientX, y0: e.clientY, dx: 0, on: false, pid: e.pointerId, t: e.timeStamp, x: e.clientX, v: 0 };
  });
  main.addEventListener('pointermove', (e) => {
    if (!sw || e.pointerId !== sw.pid) return;
    const dx = e.clientX - sw.x0;
    const dy = e.clientY - sw.y0;
    if (!sw.on) {
      // orizzontale appena prevale sul verticale (anche in diagonale)
      if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy)) {
        sw.on = true;
        try { sw.body.setPointerCapture(sw.pid); } catch (err) {}
        sw.li.classList.add('swiping');
        window.getSelection?.().removeAllRanges();
      } else if (Math.abs(dy) > 12) { sw = null; return; }
    }
    if (sw.on) {
      const dt = e.timeStamp - sw.t;
      if (dt > 0) sw.v = 0.7 * ((e.clientX - sw.x) / dt) + 0.3 * sw.v;
      sw.t = e.timeStamp;
      sw.x = e.clientX;
      // gli appunti si scorrono solo a sinistra (elimina): non c'è niente da completare
      const d = sw.li.dataset.kind === 'note' ? Math.min(dx, 0) : dx;
      sw.dx = d;
      sw.body.style.transform = `translateX(${d}px)`;
      sw.li.dataset.dir = d > 0 ? 'right' : 'left';
      const armed = Math.abs(d) > TH;
      if (armed !== sw.li.classList.contains('armed')) { buzz(5); sw.li.classList.toggle('armed', armed); }
    }
  });
  const end = (e) => {
    if (!sw || (e && e.pointerId !== sw.pid)) return;
    const { body, li, dx, on, v } = sw;
    sw = null;
    if (!on) return;
    ui.suppressClick = true;
    setTimeout(() => (ui.suppressClick = false), 80);
    li.classList.remove('swiping');
    const flick = dx !== 0 && Math.abs(v) > FLICK && Math.abs(dx) > FLICK_MIN && Math.sign(v) === Math.sign(dx);
    if (Math.abs(dx) > TH || flick) {
      body.style.transition = 'transform .2s ease';
      body.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`;
      const id = li.dataset.id;
      const note = li.dataset.kind === 'note';
      setTimeout(() => (note ? deleteNote(id) : dx > 0 ? toggleDoneImmediate(id) : deleteItem(id)), 180);
    } else {
      body.style.transition = 'transform .25s cubic-bezier(.2,.9,.3,1.2)';
      body.style.transform = '';
      setTimeout(() => (body.style.transition = ''), 260);
    }
  };
  main.addEventListener('pointerup', end);
  main.addEventListener('pointercancel', end);
  // niente menu/selezione del testo con la pressione lunga sulle voci
  main.addEventListener('contextmenu', (e) => { if (e.target.closest('.item-body')) e.preventDefault(); });
}

function toggleDoneImmediate(id) {
  const it = data.items.find((i) => i.id === id);
  if (!it) return;
  const restore = snapshot();
  let next = null;
  if (it.done) { it.done = false; it.doneAt = null; } else next = complete(it);
  saveData();
  buzz(15);
  collapseThen(document.querySelector(`.item[data-id="${id}"]`), render);
  toast(next ? nextMsg(it) : it.done ? 'Fatto!' : 'Di nuovo da fare', 'Annulla', () => { restore(); render(); });
}

// ---------- Toast ----------
let toastTimer;
function toast(text, action, fn) {
  const t = $('#toast');
  $('#toastText').textContent = text;
  const b = $('#toastAction');
  b.hidden = !action;
  b.textContent = action || '';
  b.onclick = () => { hideToast(); fn?.(); };
  // popover = livello più alto: resta toccabile anche sopra i pannelli aperti
  if (t.matches(':popover-open')) t.hidePopover();
  t.showPopover?.();
  requestAnimationFrame(() => t.classList.add('show'));
  clearTimeout(toastTimer);
  toastTimer = setTimeout(hideToast, action ? 4500 : 3000);
}
function hideToast() {
  const t = $('#toast');
  t.classList.remove('show');
  setTimeout(() => { if (!t.classList.contains('show') && t.matches(':popover-open')) t.hidePopover(); }, 250);
}

// ---------- Bottom sheet ----------
const sheet = $('#sheet');
function openSheet(html, onMount) {
  $('#sheetBody').innerHTML = html;
  if (!sheet.open) sheet.showModal();
  sheet.classList.remove('closing');
  onMount?.($('#sheetBody'));
}
function closeSheet() {
  if (!sheet.open) return;
  sheet.classList.add('closing');
  setTimeout(() => { sheet.close(); sheet.classList.remove('closing'); }, 200);
}
sheet.addEventListener('click', (e) => { if (e.target === sheet) closeSheet(); });
sheet.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(); });

// Trascina giù per chiudere
(() => {
  let y0 = null;
  sheet.addEventListener('touchstart', (e) => {
    if (e.target.closest('.sheet-handle') || ($('#sheetBody').scrollTop <= 0 && e.target.closest('.sheet-head'))) y0 = e.touches[0].clientY;
  }, { passive: true });
  sheet.addEventListener('touchmove', (e) => {
    if (y0 == null) return;
    const dy = Math.max(0, e.touches[0].clientY - y0);
    sheet.style.transform = `translateY(${dy}px)`;
  }, { passive: true });
  sheet.addEventListener('touchend', (e) => {
    if (y0 == null) return;
    const dy = e.changedTouches[0].clientY - y0;
    y0 = null;
    sheet.style.transform = '';
    if (dy > 100) closeSheet();
  });
})();

// ---------- Modifica voce ----------
const REPEAT_OPTS = [[null, 'Mai'], [{ every: 'day', n: 1, days: null }, 'Ogni giorno'], [{ every: 'week', n: 1, days: [1, 2, 3, 4, 5] }, 'Lun–ven'], [{ every: 'week', n: 1, days: null }, 'Ogni settimana'], [{ every: 'month', n: 1, days: null }, 'Ogni mese']];
const REMIND_OPTS = [[null, 'Nessun avviso'], [0, "All'ora"], [10, '10 min prima'], [30, '30 min prima'], [60, '1 ora prima'], [1440, '1 giorno prima']];
function editItem(id) {
  const it = data.items.find((i) => i.id === id);
  if (!it) return;
  const restore = snapshot();
  const dueOpts = [['Oggi', addDays(0)], ['Domani', addDays(1)], ['Tra una settimana', addDays(7)]];
  openSheet(`
    <div class="sheet-head"><h2>Modifica voce</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <textarea id="eText" rows="2" class="field big">${esc(it.text)}</textarea>
    <label class="lbl">Lista</label>
    <div class="list-pick" id="eList">${data.lists.map((l) => `<button class="chip ${l.id === listOf(it).id ? 'on' : ''}" data-id="${l.id}" style="${cv(l.color)}">${listIcon(l, 'chip-emo')}${esc(l.name)}</button>`).join('')}</div>
    <label class="lbl">Scadenza</label>
    <div class="row wrap" id="eDue">
      ${dueOpts.map(([t, v]) => `<button class="chip soft ${it.due === v ? 'on' : ''}" data-due="${v}">${t}</button>`).join('')}
      <label class="chip soft date ${it.due && !dueOpts.some(([, v]) => v === it.due) ? 'on' : ''}">${icon('calendar')}<span>${it.due && !dueOpts.some(([, v]) => v === it.due) ? dueLabel(it.due).text : 'Data…'}</span><input type="date" id="eDate" value="${it.due || ''}"></label>
      ${it.due ? `<button class="chip soft" data-due="">${icon('x')}Nessuna</button>` : ''}
    </div>
    <label class="lbl">Orario</label>
    <div class="row wrap" id="eTimeRow">
      <label class="chip soft date ${it.time ? 'on' : ''}">${icon('clock')}<span>${it.time || 'Orario…'}</span><input type="time" id="eTime" value="${it.time || ''}"></label>
      ${it.time ? `<button class="chip soft" data-time="">${icon('x')}Nessuno</button>` : ''}
    </div>
    <label class="lbl">Ripeti</label>
    <div class="row wrap" id="eRepeat">
      ${REPEAT_OPTS.map(([v, t]) => `<button class="chip soft ${sameRepeat(it.repeat, v) ? 'on' : ''}" data-rep='${JSON.stringify(v)}'>${v ? icon('repeat') : ''}${t}</button>`).join('')}
      ${it.repeat && !REPEAT_OPTS.some(([v]) => sameRepeat(it.repeat, v)) ? `<button class="chip soft on" data-rep='${JSON.stringify(it.repeat)}'>${icon('repeat')}${repeatLabel(it.repeat)}</button>` : ''}
    </div>
    <label class="lbl">Avviso</label>
    <div class="row wrap" id="eRemind">
      ${REMIND_OPTS.map(([v, t]) => `<button class="chip soft ${(it.remind ?? null) === v ? 'on' : ''}" data-remind="${v ?? ''}">${v == null ? '' : icon('bell')}${t}</button>`).join('')}
    </div>
    ${remindAt(it) ? `<p class="muted small">${icon('bell')} Avviso ${dueLabel(dayKey(new Date(remindAt(it)))).text.replace(/ \d.*/, '').toLowerCase()} alle ${fmtTime(remindAt(it))}${settings.ntfyTopic ? '' : ' · arriva se MyList è aperta o in background (per averlo sempre: Impostazioni → Promemoria)'}</p>` : ''}
    <button class="link-btn top-gap" id="eToNote">${icon('notes')}Non è una cosa da fare: spostala nelle Note</button>
    <div class="row top-gap">
      <button class="pill-btn danger ghost grow" id="eDel">${icon('trash')}Elimina</button>
      <button class="pill-btn grow" data-close>Fatto</button>
    </div>
  `, (root) => {
    const commit = () => { saveData(); render(); };
    $('#eToNote', root).addEventListener('click', () => {
      const now = Date.now();
      data.items = data.items.filter((i) => i.id !== id);
      const note = { id: it.id, title: '', text: it.text, createdAt: it.createdAt || now, updatedAt: now };
      data.notes.unshift(note);
      ui.fresh.add(it.id);
      autoTitle(note);
      saveData();
      closeSheet();
      render();
      toast('Spostata nelle Note', 'Annulla', () => { restore(); render(); });
    });
    const ta = $('#eText', root);
    ta.addEventListener('input', () => { it.text = ta.value.replace(/\n/g, ' '); commit(); });
    $('#eList', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      it.listId = b.dataset.id;
      root.querySelectorAll('#eList .chip').forEach((c) => c.classList.toggle('on', c === b));
      commit();
    });
    $('#eDue', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-due]');
      if (!b) return;
      it.due = b.dataset.due || null;
      if (!it.due) { it.time = null; it.remind = null; it.repeat = null; }
      settle(it);
      commit();
      editItem(id);
    });
    $('#eDate', root).addEventListener('change', (e) => { it.due = e.target.value || null; settle(it); commit(); editItem(id); });
    const setTime = (v) => {
      it.time = v || null;
      if (it.time && !it.due) it.due = dayFor(it.time);
      if (!it.time) it.remind = null;
      settle(it);
      commit();
      editItem(id);
    };
    $('#eTime', root).addEventListener('change', (e) => setTime(e.target.value));
    $('#eTimeRow', root).addEventListener('click', (e) => { if (e.target.closest('[data-time]')) setTime(''); });
    $('#eRepeat', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-rep]');
      if (!b) return;
      it.repeat = JSON.parse(b.dataset.rep);
      if (it.repeat) {
        // "ogni settimana" = nello stesso giorno della scadenza
        if (it.repeat.every === 'week' && !it.repeat.days) it.repeat = { ...it.repeat, days: [new Date((it.due || dayKey(new Date())) + 'T12:00:00').getDay()] };
        if (!it.due) it.due = firstDue(it.repeat, it.time);
      }
      settle(it);
      commit();
      editItem(id);
    });
    $('#eRemind', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-remind]');
      if (!b) return;
      it.remind = b.dataset.remind === '' ? null : +b.dataset.remind;
      if (it.remind != null && !it.time) it.time = '09:00';
      if (it.time && !it.due) it.due = dayFor(it.time);
      settle(it);
      commit();
      editItem(id);
      if (it.remind != null) nudgeNotify();
    });
    $('#eDel', root).addEventListener('click', () => {
      closeSheet();
      data.items = data.items.filter((i) => i.id !== id);
      saveData();
      render();
      toast('Voce eliminata', 'Annulla', () => { restore(); render(); });
    });
  });
}

// ---------- Appunto ----------
function editNote(id) {
  const n = data.notes.find((x) => x.id === id);
  if (!n) return;
  const restore = snapshot();
  const created = new Date(n.createdAt).toLocaleString('it-IT', { weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' });
  openSheet(`
    <div class="sheet-head"><h2>${n.idea ? 'Idea' : 'Appunto'}</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <input id="nTitle" data-id="${n.id}" class="field note-title-field" placeholder="${aiReady(settings) ? 'Titolo (lo scrive l\'AI)' : 'Titolo'}" value="${esc(n.title)}" autocomplete="off">
    <textarea id="nText" class="field note-body" placeholder="Scrivi o detta qui il tuo appunto…">${esc(n.text)}</textarea>
    <p class="muted small">${icon('notes')} Creato ${created}${n.updatedAt && n.updatedAt - n.createdAt > 60000 ? ` · modificato ${noteDate(n.updatedAt).toLowerCase()}` : ''}</p>
    <div class="row wrap">
      <button class="chip soft ${n.idea ? 'on' : ''}" id="nIdea">${icon('bulb')}${n.idea ? 'È un\'idea' : 'Segna come idea'}</button>
      <button class="pill-btn ghost" id="nCopy">${icon('copy')}Copia</button>
      ${navigator.share ? `<button class="pill-btn ghost" id="nShare">${icon('share')}Condividi</button>` : ''}
    </div>
    <button class="link-btn top-gap" id="nToItem">${icon('check')}È una cosa da fare: spostalo in ${esc(targetList().name)}</button>
    <div class="row top-gap">
      <button class="pill-btn danger ghost grow" id="nDel">${icon('trash')}Elimina</button>
      <button class="pill-btn grow" data-close>Fatto</button>
    </div>
  `, (root) => {
    const ta = $('#nText', root);
    const fit = () => { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight + 2, innerHeight * 0.5) + 'px'; };
    fit();
    const commit = () => { n.updatedAt = Date.now(); saveData(); renderHeader(); renderChips(); renderMain(); };
    ta.addEventListener('input', () => { n.text = ta.value; fit(); commit(); });
    // scrivi tu il titolo → l'AI non lo tocca più; cancellalo → torna a scriverlo lei
    $('#nTitle', root).addEventListener('input', (e) => { n.title = e.target.value.trim(); n.userTitle = !!n.title; n.titleFor = null; commit(); });
    sheet.addEventListener('close', () => { if (data.notes.includes(n)) autoTitle(n); }, { once: true });
    if (!n.title) autoTitle(n);
    const full = () => (n.title ? `${n.title}\n\n${n.text}` : n.text);
    $('#nIdea', root).onclick = (e) => {
      n.idea = !n.idea;
      e.currentTarget.classList.toggle('on', n.idea);
      e.currentTarget.innerHTML = `${icon('bulb')}${n.idea ? 'È un\'idea' : 'Segna come idea'}`;
      saveData();
      renderMain();
    };
    $('#nCopy', root).onclick = async () => {
      try { await navigator.clipboard.writeText(full()); toast('Copiato'); } catch (err) { toast('Copia non riuscita'); }
    };
    $('#nShare', root)?.addEventListener('click', () => navigator.share({ title: n.title || 'Appunto', text: full() }).catch(() => {}));
    $('#nToItem', root).onclick = () => {
      const now = Date.now();
      data.notes = data.notes.filter((x) => x.id !== id);
      data.items.push({ id: n.id, text: n.text.replace(/\s*\n+\s*/g, ' ').trim() || n.title, listId: targetList().id, done: false, due: null, createdAt: now });
      ui.fresh.add(n.id);
      saveData();
      closeSheet();
      render();
      toast(`Spostato in ${targetList().name}`, 'Annulla', () => { restore(); render(); });
    };
    $('#nDel', root).onclick = () => {
      closeSheet();
      data.notes = data.notes.filter((x) => x.id !== id);
      saveData();
      render();
      toast('Appunto eliminato', 'Annulla', () => { restore(); render(); });
    };
  });
}

// ---------- Crea / modifica lista ----------
function editList(id) {
  const l = id ? listById(id) : null;
  const draft = l ? { ...l } : { name: '', icon: 'clipboard-list', color: nextColor() };
  const count = l ? data.items.filter((i) => listOf(i).id === l.id).length : 0;
  openSheet(`
    <div class="sheet-head"><h2>${l ? 'Modifica lista' : 'Nuova lista'}</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="list-preview" id="lPrev"></div>
    <input id="lName" class="field big" placeholder="Nome della lista" value="${esc(draft.name)}" maxlength="30" autocomplete="off">
    <label class="lbl">Icona</label>
    <div class="emoji-grid" id="lEmo">${LIST_ICONS.map((e) => `<button class="${e === draft.icon ? 'on' : ''}" data-e="${e}" aria-label="${e}">${listIcon({ icon: e })}</button>`).join('')}</div>
    <label class="lbl">Colore</label>
    <div class="swatches" id="lCol">${LIST_COLORS.map((c) => `<button class="${c === draft.color ? 'on' : ''}" data-c="${c}" style="${cv(c)}" aria-label="Colore ${c}"></button>`).join('')}</div>
    <button class="pill-btn wide top-gap" id="lSave">${l ? 'Salva' : 'Crea lista'}</button>
    ${l ? `<button class="pill-btn wide danger ghost" id="lDel">${icon('trash')}Elimina lista${count ? ` (${count} ${count === 1 ? 'voce' : 'voci'})` : ''}</button>` : ''}
  `, (root) => {
    const prev = () => {
      $('#lPrev', root).innerHTML = `<span class="chip on" style="${cv(draft.color)}">${listIcon(draft, 'chip-emo')}${esc(draft.name || 'Nuova lista')}</span>`;
    };
    prev();
    const name = $('#lName', root);
    if (!l) setTimeout(() => name.focus(), 250);
    name.addEventListener('input', () => { draft.name = name.value; prev(); });
    name.addEventListener('keydown', (e) => { if (e.key === 'Enter') $('#lSave', root).click(); });
    $('#lEmo', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-e]');
      if (!b) return;
      draft.icon = b.dataset.e;
      root.querySelectorAll('#lEmo button').forEach((x) => x.classList.toggle('on', x === b));
      prev();
    });
    $('#lCol', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-c]');
      if (!b) return;
      draft.color = b.dataset.c;
      root.querySelectorAll('#lCol button').forEach((x) => x.classList.toggle('on', x === b));
      prev();
    });
    $('#lSave', root).addEventListener('click', () => {
      const n = draft.name.trim();
      if (!n) { name.focus(); name.classList.add('shake'); setTimeout(() => name.classList.remove('shake'), 400); return; }
      if (l) Object.assign(l, { name: n, icon: draft.icon, color: draft.color });
      else {
        const nl = { id: uid(), name: n, icon: draft.icon, color: draft.color };
        data.lists.push(nl);
        settings.view = nl.id;
        saveSettings();
      }
      saveData();
      closeSheet();
      render();
    });
    $('#lDel', root)?.addEventListener('click', () => confirmDeleteList(l, count));
  });
}

// afterDelete: cosa mostrare dopo (es. tornare a "Gestisci liste"); di default chiude
function confirmDeleteList(l, count, afterDelete) {
  if (data.lists.length <= 1) {
    toast('Serve almeno una lista: creane un\'altra prima di eliminare questa');
    return;
  }
  const others = data.lists.filter((x) => x.id !== l.id);
  const doDelete = (moveTo) => {
    const restore = snapshot();
    if (moveTo) data.items.forEach((i) => { if (i.listId === l.id) i.listId = moveTo; });
    else data.items = data.items.filter((i) => i.listId !== l.id);
    data.lists = data.lists.filter((x) => x.id !== l.id);
    if (settings.view === l.id) settings.view = 'all';
    if (settings.target === l.id) settings.target = data.lists[0].id;
    saveData();
    saveSettings();
    buzz(12);
    if (afterDelete) afterDelete(); else closeSheet();
    render();
    toast(`Lista "${l.name}" eliminata`, 'Annulla', () => { restore(); render(); if (afterDelete) afterDelete(); });
  };
  if (!count) return doDelete(null);
  openSheet(`
    <div class="sheet-head"><h2>Eliminare "${esc(l.name)}"?</h2></div>
    <p class="muted">Contiene ${count} ${count === 1 ? 'voce' : 'voci'}. Cosa ne facciamo?</p>
    <button class="pill-btn wide danger" id="dAll">${icon('trash')}Elimina lista e voci</button>
    <label class="lbl">Oppure sposta le voci in…</label>
    <div class="list-pick" id="dMove">${others.map((o) => `<button class="chip" data-id="${o.id}" style="${cv(o.color)}">${listIcon(o, 'chip-emo')}${esc(o.name)}</button>`).join('')}</div>
    <button class="pill-btn wide ghost top-gap" id="dCancel">Annulla</button>
  `, (root) => {
    $('#dAll', root).onclick = () => doDelete(null);
    $('#dMove', root).onclick = (e) => { const b = e.target.closest('[data-id]'); if (b) doDelete(b.dataset.id); };
    $('#dCancel', root).onclick = () => (afterDelete ? afterDelete() : closeSheet());
  });
}

// ---------- Gestisci liste ----------
function manageLists() {
  const rows = data.lists.map((l) => {
    const its = data.items.filter((i) => listOf(i).id === l.id);
    const n = its.filter((i) => !i.done).length;
    return `<div class="mrow" style="${cv(l.color)}">
      <span class="m-emo">${listIcon(l)}</span>
      <span class="m-name"><b>${esc(l.name)}</b><small>${n ? (n === 1 ? '1 da fare' : `${n} da fare`) : its.length ? 'Solo completate' : 'Vuota'}</small></span>
      <button class="icon-btn" data-edit-list="${l.id}" aria-label="Modifica ${esc(l.name)}">${icon('pencil')}</button>
      <button class="icon-btn danger" data-del-list="${l.id}" aria-label="Elimina ${esc(l.name)}">${icon('trash')}</button>
    </div>`;
  }).join('');
  openSheet(`
    <div class="sheet-head"><h2>Le tue liste</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button></div>
    <div class="mlist">${rows}</div>
    <button class="pill-btn wide top-gap" id="mNew">${icon('plus')}Nuova lista</button>
  `, (root) => {
    root.querySelector('.mlist').addEventListener('click', (e) => {
      const ed = e.target.closest('[data-edit-list]');
      const del = e.target.closest('[data-del-list]');
      if (ed) editList(ed.dataset.editList);
      if (del) {
        const l = listById(del.dataset.delList);
        confirmDeleteList(l, data.items.filter((i) => listOf(i).id === l.id).length, manageLists);
      }
    });
    $('#mNew', root).onclick = () => editList(null);
  });
}

// ---------- Impostazioni: IA di Chrome ----------
function chromeAIBox() {
  const st = chromeAI.state;
  const line = (cls, ico, html) => `<p class="ai-status ${cls}">${icon(ico)}<span>${html}</span></p>`;
  if (st === 'available') {
    return line('ok', 'check', settings.chromeAI
      ? `<b>Presente e attiva</b>: risponde per prima, gratis e sul dispositivo.${settings.apiKey ? ' Se non ce la fa, passa a OpenRouter.' : ''}`
      : '<b>Presente</b> su questo dispositivo, ma spenta.');
  }
  if (st === 'downloadable') return `${line('', 'download', '<b>Presente</b>, ma il modello va scaricato una volta (qualche GB, meglio col Wi-Fi).')}<button class="pill-btn wide ghost" id="sChromeDl">${icon('download')}Scarica l'IA di Chrome</button>`;
  if (st === 'downloading') return line('', 'download', `<b>Download in corso…</b> ${Math.round(chromeAI.progress * 100)}%`);
  if (st === 'unavailable') return line('muted', 'warn', '<b>Non utilizzabile</b>: questo dispositivo non ha i requisiti (servono molta memoria e spazio libero).');
  return line('muted', 'warn', "<b>Non presente</b> in questo browser: per ora c'è solo su Chrome per computer, su Android non ancora.");
}
function bindChromeAI(root) {
  const box = $('#sChromeAI', root);
  const refresh = () => { box.innerHTML = chromeAIBox(); bindChromeAI(root); renderComposer(); };
  $('#sChromeDl', root)?.addEventListener('click', async () => {
    try {
      await downloadChromeAI(() => { box.innerHTML = chromeAIBox(); });
      toast('IA di Chrome pronta');
    } catch (err) {
      await detectChromeAI();
      toast(`Download non riuscito: ${err.message}`);
    }
    refresh();
  });
  const on = $('#sChromeOn', root);
  if (on) on.onchange = () => { settings.chromeAI = on.checked; saveSettings(); refresh(); };
  const test = $('#sChromeTest', root);
  if (test) test.onclick = async () => {
    const st = $('#sChromeStatus', root);
    st.className = 'status small';
    st.textContent = 'Controllo…';
    await detectChromeAI();
    refresh();
    if (chromeAI.state !== 'available') {
      st.classList.add('err');
      st.textContent = chromeAI.state === 'downloadable' ? 'C\'è, ma prima va scaricata.' : chromeAI.state === 'downloading' ? 'Sta ancora scaricando, riprova tra poco.' : 'Non disponibile su questo browser.';
      return;
    }
    st.textContent = 'Presente, le faccio una domanda…';
    try {
      const r = await testConnection(settings, 'chrome');
      st.classList.add('ok');
      st.textContent = `Funziona! Ha risposto "${r.reply.slice(0, 20)}" in ${r.ms} ms`;
    } catch (err) {
      st.classList.add('err');
      st.textContent = `Errore: ${err.message}`;
    }
  };
}

// ---------- Impostazioni: promemoria ----------
function notifyRow() {
  const p = notifyPermission();
  if (!notifySupported) return `<span class="muted small">${icon('warn')} Non supportate da questo browser</span>`;
  if (p === 'granted') return `<span class="ok-badge">${icon('check')}Attive</span>`;
  if (p === 'denied') return `<span class="muted small">${icon('warn')} Bloccate: riattivale dalle impostazioni del sito in Chrome (lucchetto → Autorizzazioni)</span>`;
  return `<button class="pill-btn ghost" id="sNotify">${icon('bell')}Attiva notifiche</button>`;
}
function ntfyBox() {
  const t = settings.ntfyTopic;
  if (!t) return `<p class="muted small">Con l'app gratuita <b>ntfy</b> gli avvisi arrivano all'ora giusta anche con MyList chiusa e il telefono in tasca.</p>`;
  return `<ol class="steps">
      <li><span>Installa <b>ntfy</b> dal Play Store</span><a class="pill-btn ghost small-btn" href="https://play.google.com/store/apps/details?id=io.heckel.ntfy" target="_blank" rel="noopener">Play Store</a></li>
      <li><span>Collega MyList: si apre ntfy e si iscrive al tuo canale</span><a class="pill-btn small-btn" href="${ntfyLink(t)}">${icon('bell')}Collega</a></li>
      <li><span>Controlla che arrivi e che suoni</span><button class="pill-btn ghost small-btn" id="sNtfyTest">${icon('send')}Prova</button></li>
    </ol>
    <p class="status small" id="sNtfyStatus"></p>
    <p class="muted small">Canale privato: <code>${esc(t)}</code><br>Il testo dei promemoria passa dal server ntfy.sh, che lo consegna al telefono (si programma fino a 3 giorni prima; gli avvisi più lontani partono alle aperture successive di MyList). In ntfy attiva la <i>consegna istantanea</i> per non avere ritardi.</p>
    <div class="howto">
      <b>${icon('bell')} Per farlo suonare finché non rispondi</b>
      <ol>
        <li>In ntfy tocca il canale <b>MyList</b> → menu ⋮ → <b>Impostazioni</b> dell'iscrizione</li>
        <li>Attiva <b>Avvisi insistenti</b> (<i>Insistent max priority</i>): suona e vibra di continuo finché non tocchi la notifica</li>
        <li>Per cambiare la suoneria: impostazioni Android → App → ntfy → Notifiche → <b>Priorità massima</b> → Suono (lì puoi anche fargli ignorare il <i>Non disturbare</i>)</li>
      </ol>
      <p>I nomi delle voci possono cambiare un po' tra versioni di ntfy e di Android.</p>
    </div>
    <p class="muted small">${icon('bell')} Sulla notifica trovi <b>Fatto</b> e <b>+10 min</b>: funzionano senza aprire MyList. I "Fatto" vengono spuntati qui quando riapri l'app (entro 12 ore).</p>`;
}
function bindReminderSettings(root) {
  const bindNotify = () => $('#sNotify', root)?.addEventListener('click', async () => {
    await askNotify();
    $('#sNotifyRow', root).innerHTML = notifyRow();
    bindNotify();
  });
  bindNotify();
  const bindTest = () => $('#sNtfyTest', root)?.addEventListener('click', async () => {
    const st = $('#sNtfyStatus', root);
    st.className = 'status small';
    st.textContent = 'Invio…';
    try {
      await sendTest(settings.ntfyTopic);
      st.classList.add('ok');
      st.textContent = 'Inviato: ti è arrivata la notifica di ntfy?';
    } catch (err) {
      st.classList.add('err');
      st.textContent = `Errore: ${err.message}`;
    }
  });
  bindTest();
  $('#sNtfy', root).addEventListener('click', (e) => {
    const b = e.target.closest('[data-v]');
    if (!b) return;
    settings.ntfyTopic = b.dataset.v === 'on' ? (settings.ntfyTopic || ui.lastTopic || newTopic()) : '';
    if (settings.ntfyTopic) ui.lastTopic = settings.ntfyTopic;
    saveSettings();
    $('#sNtfy', root).querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    $('#sNtfyBox', root).innerHTML = ntfyBox();
    bindTest();
    window.dispatchEvent(new Event('mylist:saved'));
  });
}

// ---------- Impostazioni ----------
function openSettings() {
  const seg = (name, val, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button class="${val === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>`;
  openSheet(`
    <div class="sheet-head"><h2>Impostazioni</h2><button class="icon-btn" data-close aria-label="Chiudi">${icon('x')}</button></div>

    ${ui.installEvt ? `<button class="install-card" id="sInstall">${icon('phone')}<span><b>Installa MyList</b><small>Aggiungila alla schermata Home, si apre come un'app</small></span></button>` : ''}

    <section class="card">
      <h3>${icon('sparkles')}Smistamento intelligente</h3>
      <p class="muted small">Con una chiave OpenRouter, quando detti una frase tipo <i>"compra latte e uova e domani chiama il commercialista"</i> MyList crea più voci e le mette nelle liste giuste.</p>
      <label class="lbl">Chiave API OpenRouter</label>
      <div class="key-row">
        <input id="sKey" class="field" type="password" placeholder="sk-or-v1-…" value="${esc(settings.apiKey)}" autocomplete="off" spellcheck="false">
        <button class="icon-btn" id="sKeyShow" aria-label="Mostra chiave">${icon('eye')}</button>
      </div>
      <a class="link small" href="https://openrouter.ai/keys" target="_blank" rel="noopener">Crea una chiave su openrouter.ai →</a>

      <label class="lbl">Modello</label>
      <button class="model-btn" id="sModel"><span><b id="sModelName">${esc(settings.model)}</b><small>Tocca per scegliere tra i consigliati</small></span>${icon('chevron')}</button>

      <label class="lbl">Quando usarlo</label>
      ${seg('aiMode', settings.aiMode, [['always', 'Sempre'], ['voice', 'Solo dettatura'], ['off', 'Mai']])}
      <p class="muted small">L'AI capisce la nota e dove vuoi metterla ("mettilo nel lavoro", "per casa"…). Se non lo dici, sceglie lei la lista più adatta.</p>

      <button class="pill-btn wide ghost top-gap" id="sTest" ${settings.apiKey ? '' : 'disabled'}>${icon('bolt')}Prova OpenRouter</button>
      <p class="status small" id="sStatus"></p>
    </section>

    <section class="card">
      <h3>${icon('globe')}IA di Chrome</h3>
      <p class="muted small">L'IA integrata nel browser: gratis, senza chiave e senza mandare nulla in rete. Meno brava di OpenRouter con le frasi complicate.</p>
      <div id="sChromeAI">${chromeAIBox()}</div>
      <label class="switch-row">
        <span><b>Usala per prima</b><small>Risponde lei; OpenRouter resta di riserva</small></span>
        <input type="checkbox" class="switch" id="sChromeOn" ${settings.chromeAI ? 'checked' : ''}>
      </label>
      <button class="pill-btn wide ghost top-gap" id="sChromeTest">${icon('bolt')}Prova l'IA di Chrome</button>
      <p class="status small" id="sChromeStatus"></p>
    </section>

    <section class="card">
      <h3>${icon('mic')}Dettatura</h3>
      <select id="sLang" class="field">
        ${[['it-IT', 'Italiano'], ['en-US', 'English (US)'], ['en-GB', 'English (UK)'], ['es-ES', 'Español'], ['fr-FR', 'Français'], ['de-DE', 'Deutsch']].map(([v, t]) => `<option value="${v}" ${settings.lang === v ? 'selected' : ''}>${t}</option>`).join('')}
      </select>
      <label class="lbl">Pausa prima dell'invio automatico</label>
      ${seg('pause', settings.pause, [['short', 'Breve'], ['normal', 'Normale'], ['long', 'Lunga']])}
      <p class="muted small">Quando smetti di parlare la nota parte da sola. Se ti fermi a metà frase ("compra il latte e…") aspetto un po' di più.</p>
      ${voiceSupported ? '' : `<p class="muted small">${icon('warn')} Questo browser non supporta la dettatura: usa Chrome su Android, oppure il microfono della tastiera.</p>`}
    </section>

    <section class="card">
      <h3>${icon('bell')}Promemoria</h3>
      <p class="muted small">Di' o scrivi <i>"alle 16 prendere la pasticca, avvisami mezz'ora prima"</i> oppure <i>"ricordami tra 20 minuti di aprire il cancello"</i>.</p>
      <label class="lbl">Come suonano</label>
      ${seg('alertLevel', settings.alertLevel, [['loud', 'Forte'], ['normal', 'Normale']])}
      <p class="muted small"><b>Forte</b>: suona tre volte, vibra a lungo e compare sopra le altre app. <b>Normale</b>: un solo din-don e una vibrazione breve.</p>
      <button class="pill-btn wide ghost" id="sChime">${icon('bell')}Senti il suono</button>

      <label class="lbl">Notifiche di questo telefono</label>
      <div class="row wrap" id="sNotifyRow">${notifyRow()}</div>
      <p class="muted small">Arrivano se MyList è aperta o in background da poco: un'app web non può svegliarsi da sola a telefono in tasca.</p>

      <label class="lbl">Avvisi sicuri anche ad app chiusa</label>
      <div class="seg" id="sNtfy"><button class="${settings.ntfyTopic ? '' : 'on'}" data-v="off">Spenti</button><button class="${settings.ntfyTopic ? 'on' : ''}" data-v="on">Con ntfy</button></div>
      <div id="sNtfyBox">${ntfyBox()}</div>
    </section>

    <section class="card">
      <h3>${icon('eye')}Aspetto</h3>
      <div class="theme-grid" data-seg="theme">
        ${THEMES.map(([v, name, bg, sf]) => `<button class="${settings.theme === v ? 'on' : ''}" data-v="${v}"><span class="theme-prev ${v === 'auto' ? 'auto' : ''}" style="${bg ? `--pb:${bg};--ps:${sf}` : ''}"></span>${name}</button>`).join('')}
      </div>
    </section>

    <section class="card">
      <h3>${icon('tag')}Liste</h3>
      <p class="muted small">Rinomina, cambia colore o elimina le tue liste.</p>
      <button class="pill-btn wide ghost" id="sLists">${icon('pencil')}Gestisci liste</button>
    </section>

    <section class="card">
      <h3>${icon('bolt')}Scorciatoie</h3>
      <ul class="tips">
        <li><code>#spesa</code> manda la voce nella lista Spesa</li>
        <li><i>oggi</i>, <i>domani</i>, <i>venerdì</i>, <i>il 5 novembre</i> impostano la scadenza</li>
        <li><i>alle 16</i>, <i>tra 20 minuti</i>, <i>avvisami mezz'ora prima</i> impostano orario e avviso</li>
        <li><i>ogni giorno alle 8</i>, <i>il lunedì</i>, <i>dal lunedì al venerdì</i> la fanno ripetere</li>
        <li><i>cerca…</i>, <i>trova…</i>, <i>qual era…</i> cercano tra voci e appunti (con l'AI ti risponde anche)</li>
        <li><i>prendi nota…</i>, <i>appunto…</i>, <i>segna che…</i> salvano un appunto nelle Note (con l'AI lo capisce anche da solo)</li>
        <li><i>si potrebbe…</i>, <i>magari…</i>, <i>sarebbe bello…</i>, <i>idea…</i> diventano Idee</li>
        <li>Scorri a destra ${icon('check')} per completare, a sinistra ${icon('trash')} per eliminare</li>
        <li>Tieni premuta l'icona dell'app sul telefono → <b>Detta</b> per dettare al volo</li>
      </ul>
    </section>

    <section class="card">
      <h3>${icon('download')}Dati</h3>
      <p class="muted small">Tutto resta salvato su questo telefono. Fai un backup ogni tanto.</p>
      <div class="row wrap">
        <button class="pill-btn ghost" id="sExport">${icon('download')}Esporta</button>
        <button class="pill-btn ghost" id="sImport">${icon('upload')}Importa</button>
        <button class="pill-btn ghost danger" id="sReset">${icon('trash')}Azzera tutto</button>
      </div>
    </section>
    <p class="foot">MyList ${VERSION} · Icone <a href="https://www.flaticon.com/uicons" target="_blank" rel="noopener">UIcons by Flaticon</a></p>
  `, (root) => {
    const key = $('#sKey', root);
    key.addEventListener('input', () => {
      settings.apiKey = key.value.trim();
      saveSettings();
      renderComposer();
      $('#sTest', root).disabled = !settings.apiKey;
      $('#sChromeAI', root).innerHTML = chromeAIBox();
      bindChromeAI(root);
    });
    $('#sKeyShow', root).onclick = () => { key.type = key.type === 'password' ? 'text' : 'password'; };
    $('#sModel', root).onclick = () => openModelPicker();
    root.querySelectorAll('[data-seg]').forEach((s) => s.addEventListener('click', (e) => {
      const b = e.target.closest('[data-v]');
      if (!b) return;
      settings[s.dataset.seg] = b.dataset.v;
      s.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
      saveSettings();
      if (s.dataset.seg === 'theme') applyTheme();
      if (s.dataset.seg === 'alertLevel') window.dispatchEvent(new Event('mylist:saved')); // riprogramma ntfy col nuovo livello
      render();
    }));
    $('#sLang', root).onchange = (e) => { settings.lang = e.target.value; saveSettings(); };
    $('#sTest', root).onclick = async () => {
      const st = $('#sStatus', root);
      st.className = 'status small';
      st.textContent = 'Provo…';
      try {
        const r = await testConnection(settings, 'openrouter');
        st.classList.add('ok');
        st.textContent = `Funziona! ${r.model} ha risposto in ${r.ms} ms`;
      } catch (err) {
        st.classList.add('err');
        st.textContent = `Errore: ${err.message}`;
      }
    };
    $('#sLists', root).onclick = manageLists;
    bindReminderSettings(root);
    bindChromeAI(root);
    $('#sChime', root).onclick = () => chime(settings.alertLevel !== 'normal' ? 3 : 1);
    $('#sExport', root).onclick = exportData;
    $('#sImport', root).onclick = () => $('#importFile').click();
    $('#sReset', root).onclick = () => {
      if (!confirm('Cancellare tutte le liste e le voci? Non si può annullare.')) return;
      resetAll();
      settings.view = 'all';
      saveSettings();
      closeSheet();
      render();
    };
    $('#sInstall', root)?.addEventListener('click', async () => {
      ui.installEvt.prompt();
      await ui.installEvt.userChoice;
      ui.installEvt = null;
      closeSheet();
    });
  });
}

// Modelli consigliati: per ogni famiglia prendo la versione più recente del listino OpenRouter,
// così l'elenco resta aggiornato da solo quando escono modelli nuovi
const RECOMMENDED = [
  { re: /^anthropic\/claude-haiku-[\d.]+$/, note: 'Il più affidabile con l\'italiano' },
  { re: /^openai\/gpt-[\d.]+-luna$/, note: 'Equilibrato, di OpenAI' },
  { re: /^google\/gemini-[\d.]+-flash-lite$/, note: 'Veloce, di Google' },
  { re: /^deepseek\/deepseek-v[\d.]+-flash$/, note: 'Il più economico' },
];
// Stima del costo: ~20 dettature al giorno, ~3500 token in entrata e ~200 in uscita ciascuna
const monthly = (m) => (600 * (3500 * m.prompt + 200 * m.completion)) / 1e6;
const euro = (v) => (v < 0.01 ? 'meno di 1 cent' : v < 1 ? `~${Math.round(v * 100)} cent` : `~${v.toFixed(2).replace('.', ',')} $`) + '/mese';

async function openModelPicker() {
  openSheet(`
    <div class="sheet-head"><button class="icon-btn" id="mBack" aria-label="Indietro">${icon('back')}</button><h2>Scegli il modello</h2><span></span></div>
    <div id="mList" class="models"><p class="muted center">Carico i modelli…</p></div>
  `, async (root) => {
    $('#mBack', root).onclick = openSettings;
    let models = [];
    try {
      models = await listModels();
    } catch (e) {
      $('#mList', root).innerHTML = `<p class="muted center">Non riesco a caricare l'elenco (sei offline?).<br>Puoi scrivere l'ID a mano:</p>
        <input class="field" id="mManual" placeholder="es. anthropic/claude-haiku-5.5" value="${esc(settings.model)}">`;
      $('#mManual', root).onchange = (ev) => { settings.model = ev.target.value.trim() || 'openrouter/auto'; saveSettings(); };
      return;
    }
    const picks = RECOMMENDED.map((r) => {
      const m = models.filter((x) => r.re.test(x.id)).sort((a, b) => b.created - a.created)[0];
      return m && { ...m, note: r.note };
    }).filter(Boolean);
    const row = (m, cost) => `<button class="model ${m.id === settings.model ? 'on' : ''}" data-id="${esc(m.id)}">
      <span><b>${esc(m.name.replace(/^[^:]+:\s*/, ''))}</b><small>${esc(m.note)}</small></span><em>${cost}</em></button>`;
    let html = row({ id: 'openrouter/auto', name: 'Auto', note: 'Sceglie OpenRouter caso per caso' }, 'variabile') + picks.map((m) => row(m, euro(monthly(m)))).join('');
    // il modello scelto in passato resta visibile anche se non è tra i consigliati
    const cur = settings.model !== 'openrouter/auto' && !picks.some((m) => m.id === settings.model) && models.find((m) => m.id === settings.model);
    if (cur) html = `<h4>In uso adesso</h4>${row({ ...cur, note: 'Non è tra i consigliati' }, euro(monthly(cur)))}<h4>Consigliati</h4>` + html;
    html += `<p class="muted small center">Costo stimato con circa 20 dettature al giorno.</p>`;
    $('#mList', root).innerHTML = html;
    $('#mList', root).addEventListener('click', (e) => {
      const b = e.target.closest('[data-id]');
      if (!b) return;
      settings.model = b.dataset.id;
      saveSettings();
      buzz(8);
      openSettings();
      toast(`Modello: ${settings.model}`);
    });
  });
}

function exportData() {
  const blob = new Blob([JSON.stringify({ app: 'MyList', version: 1, exportedAt: new Date().toISOString(), ...data }, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `mylist-backup-${dayKey(new Date())}.json`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

$('#importFile').addEventListener('change', async (e) => {
  const f = e.target.files[0];
  e.target.value = '';
  if (!f) return;
  try {
    const restore = snapshot();
    replaceData(JSON.parse(await f.text()));
    settings.view = 'all';
    saveSettings();
    closeSheet();
    render();
    toast('Backup importato', 'Annulla', () => { restore(); render(); });
  } catch (err) {
    toast(`Import fallito: ${err.message}`);
  }
});

// ---------- Tema ----------
const mq = matchMedia('(prefers-color-scheme: dark)');
// Temi: [valore, nome, sfondo, scheda] — i tre Medi stanno a distanza uguale tra Chiaro e Scuro
const THEMES = [
  ['auto', 'Auto'], ['light', 'Chiaro', '#E3E3DF', '#F7F7F5'], ['medium', 'Medio 1', '#2A2A28', '#373735'],
  ['medium2', 'Medio 2', '#222221', '#2F2F2D'], ['medium3', 'Medio 3', '#1A1A19', '#262626'], ['dark', 'Scuro', '#121212', '#1E1E1E'],
];
const THEME_BAR = { medium: '#373735', medium2: '#2F2F2D', medium3: '#262626' };
function applyTheme() {
  const t = settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && mq.matches);
  $('#metaTheme').content = THEME_BAR[t] || (dark ? '#1E1E1E' : '#F7F7F5'); // come la fascia dell'intestazione
}
mq.addEventListener('change', applyTheme);

// ---------- Dettatura ----------
function startVoice() {
  if (!voiceSupported) {
    toast('Dettatura non disponibile qui: usa il microfono della tastiera');
    $('#newText').focus();
    return;
  }
  const v = $('#voice');
  const t = targetList();
  v.hidden = false;
  v.classList.remove('thinking', 'error');
  requestAnimationFrame(() => v.classList.add('show'));
  $('#voiceHint').textContent = 'Ti ascolto…';
  $('#voiceText').textContent = '';
  $('#voiceOrbIco').innerHTML = icon('mic');
  $('#voiceTarget').innerHTML = inNotes() ? `${icon('notes')} Detta il tuo appunto` : aiReady(settings) && settings.aiMode !== 'off'
    ? `${icon('sparkles')} L'AI smisterà nelle liste giuste`
    : `Finisce in <b>${listIcon(t)} ${esc(t.name)}</b>`;
  buzz(20);

  try {
    ui.voice = listen({
      lang: settings.lang,
      // per gli appunti si parla più a lungo e si fanno più pause: aspetta di più prima di chiudere
      pauseMs: Math.max(PAUSE_MS[settings.pause] || PAUSE_MS.normal, inNotes() ? PAUSE_MS.long : 0),
      onText: (txt) => { $('#voiceText').textContent = txt; },
      // Conto alla rovescia visibile: quando la barra si svuota la nota parte da sola
      onPause: (ms) => {
        const bar = $('#voiceBar');
        bar.classList.remove('run');
        if (!ms) { $('#voiceHint').textContent = 'Ti ascolto…'; return; }
        $('#voiceHint').textContent = 'Invio automatico…';
        bar.style.setProperty('--ms', ms + 'ms');
        void bar.offsetWidth;
        bar.classList.add('run');
      },
      onDone: async (txt, err) => {
        ui.voice = null;
        if (!txt) {
          v.classList.add('error');
          $('#voiceHint').textContent = err === 'not-allowed'
            ? 'Permesso microfono negato'
            : err === 'network' ? 'Serve la connessione per dettare' : 'Non ho sentito nulla';
          $('#voiceText').textContent = err === 'not-allowed' ? 'Abilitalo dalle impostazioni del sito' : 'Tocca il cerchio per riprovare';
          $('#voiceOrbIco').innerHTML = icon('mic');
          return;
        }
        $('#voiceText').textContent = txt;
        if (aiReady(settings)) {
          v.classList.add('thinking');
          $('#voiceHint').textContent = 'Organizzo…';
          $('#voiceOrbIco').innerHTML = icon('sparkles');
        }
        await smartAdd(txt, { viaVoice: true });
        closeVoice();
      },
    });
  } catch (err) {
    v.classList.add('error');
    $('#voiceHint').textContent = 'Tocca per parlare';
  }
}

function closeVoice() {
  const v = $('#voice');
  ui.voice?.abort();
  ui.voice = null;
  v.classList.remove('show');
  setTimeout(() => { v.hidden = true; }, 220);
}

$('#voiceOrb').addEventListener('click', () => {
  const v = $('#voice');
  if (v.classList.contains('thinking')) return;
  if (ui.voice) ui.voice.stop();
  else startVoice();
});
$('#voiceDone').addEventListener('click', () => { if (ui.voice) ui.voice.stop(); else if (!$('#voice').classList.contains('thinking')) closeVoice(); });
$('#voiceCancel').addEventListener('click', closeVoice);

// ---------- Selettore lista di destinazione ----------
function toggleTargetPicker(force) {
  const p = $('#targetPicker');
  const show = force ?? p.hidden;
  if (!show) { p.classList.remove('show'); setTimeout(() => (p.hidden = true), 180); return; }
  const cur = targetList().id;
  p.innerHTML = `<p class="picker-title">Aggiungi in…</p>` + data.lists.map((l) => `<button class="${l.id === cur ? 'on' : ''}" data-id="${l.id}" style="${cv(l.color)}"><span>${listIcon(l)}</span>${esc(l.name)}${l.id === cur ? icon('check') : ''}</button>`).join('');
  p.hidden = false;
  requestAnimationFrame(() => p.classList.add('show'));
}
$('#targetPicker').addEventListener('click', (e) => {
  const b = e.target.closest('[data-id]');
  if (!b) return;
  if (settings.view !== 'all') settings.view = b.dataset.id;
  settings.target = b.dataset.id;
  saveSettings();
  toggleTargetPicker(false);
  render();
  $('#newText').focus();
});

// ---------- Eventi ----------
function bind() {
  $('#searchIco').innerHTML = icon('search');
  $('#btnSettings').innerHTML = icon('gear');
  $('#btnEditList').innerHTML = icon('pencil');
  $('#btnLists').innerHTML = icon('tag');
  $('#btnLists').onclick = manageLists;

  $('#btnSettings').onclick = openSettings;
  $('#btnEditList').onclick = () => editList(settings.view);
  $('#btnGroup').onclick = () => { settings.grouped = !settings.grouped; saveSettings(); render(); };
  // la ricerca si apre a voce o scrivendo "cerca…"; qui si può affinare o chiudere
  $('#searchClose').innerHTML = icon('x');
  $('#searchClose').onclick = closeSearch;
  $('#searchInput').addEventListener('input', (e) => {
    ui.search = e.target.value;
    ui.terms = null;
    ui.answer = null;
    ui.searchToken = null;
    if (!ui.search.trim()) return closeSearch();
    render();
  });

  // Chip delle liste: tocco = apri, tocco sulla lista già aperta o pressione lunga = modifica
  let pressTimer;
  let longPressed = false;
  const chips = $('#chips');
  chips.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('[data-view]');
    longPressed = false;
    if (!c || c.dataset.view === 'all' || c.dataset.view === 'notes') return;
    pressTimer = setTimeout(() => { longPressed = true; buzz(20); editList(c.dataset.view); }, 550);
  });
  ['pointerup', 'pointerleave', 'pointercancel'].forEach((ev) => chips.addEventListener(ev, () => clearTimeout(pressTimer)));
  chips.addEventListener('scroll', () => clearTimeout(pressTimer), { passive: true });
  chips.addEventListener('contextmenu', (e) => e.preventDefault());
  chips.addEventListener('click', (e) => {
    if (longPressed) return;
    if (e.target.closest('#chipAdd')) return editList(null);
    const c = e.target.closest('[data-view]');
    if (!c) return;
    if (settings.view === c.dataset.view && c.dataset.view !== 'all' && c.dataset.view !== 'notes') return editList(c.dataset.view);
    switchView(c.dataset.view);
  });

  $('#main').addEventListener('click', (e) => {
    if (ui.suppressClick) return;
    const li = e.target.closest('.item');
    if (e.target.closest('.check') && li) return toggleDone(li.dataset.id);
    if (e.target.closest('[data-edit]') && li) return editItem(li.dataset.id);
    if (e.target.closest('[data-note]') && li) return editNote(li.dataset.id);
    const nf = e.target.closest('#noteFilter [data-f]');
    if (nf) { ui.noteFilter = nf.dataset.f; buzz(5); return renderNotes(); }
    const ans = e.target.closest('.answer[data-ref]');
    if (ans) {
      const [type, id] = ans.dataset.ref.split(':');
      return type === 'note' ? editNote(id) : editItem(id);
    }
    const gh = e.target.closest('.group-h');
    if (gh) return switchView(gh.dataset.view);
    if (e.target.closest('#doneToggle')) { settings.showDone = !settings.showDone; saveSettings(); return render(); }
    if (e.target.closest('#clearDone')) {
      const restore = snapshot();
      const vis = settings.view === 'all' ? () => true : (i) => listOf(i).id === settings.view;
      const n = data.items.filter((i) => i.done && vis(i)).length;
      data.items = data.items.filter((i) => !(i.done && vis(i)));
      saveData();
      render();
      toast(`${n} completate eliminate`, 'Annulla', () => { restore(); render(); });
    }
  });

  document.addEventListener('click', (e) => {
    if (e.target.closest('[data-close]')) closeSheet();
    if (!$('#targetPicker').hidden && !e.target.closest('#targetPicker, #btnTarget')) toggleTargetPicker(false);
  });

  const input = $('#newText');
  input.addEventListener('input', updateGoButton);
  $('#btnTarget').onclick = () => toggleTargetPicker();
  $('#composer').addEventListener('submit', (e) => {
    e.preventDefault();
    const txt = input.value.trim();
    if (!txt) return startVoice();
    input.value = '';
    updateGoButton();
    smartAdd(txt);
    input.focus(); // resta pronto per la voce successiva
  });

  setupSwipe();

  window.addEventListener('beforeinstallprompt', (e) => { e.preventDefault(); ui.installEvt = e; });
  // Aggiorna "oggi/domani" quando si torna sull'app il giorno dopo
  document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
}

function switchView(view) {
  if (ui.search) clearSearch();
  if (settings.view === view) return render();
  settings.view = view;
  if (view !== 'all' && view !== 'notes') settings.target = view;
  saveSettings();
  buzz(5);
  const main = $('#main');
  main.classList.remove('fade');
  void main.offsetWidth;
  main.classList.add('fade');
  render();
  window.scrollTo({ top: 0 });
}

// ---------- Avvio ----------
function handleLaunchParams() {
  const p = new URLSearchParams(location.search);
  const shared = [p.get('title'), p.get('text'), p.get('url')].filter(Boolean).join(' ').trim();
  if (p.get('done')) setTimeout(() => remoteDone(...p.get('done').split('|')), 300);
  if (p.has('voice')) setTimeout(startVoice, 400);
  else if (p.has('new')) setTimeout(() => $('#newText').focus(), 300);
  else if (shared) {
    $('#newText').value = shared;
    updateGoButton();
    setTimeout(() => $('#newText').focus(), 300);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
}

if (!listById(settings.view) && settings.view !== 'all' && settings.view !== 'notes') settings.view = 'all';
$('#brandVer').textContent = VERSION ? `v${VERSION}` : '';
applyTheme();
bind();
render();
handleLaunchParams();
// Le etichette "Oggi 16:00" diventano "in ritardo" col passare del tempo: aggiorna ogni minuto (mai durante uno swipe)
setInterval(() => {
  if (!document.hidden && !document.querySelector('.item.swiping, .item.collapse') && !$('#newText').matches(':focus')) renderMain();
}, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
// Avviso arrivato con l'app aperta: vibra e mostralo, con "Fatto" a portata di dito
// IA di Chrome: se il browser ce l'ha, fa da riserva quando manca la chiave OpenRouter
detectChromeAI().then((st) => { if (st !== 'none') render(); });
// Appunti senza titolo (salvati senza AI o prima di questa versione): l'AI glielo scrive con calma
setTimeout(() => data.notes.filter((n) => !n.titleFor && !n.userTitle).slice(0, 20).forEach(autoTitle), 2500);
primeSound();
initReminders({
  fire: (it, late) => {
    const loud = settings.alertLevel !== 'normal';
    navigator.vibrate?.(loud ? [400, 150, 400, 150, 800] : [200, 100, 200]);
    if (!late && !document.hidden) chime(loud ? 3 : 1);
    render();
    toast(`${late ? 'Era alle' : 'Promemoria ·'} ${late ? fmtTime(remindAt(it)) + ': ' : ''}${it.text}`, 'Fatto', () => toggleDoneImmediate(it.id));
  },
  remoteDone,
});
// Tasto "Fatto" sulla notifica di MyList (arriva dal service worker)
navigator.serviceWorker?.addEventListener('message', (e) => {
  if (e.data?.done) remoteDone(...e.data.done.split('|'));
});

// Aggiornamenti: appena il nuovo service worker prende il controllo ricarica la pagina
// (se stai scrivendo o dettando, mostra invece un avviso con "Aggiorna")
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  const hadController = !!navigator.serviceWorker.controller;
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || reloading) return;
    const busy = !$('#voice').hidden || $('#newText').value.trim() || sheet.open;
    if (busy) return toast('Nuova versione di MyList pronta', 'Aggiorna', () => location.reload());
    reloading = true;
    location.reload();
  });
  navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then((reg) => {
    document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
  }).catch(() => {});
}
navigator.storage?.persist?.();
