// Persistenza locale: tutto resta sul telefono (localStorage)
const DATA_KEY = 'mylist.data.v1';
const SET_KEY = 'mylist.settings.v1';

// Palette giallo/grigio: gialli caldi + grigi, distinguibili tra loro
const YELLOW_GREY = ['#F5B800', '#FFD84D', '#E89B00', '#C9A227', '#3F3F46', '#71717A', '#A1A1AA', '#57534E'];
// Natura: toni morbidi che stanno bene col giallo (salvia, eucalipto, azzurro polvere, terracotta,
// rosa argilla, oliva, lavanda, sabbia)
const NATURA = ['#8FA98A', '#6E9C94', '#7D9BB5', '#C98B6B', '#C9918F', '#A3A06A', '#9A93B5', '#D6BE8E'];
export const LIST_COLORS = [...YELLOW_GREY, ...NATURA];
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
    // appunti eliminati, recuperabili per TRASH_DAYS: { ...appunto, deletedAt }
    trash: [],
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
  chromeAI: false, // IA di Chrome attivata: risponde prima di OpenRouter
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

export const TRASH_DAYS = 60;
// Gli appunti eliminati da più di 60 giorni spariscono per sempre
function pruneTrash() {
  const limit = Date.now() - TRASH_DAYS * 864e5;
  data.trash = data.trash.filter((n) => n.deletedAt > limit);
}

// Serve sempre almeno una lista; i colori della vecchia palette passano a giallo/grigio
function normalize() {
  if (!Array.isArray(data.notes)) data.notes = [];
  if (!Array.isArray(data.trash)) data.trash = [];
  pruneTrash();
  if (!data.lists.length) data.lists.push({ id: uid(), name: 'Inbox', icon: 'inbox-in', color: LIST_COLORS[0] });
  data.lists.forEach((l) => {
    if (!l.icon) l.icon = EMOJI_TO_ICON[l.emoji] || 'clipboard-list';
    delete l.emoji;
    const i = OLD_COLORS.indexOf(l.color);
    if (i >= 0) l.color = YELLOW_GREY[i];
    delete l.fixed;
  });
}
normalize();
try { localStorage.setItem(DATA_KEY, JSON.stringify(data)); } catch (e) {}

export function saveData() {
  pruneTrash();
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
    data.trash = prev.trash || [];
    saveData();
  };
}

export function replaceData(next) {
  if (!next || !Array.isArray(next.lists) || !Array.isArray(next.items)) throw new Error('File non valido');
  data.lists = next.lists;
  data.items = next.items;
  data.notes = Array.isArray(next.notes) ? next.notes : [];
  data.trash = Array.isArray(next.trash) ? next.trash : [];
  normalize();
  saveData();
}

