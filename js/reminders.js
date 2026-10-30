// Promemoria: due canali che si completano
//  1. Notifiche del telefono dalla app: arrivano finché MyList è aperta o in background da poco
//     (un'app web non può programmare notifiche ad app chiusa).
//  2. ntfy (facoltativo): MyList programma l'avviso sul server ntfy.sh e l'app ntfy lo consegna
//     all'orario giusto anche col telefono in tasca e MyList chiusa. Massimo 3 giorni in anticipo:
//     quelli più lontani (e le ripetizioni successive) vengono programmati alle aperture successive.
//     Sulla notifica ci sono due tasti che funzionano senza aprire MyList:
//       "Fatto"   → lascia un messaggio nel canale "<canale>-fatto", che MyList legge quando la riapri
//       "+10 min" → il telefono riprogramma da solo l'avviso su ntfy (fino a 3 volte)
import { data, settings, saveData } from './store.js';
import { remindAt, occurrences } from './when.js';

const NTFY = 'https://ntfy.sh';
const PUSH_KEY = 'mylist.push.v1'; // { sequenza: "momento|canale|priorità|testo" } avvisi già programmati su ntfy
const SINCE_KEY = 'mylist.doneSince.v1'; // ultimo "Fatto" letto dal canale ntfy
const HORIZON = 3 * 864e5 - 5 * 60000;
const SNOOZES = 3;
const APP_URL = new URL('./', location.href).href;

let timers = [];
let onFire = () => {};
let onRemoteDone = () => {};
let syncTimer = null;

export const notifySupported = 'Notification' in window && 'serviceWorker' in navigator;
export const notifyPermission = () => (notifySupported ? Notification.permission : 'denied');
export async function askNotify() {
  if (!notifySupported) return 'denied';
  return Notification.requestPermission();
}

// Canale privato e casuale su ntfy.sh (chi non conosce il nome non può leggerlo)
export const newTopic = () => 'mylist-' + Array.from(crypto.getRandomValues(new Uint8Array(12)), (b) => (b % 36).toString(36)).join('');
export const ntfyLink = (topic) => `ntfy://ntfy.sh/${topic}?display=MyList`;
const doneTopic = (topic) => `${topic}-fatto`;

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const readPush = () => read(PUSH_KEY, {});
const writePush = (m) => localStorage.setItem(PUSH_KEY, JSON.stringify(m));

// Ogni volta di una voce ha la sua sequenza ntfy: id (singola) o id-AAAAMMGG (ricorrente)
const seqOf = (it, due = it.due) => (it.repeat ? `${it.id}-${due.replace(/-/g, '')}` : it.id);
// L'avviso di questa volta è già affidato a ntfy?
const pushed = (it, at) => !!settings.ntfyTopic && !!readPush()[seqOf(it)]?.startsWith(`${at}|${settings.ntfyTopic}|`);
// Forte = priorità massima di ntfy: suono, vibrazione lunga, sopra le altre app (e "insistente" se lo attivi in ntfy)
export const priority = () => (settings.alertLevel === 'normal' ? 4 : 5);
const body = (it) => `${it.text}${it.time ? ` · alle ${it.time}` : ''}`;

async function ntfy(path, init) {
  const res = await fetch(`${NTFY}/${path}`, init);
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  return res;
}
const publish = (msg) => ntfy('', { method: 'POST', body: JSON.stringify(msg) });

// Il messaggio con i tasti; "+10 min" contiene già il messaggio rimandato (con i suoi tasti, un rinvio in meno)
function message(topic, it, due, seq, delay, snoozes = SNOOZES, snoozed = false) {
  const m = {
    topic, sequence_id: seq, delay, title: snoozed ? 'MyList · rimandato' : 'MyList',
    message: body(it), tags: [snoozed ? 'alarm_clock' : 'bell'], priority: priority(), click: APP_URL,
    actions: [{ action: 'http', label: 'Fatto', url: `${NTFY}/`, method: 'POST', clear: true, body: JSON.stringify({ topic: doneTopic(topic), message: `${it.id}|${due}` }) }],
  };
  if (snoozes > 0) {
    const later = message(topic, it, due, `${seq.replace(/-s$/, '')}-s`, '10m', snoozes - 1, true);
    m.actions.push({ action: 'http', label: '+10 min', url: `${NTFY}/`, method: 'POST', clear: true, body: JSON.stringify(later) });
  }
  return m;
}

export function sendTest(topic) {
  return publish({ topic, title: 'MyList', tags: ['bell'], priority: priority(), click: APP_URL, message: 'Prova: i promemoria arriveranno così (suono e vibrazione)' });
}

