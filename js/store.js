// Persistenza locale: tutto resta sul telefono (localStorage)
const DATA_KEY = 'mylist.data.v1';
const SET_KEY = 'mylist.settings.v1';

export const LIST_COLORS = ['#7C5CFF', '#FF5FA2', '#FF8A3D', '#F2B705', '#1FBF75', '#14B8A6', '#3B82F6', '#8B93A7'];
export const LIST_EMOJIS = ['📥', '🛒', '💼', '🏠', '💡', '📞', '🎁', '💊', '🚗', '✈️', '🎓', '💪', '🐶', '👶', '💰', '📋', '📚', '🎬', '🍝', '🌱', '🔧', '❤️', '🎉', '⭐'];

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function defaultData() {
  const now = Date.now();
  return {
    lists: [
      { id: 'inbox', name: 'Inbox', emoji: '📥', color: '#7C5CFF', fixed: true },
      { id: uid(), name: 'Spesa', emoji: '🛒', color: '#1FBF75' },
      { id: uid(), name: 'Lavoro', emoji: '💼', color: '#3B82F6' },
      { id: uid(), name: 'Casa', emoji: '🏠', color: '#FF8A3D' },
    ],
    items: [
      { id: uid(), text: 'Tocca il microfono e detta la tua prima voce 🎙️', listId: 'inbox', done: false, starred: true, due: null, createdAt: now },
      { id: uid(), text: 'Scorri a destra per completare, a sinistra per eliminare', listId: 'inbox', done: false, starred: false, due: null, createdAt: now - 1 },
      { id: uid(), text: 'Scrivi "latte #spesa" per mandarla dritta in una lista', listId: 'inbox', done: false, starred: false, due: null, createdAt: now - 2 },
    ],
  };
}

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'openrouter/auto',
  aiMode: 'voice', // voice | always | off
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

// Garantisce che Inbox esista sempre
if (!data.lists.some((l) => l.id === 'inbox')) {
  data.lists.unshift({ id: 'inbox', name: 'Inbox', emoji: '📥', color: '#7C5CFF', fixed: true });
}

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
  if (!data.lists.some((l) => l.id === 'inbox')) {
    data.lists.unshift({ id: 'inbox', name: 'Inbox', emoji: '📥', color: '#7C5CFF', fixed: true });
  }
  saveData();
}

export function resetAll() {
  const d = defaultData();
  data.lists = d.lists;
  data.items = d.items;
  saveData();
}

// Normalizza per confronti (minuscolo, senza accenti)
export const norm = (s) => (s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

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
