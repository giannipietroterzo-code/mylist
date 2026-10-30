// Persistenza locale: tutto resta sul telefono (localStorage)
const DATA_KEY = 'mylist.data.v1';
const SET_KEY = 'mylist.settings.v1';

// Palette giallo/grigio: gialli caldi + grigi, distinguibili tra loro
export const LIST_COLORS = ['#F5B800', '#FFD84D', '#E89B00', '#C9A227', '#3F3F46', '#71717A', '#A1A1AA', '#57534E'];
const OLD_COLORS = ['#7C5CFF', '#FF5FA2', '#FF8A3D', '#F2B705', '#1FBF75', '#14B8A6', '#3B82F6', '#8B93A7'];
export const LIST_EMOJIS = ['📥', '🛒', '💼', '🏠', '💡', '📞', '🎁', '💊', '🚗', '✈️', '🎓', '💪', '🐶', '👶', '💰', '📋', '📚', '🎬', '🍝', '🌱', '🔧', '❤️', '🎉', '⭐'];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function defaultData() {
  const now = Date.now();
  return {
    lists: [
      { id: 'inbox', name: 'Inbox', emoji: '📥', color: '#F5B800' },
      { id: uid(), name: 'Spesa', emoji: '🛒', color: '#E89B00' },
      { id: uid(), name: 'Lavoro', emoji: '💼', color: '#3F3F46' },
      { id: uid(), name: 'Casa', emoji: '🏠', color: '#A1A1AA' },
    ],
    items: [
      { id: uid(), text: 'Tocca il microfono e detta la tua prima voce 🎙️', listId: 'inbox', done: false, due: null, createdAt: now },
      { id: uid(), text: 'Scorri a destra per completare, a sinistra per eliminare', listId: 'inbox', done: false, due: null, createdAt: now - 1 },
      { id: uid(), text: 'Scrivi "latte #spesa" per mandarla dritta in una lista', listId: 'inbox', done: false, due: null, createdAt: now - 2 },
    ],
  };
}

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'openrouter/auto',
  aiMode: 'always', // always | voice | off
  theme: 'auto', // auto | light | dark
  lang: 'it-IT',
  grouped: true,
  showDone: false,
  view: 'all',
  target: 'inbox',
};

function read(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback();
  } catch (e) {
    return fallback();
  }
}

export const data = read(DATA_KEY, defaultData);
export const settings = { ...DEFAULT_SETTINGS, ...read(SET_KEY, () => ({})) };
// v2: l'AI smista anche il testo scritto, non solo la dettatura
if ((settings.sv || 1) < 2) {
  if (settings.aiMode === 'voice') settings.aiMode = 'always';
  settings.sv = 2;
}

// Serve sempre almeno una lista; i colori della vecchia palette passano a giallo/grigio
function normalize() {
  if (!data.lists.length) data.lists.push({ id: uid(), name: 'Inbox', emoji: '📥', color: LIST_COLORS[0] });
  data.lists.forEach((l) => {
    const i = OLD_COLORS.indexOf(l.color);
    if (i >= 0) l.color = LIST_COLORS[i];
    delete l.fixed;
  });
}
normalize();
try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}

export function saveData() {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
}
export function saveSettings() {
  localStorage.setItem(SET_KEY, JSON.stringify(settings));
}

// Fotografia per l'"Annulla"
export function snapshot() {
  const copy = JSON.stringify(data);
  return () => {
    const prev = JSON.parse(copy);
    data.lists = prev.lists;
    data.items = prev.items;
    saveData();
  };
}

export function replaceData(next) {
  if (!next || !Array.isArray(next.lists) || !Array.isArray(next.items)) throw new Error('File non valido');
  data.lists = next.lists;
  data.items = next.items;
  normalize();
  saveData();
}

export function resetAll() {
  const d = defaultData();
  data.lists = d.lists;
  data.items = d.items;
  saveData();
}

// Normalizza per confronti (minuscolo, senza accenti)
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();

export function findListByName(name) {
  const n = norm(name);
  if (!n) return null;
  return (
    data.lists.find((l) => norm(l.name) === n) ||
    data.lists.find((l) => norm(l.name).startsWith(n) && n.length >= 3) ||
    data.lists.find((l) => n.startsWith(norm(l.name)) && norm(l.name).length >= 3) ||
    null
  );
}

export function nextColor() {
  const used = new Set(data.lists.map((l) => l.color));
  return LIST_COLORS.find((c) => !used.has(c)) || LIST_COLORS[data.lists.length % LIST_COLORS.length];
}