// Mostra l'avviso: notifica di sistema (se non ci pensa già ntfy) + avviso dentro l'app
async function fire(it, at) {
  it.fired = at;
  saveData();
  const late = Date.now() - at > 2 * 60000;
  if (!pushed(it, at) && notifyPermission() === 'granted' && document.hidden) {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    reg?.showNotification(late ? 'MyList · promemoria passato' : 'MyList', {
      body: body(it), tag: it.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      // resta sullo schermo finché non la tocchi
      vibrate: priority() === 5 ? [400, 150, 400, 150, 400, 150, 800] : [200, 100, 200], renotify: true, requireInteraction: true, silent: false, data: { url: APP_URL, done: `${it.id}|${it.due}` },
      actions: [{ action: 'done', title: 'Fatto' }],
    });
  }
  onFire(it, late);
}

function armLocal() {
  timers.forEach(clearTimeout);
  timers = [];
  const now = Date.now();
  let quiet = false;
  for (const it of data.items) {
    const at = remindAt(it);
    if (it.done || at == null || it.fired === at) continue;
    if (at <= now) {
      // a app chiusa: se l'ha già consegnato ntfy basta segnarlo, altrimenti lo mostriamo adesso
      if (pushed(it, at)) { it.fired = at; quiet = true; } else fire(it, at);
    } else if (at - now < 2 ** 31) timers.push(setTimeout(() => fire(it, at), at - now));
  }
  if (quiet) saveData();
}

// Una voce appena creata o modificata con l'avviso già nel passato non deve suonare subito
export function settle(it) {
  const at = remindAt(it);
  if (at != null && at <= Date.now() + 1000) it.fired = at;
}

async function syncNtfy() {
  const topic = settings.ntfyTopic;
  const map = readPush();
  const now = Date.now();
  const want = new Map();
  if (topic) {
    for (const it of data.items) {
      if (it.done) continue;
      // le ricorrenti si programmano tutte le volte dei prossimi 3 giorni: arrivano anche senza riaprire MyList
      for (const { due, at } of occurrences(it, now + HORIZON)) {
        if (at > now + 15000 && it.fired !== at) want.set(seqOf(it, due), { it, due, at, key: `${at}|${topic}|${priority()}|${it.text}` });
      }
    }
  }
  let changed = false;
  for (const [seq, key] of Object.entries(map)) {
    const [at, was] = key.split('|');
    if (want.get(seq)?.key === key) continue;
    // annulla l'avviso programmato (voce fatta, eliminata, spostata o ntfy spento) e un eventuale rinvio "+10 min";
    // un avviso solo scattato (non ancora fatto) tiene il suo rinvio; quelli passati da un pezzo si dimenticano
    const [id, day] = seq.split('-');
    const it = data.items.find((i) => i.id === id);
    const obsolete = was !== topic || !it || it.done || (day ? !it.due || it.due.replace(/-/g, '') > day : remindAt(it) !== +at);
    if (was && +at > now) await ntfy(`${was}/${seq}`, { method: 'DELETE' }).catch(() => {});
    if (was && obsolete && +at > now - 3 * 3600e3) await ntfy(`${was}/${seq}-s`, { method: 'DELETE' }).catch(() => {});
    delete map[seq];
    changed = true;
  }
  for (const [seq, { it, due, at, key }] of want) {
    if (map[seq] === key) continue;
    try {
      // stessa sequenza = sostituisce l'avviso precedente
      await publish(message(topic, it, due, seq, String(Math.floor(at / 1000))));
      map[seq] = key;
      changed = true;
    } catch (err) { console.warn('ntfy', err); } // offline: riprova al prossimo giro
  }
  if (changed) writePush(map);
}

// I "Fatto" toccati sulle notifiche di ntfy (ntfy.sh li conserva 12 ore)
async function pollDone() {
  const topic = settings.ntfyTopic;
  if (!topic || !navigator.onLine) return;
  try {
    const since = localStorage.getItem(SINCE_KEY) || '12h';
    const res = await ntfy(`${doneTopic(topic)}/json?poll=1&since=${encodeURIComponent(since)}`);
    const msgs = (await res.text()).trim().split('\n').filter(Boolean).map((l) => JSON.parse(l)).filter((m) => m.event === 'message');
    if (!msgs.length) return;
    localStorage.setItem(SINCE_KEY, msgs[msgs.length - 1].id);
    for (const m of msgs) {
      const [id, due] = String(m.message || '').split('|');
      if (id) onRemoteDone(id, due || null);
    }
  } catch (err) { console.warn('ntfy fatto', err); }
}

export function syncReminders() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { armLocal(); syncNtfy(); }, 250);
}

export function initReminders({ fire: cb, remoteDone }) {
  onFire = cb;
  onRemoteDone = remoteDone;
  window.addEventListener('mylist:saved', syncReminders);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { pollDone(); syncReminders(); } });
  setInterval(() => { if (!document.hidden) pollDone(); }, 60000);
  pollDone().then(syncReminders);
}
