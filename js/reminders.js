// Promemoria: due canali che si completano
//  1. Notifiche del telefono dalla app: arrivano finché MyList è aperta o in background da poco
//     (un'app web non può programmare notifiche ad app chiusa).
//  2. ntfy (facoltativo): MyList programma l'avviso sul server ntfy.sh e l'app ntfy lo consegna
//     all'orario giusto anche col telefono in tasca e MyList chiusa. Massimo 3 giorni in anticipo:
//     quelli più lontani vengono programmati alle aperture successive.
import { data, settings, saveData } from './store.js';
import { remindAt } from './when.js';

const NTFY = 'https://ntfy.sh';
const PUSH_KEY = 'mylist.push.v1'; // { idVoce: "momento|canale|testo" } avvisi già programmati su ntfy
const HORIZON = 3 * 864e5 - 5 * 60000;
const APP_URL = new URL('./', location.href).href;

let timers = [];
let onFire = () => {};
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

const readPush = () => { try { return JSON.parse(localStorage.getItem(PUSH_KEY)) || {}; } catch { return {}; } };
const writePush = (m) => localStorage.setItem(PUSH_KEY, JSON.stringify(m));

// L'avviso di questa voce è già affidato a ntfy?
const pushed = (it, at) => !!settings.ntfyTopic && !!readPush()[it.id]?.startsWith(`${at}|${settings.ntfyTopic}|`);
const body = (it) => `${it.text}${it.time ? ` · alle ${it.time}` : ''}`;

async function ntfy(path, init) {
  const res = await fetch(`${NTFY}/${path}`, init);
  if (!res.ok) throw new Error(`ntfy ${res.status}`);
  return res;
}

export function sendTest(topic) {
  return ntfy(topic, {
    method: 'POST',
    headers: { Title: 'MyList', Tags: 'white_check_mark', Click: APP_URL },
    body: 'Collegamento riuscito: qui arriveranno i promemoria',
  });
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
      vibrate: [200, 100, 200], renotify: true, data: { url: APP_URL },
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
      const at = remindAt(it);
      if (!it.done && at && at > now + 15000 && at <= now + HORIZON && it.fired !== at) want.set(it.id, { it, at, key: `${at}|${topic}|${it.text}` });
    }
  }
  let changed = false;
  for (const [id, key] of Object.entries(map)) {
    const [at, was] = key.split('|');
    if (want.get(id)?.key === key) continue;
    // annulla l'avviso programmato (voce fatta, eliminata, spostata o ntfy spento); quelli già passati si dimenticano
    if (+at > now && was) await ntfy(`${was}/${id}`, { method: 'DELETE' }).catch(() => {});
    delete map[id];
    changed = true;
  }
  for (const [id, { it, at, key }] of want) {
    if (map[id] === key) continue;
    try {
      // stesso id = sostituisce l'avviso precedente della voce
      await ntfy(`${topic}/${id}`, {
        method: 'POST',
        headers: { At: String(Math.floor(at / 1000)), Title: 'MyList', Tags: 'bell', Priority: 'high', Click: APP_URL },
        body: body(it),
      });
      map[id] = key;
      changed = true;
    } catch (err) { console.warn('ntfy', err); } // offline: riprova al prossimo giro
  }
  if (changed) writePush(map);
}

export function syncReminders() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { armLocal(); syncNtfy(); }, 250);
}

export function initReminders(cb) {
  onFire = cb;
  window.addEventListener('mylist:saved', syncReminders);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncReminders(); });
  syncReminders();
}