export function resetAll() {
  const d = defaultData();
  data.lists = d.lists;
  data.items = d.items;
  data.notes = d.notes;
  data.trash = d.trash;
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

// Elimina un appunto tenendolo nel cestino; restoreNote lo rimette tra gli appunti
export function trashNote(id) {
  const n = data.notes.find((x) => x.id === id);
  if (!n) return;
  data.notes = data.notes.filter((x) => x !== n);
  data.trash.unshift({ ...n, deletedAt: Date.now() });
}
export function restoreNote(id) {
  const n = data.trash.find((x) => x.id === id);
  if (!n) return null;
  data.trash = data.trash.filter((x) => x !== n);
  const { deletedAt, ...note } = n;
  data.notes.unshift(note);
  return note;
}

// Icona e colore proposti dal nome della lista ("Palestra" → manubrio, verde salvia).
// Ogni regola: [icona, colore, inizi di parola che la fanno scattare]
const STYLE_RULES = [
  ['shopping-cart', '#C98B6B', ['spesa', 'supermercat', 'alimentar', 'acquist', 'market', 'grocer']],
  ['tools', '#71717A', ['lavori', 'riparazion', 'manutenzion', 'bricolage', 'fai da te', 'attrezz']],
  ['briefcase', '#7D9BB5', ['lavoro', 'ufficio', 'client', 'progett', 'riunion', 'business', 'work']],
  ['broom', '#D6BE8E', ['pulizi', 'faccend']],
  ['home', '#D6BE8E', ['casa', 'appartament', 'condomin', 'trasloc', 'home']],
  ['bulb', '#FFD84D', ['idea', 'idee']],
  ['phone-call', '#6E9C94', ['chiamat', 'telefon', 'chiamare', 'contatt', 'rubrica']],
  ['gift', '#C9918F', ['regal', 'compleann', 'natale', 'anniversari']],
  ['medicine', '#6E9C94', ['salute', 'medic', 'farmac', 'dottor', 'visit', 'dentist', 'terapi', 'pillol']],
  ['car-side', '#57534E', ['auto', 'macchin', 'moto', 'garage', 'tagliand', 'meccanic']],
  ['plane', '#7D9BB5', ['viagg', 'vacanz', 'ferie', 'valigi', 'volo', 'voli', 'trip']],
  ['graduation-cap', '#9A93B5', ['scuol', 'universit', 'esam', 'studi', 'corso', 'corsi', 'compiti', 'tesi']],
  ['gym', '#8FA98A', ['palestr', 'sport', 'allenament', 'fitness', 'corsa', 'calcio', 'nuoto', 'piscin', 'yoga', 'bici']],
  ['paw', '#C98B6B', ['cane', 'cani', 'gatt', 'animal', 'veterinar', 'cucciol']],
  ['baby', '#C9918F', ['bambin', 'bimb', 'figli', 'neonat', 'asilo']],
  ['piggy-bank', '#A3A06A', ['spese', 'soldi', 'banca', 'bollett', 'finanz', 'conti', 'conto', 'pagament', 'tasse', 'risparm', 'budget']],
  ['book', '#9A93B5', ['libr', 'lettur', 'leggere']],
  ['film', '#57534E', ['film', 'serie', 'cinema', 'netflix', 'tv']],
  ['utensils', '#C98B6B', ['ricett', 'cucin', 'cena', 'cene', 'pranz', 'ristorant', 'menu']],
  ['leaf', '#8FA98A', ['giardin', 'piant', 'orto', 'fiori', 'balcon']],
  ['glass-cheers', '#E89B00', ['aperitiv', 'event', 'cerimoni', 'matrimoni']],
  ['party-horn', '#E89B00', ['festa', 'feste', 'party']],
  ['users', '#6E9C94', ['amic', 'famigli', 'persone', 'team', 'gruppo']],
  ['heart', '#C9918F', ['amore', 'coppia', 'romantic']],
  ['music', '#9A93B5', ['music', 'concert', 'canzon', 'chitarr', 'piano']],
  ['palette', '#C9918F', ['arte', 'disegn', 'pittur', 'hobby', 'creativ']],
  ['coffee', '#C9A227', ['colazion', 'caff', 'bar']],
  ['globe', '#7D9BB5', ['lingu', 'inglese', 'mondo']],
  ['flame', '#E89B00', ['urgent', 'priorit', 'subito']],
  ['star', '#FFD84D', ['preferit', 'desider', 'wishlist', 'sogni']],
];
export function suggestStyle(name) {
  const words = norm(name).split(/[^a-z0-9]+/).filter(Boolean);
  const text = words.join(' ');
  for (const [icon, color, keys] of STYLE_RULES) {
    if (keys.some((k) => (k.includes(' ') ? text.includes(k) : words.some((w) => w.startsWith(k))))) return { icon, color };
  }
  return null;
}

// Le liste nuove prendono prima i colori Natura, poi gialli e grigi
export function nextColor() {
  const used = new Set(data.lists.map((l) => l.color));
  const order = [...NATURA, ...YELLOW_GREY];
  return order.find((c) => !used.has(c)) || order[data.lists.length % order.length];
}
