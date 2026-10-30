import { icon, listIcon } from './icons.js';
import {
  data, settings, saveData, saveSettings, snapshot, replaceData, resetAll,
  uid, norm, findListByName, nextColor, LIST_COLORS, LIST_ICONS,
} from './store.js';
import { voiceSupported, listen } from './voice.js';

const PAUSE_MS = { short: 900, normal: 1500, long: 2500 };
const VERSION = window.MYLIST_VERSION || '';
import { aiReady, organize, testConnection, listModels } from './ai.js';

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
const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (n) => { const d = new Date(); d.setDate(d.getDate() + n); return dayKey(d); };
function dueLabel(due) {
  if (!due) return null;
  const today = dayKey(new Date());
  if (due < today) return { text: 'In ritardo', cls: 'late' };
  if (due === today) return { text: 'Oggi', cls: 'today' };
  if (due === addDays(1)) return { text: 'Domani', cls: '' };
  const d = new Date(due + 'T12:00:00');
  return { text: d.toLocaleDateString('it-IT', { weekday: 'short', day: 'numeric', month: 'short' }), cls: '' };
}

function sortOpen(items) {
  return items.sort((a, b) =>
    ((a.due || '9999') < (b.due || '9999') ? -1 : (a.due || '9999') > (b.due || '9999') ? 1 : 0) ||
    (b.createdAt - a.createdAt));
}

// ---------- Inserimento rapido (senza AI) ----------
// Sintassi: "#lista" sposta nella lista, "oggi/domani/dopodomani" = scadenza
function parseQuick(raw, fallbackListId) {
  let text = ' ' + raw.trim() + ' ';
  let listId = fallbackListId;
  let due = null;

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
  const when = { oggi: 0, domani: 1, dopodomani: 2 };
  text = text.replace(/\s(?:per\s+)?(oggi|domani|dopodomani)(?=\s)/i, (m, w) => { due = addDays(when[w.toLowerCase()]); return ' '; });

  text = text.replace(/\s+/g, ' ').trim();
  if (text) text = text[0].toUpperCase() + text.slice(1);
  return { text, listId, due };
}

// reveal: dopo una dettatura apre la lista dove è finita la nota e la evidenzia
function addItems(entries, { reveal = false } = {}) {
  const restore = snapshot();
  const now = Date.now();
  const added = [];
  entries.forEach((e, i) => {
    if (!e.text) return;
    const it = { id: uid(), text: e.text, listId: e.listId || fallbackList().id, done: false, due: e.due || null, createdAt: now - i };
    data.items.push(it);
    ui.fresh.add(it.id);
    added.push(it);
  });
  if (!added.length) return;
  saveData();
  if (reveal) {
    const ids = [...new Set(added.map((a) => listOf(a).id))];
    const view = ids.length === 1 ? ids[0] : 'all';
    if (settings.view !== view) {
      settings.view = view;
      if (view !== 'all') settings.target = view;
      saveSettings();
    }
    ui.search = '';
  }
  render();
  buzz(12);
  if (reveal) {
    requestAnimationFrame(() => {
      const els = added.map((a) => document.querySelector(`.item[data-id="${a.id}"]`)).filter(Boolean);
      els[0]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
      els.forEach((el) => el.classList.add('flash'));
      setTimeout(() => els.forEach((el) => el.classList.remove('flash')), 2400);
    });
  }
  const lists = [...new Set(added.map((a) => listOf(a).name))];
  const msg = added.length === 1
    ? `Aggiunta in ${listOf(added[0]).name}`
    : `${added.length} voci → ${lists.join(', ')}`;
  toast(msg, 'Annulla', () => { restore(); render(); });
}

