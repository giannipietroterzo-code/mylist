// Persistenza locale: tutto resta sul telefono (localStorage)
const DATA_KEY = 'mylist.data.v1';
const SET_KEY = 'mylist.settings.v1';

// Palette giallo/grigio: gialli caldi + grigi, distinguibili tra loro
export const LIST_COLORS = ['#F5B800', '#FFD84D', '#E89B00', '#C9A227', '#3F3F46', '#71717A', '#A1A1AA', '#57534E'];
const OLD_COLORS = ['#7C5CFF', '#FF5FA2', '#FF8A3D', '#F2B705', '#1FBF75', '#14B8A6', '#3B82F6', '#8B93A7'];
// Icone disponibili per le liste (nomi Flaticon UIcons)
export const LIST_ICONS = [
  'inbox-in', 'shopping-cart', 'briefcase', 'home', 'bulb', 'phone-call', 'gift', 'medicine',
  'car-side', 'plane', 'graduation-cap', 'gym', 'paw', 'baby', 'piggy-bank', 'clipboard-list',
  'book', 'film', 'utensils', 'leaf', 'tools', 'heart', 'glass-cheers', 'star',
  'users', 'music', 'palette', 'broom', 'coffee', 'globe', 'flame', 'party-horn',
];
// Migrazione dalle vecchie emoji
const EMOJI_TO_ICON = {
  '📥': 'inbox-in', '🛒': 'shopping-cart', '💼': 'briefcase', '🏠': 'home', '💡': 'bulb', '📞': 'phone-call',
  '🎁': 'gift', '💊': 'medicine', '🚗': 'car-side', '✈️': 'plane', '🎓': 'graduation-cap', '💪': 'gym',
  '🐶': 'paw', '👶': 'baby', '💰': 'piggy-bank', '📋': 'clipboard-list', '🧾': 'clipboard-list', '📚': 'book',
  '🎬': 'film', '🍝': 'utensils', '🌱': 'leaf', '🔧': 'tools', '❤️': 'heart', '🎉': 'glass-cheers', '⭐': 'star',
};

export const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);

function defaultData() {
  const now = Date.now();
  return {
    lists: [
      { id: 'inbox', name: 'Inbox', icon: 'inbox-in', color: '#F5B800' },
      { id: uid(), name: 'Spesa', icon: 'shopping-cart', color: '#E89B00' },
      { id: uid(), name: 'Lavoro', icon: 'briefcase', color: '#3F3F46' },
      { id: uid(), name: 'Casa', icon: 'home', color: '#A1A1AA' },
    ],
    items: [
      { id: uid(), text: 'Tocca il microfono e detta la tua prima voce', listId: 'inbox', done: false, due: null, createdAt: now },
      { id: uid(), text: 'Scorri a destra per completare, a sinistra per eliminare', listId: 'inbox', done: false, due: null, createdAt: now - 1 },
      { id: uid(), text: 'Scrivi "latte #spesa" per mandarla dritta in una lista', listId: 'inbox', done: false, due: null, createdAt: now - 2 },
    ],
    // appunti: { id, title, text, createdAt, updatedAt }
    notes: [],
  };
}

export const DEFAULT_SETTINGS = {
  apiKey: '',
  model: 'openrouter/auto',
  aiMode: 'always', // always | voice | off
  theme: 'auto', // auto | light | medium | medium2 | medium3 | dark
  lang: 'it-IT',
  pause: 'normal', // short | normal | long: silenzio prima dell'invio automatico
  grouped: true,
  showDone: false,
  view: 'all',
  target: 'inbox',
  ntfyTopic: '', // canale ntfy per gli avvisi ad app chiusa ('' = spento)
  alertLevel: 'loud', // loud | normal: quanto si fanno sentire i promemoria
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
delete settings.autoListen; // opzione tolta: si usa la scorciatoia Detta sulla Home
// v2: l'AI smista anche il testo scritto, non solo la dettatura
if (/:batch$/.test(settings.model)) settings.model = settings.model.replace(/:batch$/, '');
if ((settings.sv || 1) < 2) {
  if (settings.aiMode === 'voice') settings.aiMode = 'always';
  settings.sv = 2;
}
try { localStorage.setItem(SET_KEY, JSON.stringify(settings)); } catch (e) {}

// Serve sempre almeno una lista; i colori della vecchia palette passano a giallo/grigio
function normalize() {
  if (!Array.isArray(data.notes)) data.notes = [];
  if (!data.lists.length) data.lists.push({ id: uid(), name: 'Inbox', icon: 'inbox-in', color: LIST_COLORS[0] });
  data.lists.forEach((l) => {
    if (!l.icon) l.icon = EMOJI_TO_ICON[l.emoji] || 'clipboard-list';
    delete l.emoji;
    const i = OLD_COLORS.indexOf(l.color);
    if (i >= 0) l.color = LIST_COLORS[i];
    delete l.fixed;
  });
}
normalize();
try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}

export function saveData() {
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  window.dispatchEvent(new Event('mylist:saved')); // i promemoria si riprogrammano da soli
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
    data.notes = prev.notes || [];
    saveData();
  };
}

export function replaceData(next) {
  if (!next || !Array.isArray(next.lists) || !Array.isArray(next.items)) throw new Error('File non valido');
  data.lists = next.lists;
  data.items = next.items;
  data.notes = Array.isArray(next.notes) ? next.notes : [];
  normalize();
  saveData();
}

export function resetAll() {
  const d = defaultData();
  data.lists = d.lists;
  data.items = d.items;
  data.notes = d.notes;
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