// Usa l'AI per smistare, con fallback automatico al parser locale
async function smartAdd(text, { viaVoice = false } = {}) {
  const useAI = aiReady(settings) && (settings.aiMode === 'always' || (settings.aiMode === 'voice' && viaVoice));
  // Se l'utente ha usato #lista esplicitamente, non serve l'AI
  if (!useAI || /\s?#[\p{L}]/u.test(text)) {
    addItems([parseQuick(text, targetList().id)], { reveal: viaVoice });
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
    const res = await organize(text, lists, settings, { openList: currentList()?.name, fallback: targetList().name });
    if (!res.length) throw new Error('Nessuna voce trovata');
    const entries = res.map((r) => {
      let l = r.list ? findListByName(r.list) : null;
      if (!l && r.list) {
        l = { id: uid(), name: r.list[0].toUpperCase() + r.list.slice(1), icon: 'clipboard-list', color: nextColor() };
        data.lists.push(l);
      }
      return { text: r.text, listId: (l || targetList()).id, due: r.due };
    });
    addItems(entries, { reveal: viaVoice });
  } catch (err) {
    console.warn(err);
    addItems([parseQuick(text, targetList().id)], { reveal: viaVoice });
    toast(`AI non disponibile: aggiunta così com'è (${err.message})`);
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
  const title = searching ? 'Risultati' : l ? `<span class="t-ico" style="${cv(l.color)}">${listIcon(l)}</span><span class="t-txt">${esc(l.name)}</span>` : '<span class="t-txt">Tutte</span>';
  $('#viewTitle').innerHTML = `${title}${VERSION ? `<span class="ver">v${VERSION}</span>` : ''}`;
  const n = openCount(l?.id);
  const today = new Date().toLocaleDateString('it-IT', { weekday: 'long', day: 'numeric', month: 'long' });
  $('#viewSub').textContent = `${n ? (n === 1 ? '1 cosa da fare' : `${n} cose da fare`) : 'Tutto fatto'} · ${today}`;
  $('#btnEditList').hidden = !l;
  $('#btnGroup').hidden = !!l || searching;
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
  chips.innerHTML = all + ls + `<button class="chip add" id="chipAdd" aria-label="Nuova lista">${icon('plus')}</button>`;
  chips.querySelector('.chip.on')?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
}

function itemHTML(it, showList) {
  const l = listOf(it);
  const due = dueLabel(it.due);
  const meta = [
    showList ? `<span class="tag" style="${cv(l.color)}">${listIcon(l)}${esc(l.name)}</span>` : '',
    due && !it.done ? `<span class="tag due ${due.cls}">${icon('calendar')}${due.text}</span>` : '',
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
  if (ui.search.trim()) return `<div class="empty"><div class="empty-emo">${icon('search')}</div><h2>Nessun risultato</h2><p>Prova con un'altra parola</p></div>`;
  return `<div class="empty"><div class="empty-emo">${lines[0]}</div><h2>${lines[1]}</h2><p>${lines[2]}</p></div>`;
}

function renderMain() {
  const q = norm(ui.search);
  let items = data.items;
  if (q) items = items.filter((i) => norm(i.text).includes(q));
  else if (settings.view !== 'all') items = items.filter((i) => listOf(i).id === settings.view);

  const open = sortOpen(items.filter((i) => !i.done));
  const done = items.filter((i) => i.done).sort((a, b) => (b.doneAt || 0) - (a.doneAt || 0));
  const isAll = settings.view === 'all' || q;
  let html = '';

  if (!open.length) html += emptyHTML();
  else if (isAll && settings.grouped && !q) {
    for (const l of data.lists) {
      const its = open.filter((i) => listOf(i).id === l.id);
      if (!its.length) continue;
      html += `<section class="group" style="${cv(l.color)}">
        <button class="group-h" data-view="${l.id}"><span class="g-emo">${listIcon(l)}</span>${esc(l.name)}<span class="g-n">${its.length}</span></button>
        <ul class="items">${its.map((i) => itemHTML(i, false)).join('')}</ul></section>`;
    }
  } else {
    html += `<ul class="items">${open.map((i) => itemHTML(i, isAll)).join('')}</ul>`;
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
      it.done = true;
      it.doneAt = Date.now();
      saveData();
      collapseThen(el, render);
      toast('Fatto!', 'Annulla', () => { restore(); render(); });
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
      sw.dx = dx;
      sw.body.style.transform = `translateX(${dx}px)`;
      sw.li.dataset.dir = dx > 0 ? 'right' : 'left';
      const armed = Math.abs(dx) > TH;
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
    const flick = Math.abs(v) > FLICK && Math.abs(dx) > FLICK_MIN && Math.sign(v) === Math.sign(dx);
    if (Math.abs(dx) > TH || flick) {
      body.style.transition = 'transform .2s ease';
      body.style.transform = `translateX(${dx > 0 ? 110 : -110}%)`;
      const id = li.dataset.id;
      setTimeout(() => (dx > 0 ? toggleDoneImmediate(id) : deleteItem(id)), 180);
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
  it.done = !it.done;
  it.doneAt = it.done ? Date.now() : null;
  saveData();
  buzz(15);
  collapseThen(document.querySelector(`.item[data-id="${id}"]`), render);
  toast(it.done ? 'Fatto!' : 'Di nuovo da fare', 'Annulla', () => { restore(); render(); });
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
    <div class="row top-gap">
      <button class="pill-btn danger ghost grow" id="eDel">${icon('trash')}Elimina</button>
      <button class="pill-btn grow" data-close>Fatto</button>
    </div>
  `, (root) => {
    const commit = () => { saveData(); render(); };
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
      commit();
      editItem(id);
    });
    $('#eDate', root).addEventListener('change', (e) => { it.due = e.target.value || null; commit(); editItem(id); });
    $('#eDel', root).addEventListener('click', () => {
      closeSheet();
      data.items = data.items.filter((i) => i.id !== id);
      saveData();
      render();
      toast('Voce eliminata', 'Annulla', () => { restore(); render(); });
    });
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

// ---------- Impostazioni ----------
function openSettings() {
  const seg = (name, val, opts) => `<div class="seg" data-seg="${name}">${opts.map(([v, t]) => `<button class="${val === v ? 'on' : ''}" data-v="${v}">${t}</button>`).join('')}</div>`;
  const hasKey = !!settings.apiKey;
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
      <button class="model-btn" id="sModel"><span><b id="sModelName">${esc(settings.model)}</b><small>Tocca per scegliere dall'elenco OpenRouter</small></span>${icon('chevron')}</button>

      <label class="lbl">Quando usarlo</label>
      ${seg('aiMode', settings.aiMode, [['always', 'Sempre'], ['voice', 'Solo dettatura'], ['off', 'Mai']])}
      <p class="muted small">L'AI capisce la nota e dove vuoi metterla ("mettilo nel lavoro", "per casa"…). Se non lo dici, sceglie lei la lista più adatta.</p>

      <button class="pill-btn wide ghost top-gap" id="sTest" ${hasKey ? '' : 'disabled'}>${icon('bolt')}Prova connessione</button>
      <p class="status small" id="sStatus"></p>
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
      <h3>${icon('eye')}Aspetto</h3>
      ${seg('theme', settings.theme, [['auto', 'Automatico'], ['light', 'Chiaro'], ['dark', 'Scuro']])}
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
        <li><i>oggi</i>, <i>domani</i>, <i>dopodomani</i> impostano la scadenza</li>
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
      render();
    }));
    $('#sLang', root).onchange = (e) => { settings.lang = e.target.value; saveSettings(); };
    $('#sTest', root).onclick = async () => {
      const st = $('#sStatus', root);
      st.className = 'status small';
      st.textContent = 'Provo…';
      try {
        const r = await testConnection(settings);
        st.classList.add('ok');
        st.textContent = `Funziona! ${r.model} ha risposto in ${r.ms} ms`;
      } catch (err) {
        st.classList.add('err');
        st.textContent = `Errore: ${err.message}`;
      }
    };
    $('#sLists', root).onclick = manageLists;
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

async function openModelPicker() {
  openSheet(`
    <div class="sheet-head"><button class="icon-btn" id="mBack" aria-label="Indietro">${icon('back')}</button><h2>Scegli il modello</h2><span></span></div>
    <div class="search in-sheet"><span class="search-ico">${icon('search')}</span><input id="mSearch" type="search" placeholder="Cerca (es. gemini, gpt, claude, free)…" autocomplete="off"></div>
    <div id="mList" class="models"><p class="muted center">Carico i modelli…</p></div>
  `, async (root) => {
    $('#mBack', root).onclick = openSettings;
    let models = [];
    try {
      models = await listModels();
    } catch (e) {
      $('#mList', root).innerHTML = `<p class="muted center">Non riesco a caricare l'elenco (sei offline?).<br>Puoi scrivere l'ID a mano:</p>
        <input class="field" id="mManual" placeholder="es. google/gemini-2.5-flash" value="${esc(settings.model)}">`;
      $('#mManual', root).onchange = (ev) => { settings.model = ev.target.value.trim() || 'openrouter/auto'; saveSettings(); };
      return;
    }
    const price = (m) => (m.prompt === 0 && m.completion === 0 ? '<span class="free">GRATIS</span>' : `$${m.prompt.toFixed(2)} · $${m.completion.toFixed(2)}`);
    const row = (m) => `<button class="model ${m.id === settings.model ? 'on' : ''}" data-id="${esc(m.id)}">
      <span><b>${esc(m.name)}</b><small>${esc(m.id)}</small></span><em>${price(m)}</em></button>`;
    const draw = () => {
      const q = norm($('#mSearch', root).value);
      let html = '';
      if (!q) {
        const picks = models
          // niente varianti :batch (lente) né alias ~…-latest (cambiano modello da soli)
          .filter((m) => !m.id.includes(':') && !m.id.startsWith('~') && /flash|mini|haiku|small|lite|nano/i.test(m.id) && m.prompt > 0 && m.prompt < 1 && !/image|audio|vision|embed/i.test(m.id))
          .sort((a, b) => b.created - a.created)
          .slice(0, 8);
        html += `<h4>Consigliati: veloci ed economici</h4>` + row({ id: 'openrouter/auto', name: 'Auto (sceglie OpenRouter)', prompt: -1, completion: -1 }).replace(/<em>.*<\/em>/, '<em>variabile</em>') + picks.map(row).join('');
        html += `<h4>Tutti i modelli (prezzo per 1M token in · out)</h4>`;
      }
      const all = models.filter((m) => !m.id.endsWith(':batch') && (!q || norm(m.id + ' ' + m.name).includes(q) || (q === 'free' && m.prompt === 0)));
      html += all.sort((a, b) => a.prompt - b.prompt).slice(0, 150).map(row).join('') || '<p class="muted center">Nessun modello trovato</p>';
      $('#mList', root).innerHTML = html;
    };
    draw();
    $('#mSearch', root).addEventListener('input', draw);
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
function applyTheme() {
  const t = settings.theme;
  if (t === 'auto') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = t;
  const dark = t === 'dark' || (t === 'auto' && mq.matches);
  $('#metaTheme').content = dark ? '#1E1E1E' : '#F7F7F5'; // come la fascia dell'intestazione
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
  $('#voiceTarget').innerHTML = aiReady(settings) && settings.aiMode !== 'off'
    ? `${icon('sparkles')} L'AI smisterà nelle liste giuste`
    : `Finisce in <b>${listIcon(t)} ${esc(t.name)}</b>`;
  buzz(20);

  try {
    ui.voice = listen({
      lang: settings.lang,
      pauseMs: PAUSE_MS[settings.pause] || PAUSE_MS.normal,
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
  $('#btnSearch').innerHTML = icon('search');
  $('#searchIco').innerHTML = icon('search');
  $('#btnSettings').innerHTML = icon('gear');
  $('#btnEditList').innerHTML = icon('pencil');
  $('#btnLists').innerHTML = icon('tag');
  $('#btnLists').onclick = manageLists;

  $('#btnSettings').onclick = openSettings;
  $('#btnEditList').onclick = () => editList(settings.view);
  $('#btnGroup').onclick = () => { settings.grouped = !settings.grouped; saveSettings(); render(); };
  $('#btnSearch').onclick = () => {
    const box = $('#searchBox');
    box.hidden = !box.hidden;
    if (!box.hidden) $('#searchInput').focus();
    else { ui.search = ''; $('#searchInput').value = ''; render(); }
  };
  $('#searchInput').addEventListener('input', (e) => { ui.search = e.target.value; render(); });

  // Chip delle liste: tocco = apri, tocco sulla lista già aperta o pressione lunga = modifica
  let pressTimer;
  let longPressed = false;
  const chips = $('#chips');
  chips.addEventListener('pointerdown', (e) => {
    const c = e.target.closest('[data-view]');
    longPressed = false;
    if (!c || c.dataset.view === 'all') return;
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
    if (settings.view === c.dataset.view && c.dataset.view !== 'all') return editList(c.dataset.view);
    switchView(c.dataset.view);
  });

  $('#main').addEventListener('click', (e) => {
    if (ui.suppressClick) return;
    const li = e.target.closest('.item');
    if (e.target.closest('.check') && li) return toggleDone(li.dataset.id);
    if (e.target.closest('[data-edit]') && li) return editItem(li.dataset.id);
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
  if (settings.view === view) return;
  settings.view = view;
  if (view !== 'all') settings.target = view;
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
  if (p.has('voice')) setTimeout(startVoice, 300);
  else if (p.has('new')) setTimeout(() => $('#newText').focus(), 300);
  else if (shared) {
    $('#newText').value = shared;
    updateGoButton();
    setTimeout(() => $('#newText').focus(), 300);
  }
  if (location.search) history.replaceState(null, '', location.pathname);
}

if (!listById(settings.view) && settings.view !== 'all') settings.view = 'all';
applyTheme();
bind();
render();
handleLaunchParams();

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
