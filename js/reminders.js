// Promemoria
//  - Nell'app Android (js/native.js): notifiche native con allarmi esatti, programmate fino a 14 giorni avanti.
//    Arrivano ad app chiusa e dopo un riavvio; il testo non esce dal telefono. Sulla notifica: Fatto e +10 min.
//  - Sul sito: notifiche del browser, solo con MyList aperta o in background da poco
//    (un'app web non può svegliarsi da sola: per gli avvisi sicuri c'è l'app Android).
//  - Avvisi insistenti (it.nag = minuti): dopo il primo avviso, ancora ogni it.nag minuti finché la voce non è fatta.
// Fino alla 1.32 c'era anche ntfy: dalla 1.33 non si usa più, e cleanupNtfy() cancella da ntfy.sh gli avvisi rimasti.
import { data, settings, saveData, saveSettings } from './store.js';
import { remindAt, occurrences } from './when.js';
import { native, Notif } from './native.js';

const APP_URL = new URL('./', location.href).href;
const NATIVE_KEY = 'mylist.native.v1'; // { id numerico: "momento|testo|sequenza" } avvisi programmati su Android
const NATIVE_HORIZON = 14 * 864e5;
const NAG_MAX = 24; // ripetizioni insistenti programmate in anticipo per ogni volta (le altre alle aperture successive)

let timers = [];
let onFire = () => {};
let onRemoteDone = () => {};
let syncTimer = null;

const read = (k, d) => { try { return JSON.parse(localStorage.getItem(k)) ?? d; } catch { return d; } };
const body = (it) => `${it.text}${it.time ? ` · alle ${it.time}` : ''}`;
// Ogni volta di una voce ha la sua sequenza: id (singola) o id-AAAAMMGG (ricorrente); le insistenti ~n1, ~n2…
const seqOf = (it, due = it.due) => (it.repeat ? `${it.id}-${due.replace(/-/g, '')}` : it.id);

// —— Gli allarmi di una voce ——
// Ogni volta (occurrences) dà un allarme; se la voce è insistente, dopo ne vengono altri ogni it.nag minuti,
// fino alla volta successiva (per le ricorrenti) o finché non è fatta.
export function alarmsOf(it, untilMs, perTime = NAG_MAX) {
  const out = [];
  const occ = occurrences(it, untilMs);
  occ.forEach(({ due, at }, i) => {
    out.push({ due, at, k: 0 });
    if (!(it.nag > 0)) return;
    const stop = occ[i + 1]?.at ?? Infinity;
    for (let k = 1; k <= perTime; k++) {
      const t = at + k * it.nag * 60000;
      if (t > untilMs || t >= stop) break;
      out.push({ due, at: t, k });
    }
  });
  return out;
}
const nagSeq = (it, due, k) => (k ? `${seqOf(it, due)}~n${k}` : seqOf(it, due));

// —— Permesso ——
export const notifySupported = (native && !!Notif) || ('Notification' in window && 'serviceWorker' in navigator);
let nativePerm = 'default'; // nell'app il permesso lo tiene Android: letto all'avvio e quando lo chiedi
const permOf = (p) => (p?.display === 'granted' ? 'granted' : p?.display === 'denied' ? 'denied' : 'default');
export const notifyPermission = () => (native && Notif ? nativePerm : notifySupported ? Notification.permission : 'denied');
export async function askNotify() {
  if (native && Notif) {
    nativePerm = permOf(await Notif.requestPermissions().catch(() => null));
    syncReminders();
    return nativePerm;
  }
  if (!notifySupported) return 'denied';
  return Notification.requestPermission();
}

// —— Con l'app aperta ——
async function fire(it, at, k) {
  it.fired = at;
  saveData();
  const late = Date.now() - at > 2 * 60000;
  // nell'app Android la notifica l'ha già mostrata Android, all'ora giusta
  if (!native && notifyPermission() === 'granted' && document.hidden) {
    const reg = await navigator.serviceWorker.ready.catch(() => null);
    reg?.showNotification(k ? 'MyList · ancora da fare' : late ? 'MyList · promemoria passato' : 'MyList', {
      body: body(it), tag: it.id, icon: 'icons/icon-192.png', badge: 'icons/icon-192.png',
      // resta sullo schermo finché non la tocchi
      vibrate: settings.alertLevel !== 'normal' ? [400, 150, 400, 150, 400, 150, 800] : [200, 100, 200], renotify: true, requireInteraction: true, silent: false, data: { url: APP_URL, done: `${it.id}|${it.due}` },
      actions: [{ action: 'done', title: 'Fatto' }],
    });
  }
  onFire(it, late, k);
}

// l'allarme di quel momento era programmato su Android: è già suonato da solo
const nativeArmed = (it, at) => Object.values(read(NATIVE_KEY, {})).some((v) => v.startsWith(`${at}|`) && v.includes(`|${it.id}`));

// l'ultimo allarme già passato e il prossimo, senza elencarli tutti (un'insistente in ritardo da settimane ne avrebbe migliaia)
function pastAndNext(it, now) {
  const occ = alarmsOf(it, now + 2 ** 31 - 1, 0);
  let past = null, next = null;
  for (let i = 0; i < occ.length; i++) {
    const { at } = occ[i];
    if (at > now) { next = next || { at, k: 0 }; break; }
    past = { at, k: 0 };
    if (it.nag > 0) {
      const step = it.nag * 60000, stop = occ[i + 1]?.at ?? Infinity;
      const k = Math.floor((now - at) / step);
      if (k > 0 && at + k * step < stop) past = { at: at + k * step, k };
      const n = at + (k + 1) * step;
      if (n < stop) next = { at: n, k: k + 1 };
    }
  }
  return { past, next };
}

function armLocal() {
  timers.forEach(clearTimeout);
  timers = [];
  const now = Date.now();
  let quiet = false;
  for (const it of data.items) {
    if (it.done) continue;
    const { past, next } = pastAndNext(it, now);
    if (past && (it.fired ?? 0) < past.at) {
      if (native && nativeArmed(it, past.at)) { it.fired = past.at; quiet = true; } else fire(it, past.at, past.k);
    }
    if (next && next.at - now < 2 ** 31) timers.push(setTimeout(() => fire(it, next.at, next.k), next.at - now));
  }
  if (quiet) saveData();
}

// Una voce appena creata o modificata con l'avviso già nel passato non deve suonare subito
export function settle(it) {
  const at = remindAt(it);
  if (at != null && at <= Date.now() + 1000) it.fired = at;
}

// —— Notifiche native (app Android) ——
// un id numerico stabile per ogni avviso (Android vuole un intero a 31 bit)
function nid(seq) {
  let h = 7;
  for (const ch of seq) h = (Math.imul(h, 31) + ch.charCodeAt(0)) | 0;
  return (h & 0x3fffffff) || 1;
}
let nativeReady = null;
function prepareNative() {
  if (nativeReady) return nativeReady;
  nativeReady = (async () => {
    nativePerm = permOf(await Notif.checkPermissions().catch(() => null));
    await Notif.createChannel({
      id: 'promemoria', name: 'Promemoria', description: 'Gli avvisi delle cose da fare',
      importance: 5, visibility: 1, vibration: true, lights: true, lightColor: '#F5B800',
    }).catch(() => {});
    await Notif.registerActionTypes({ types: [{ id: 'voce', actions: [{ id: 'done', title: 'Fatto' }, { id: 'snooze', title: '+10 min' }] }] }).catch(() => {});
    Notif.addListener('localNotificationActionPerformed', ({ actionId, notification: n }) => {
      const done = n?.extra?.done;
      if (!done) return;
      if (actionId === 'done') onRemoteDone(...done.split('|'));
      else if (actionId === 'snooze') {
        Notif.schedule({ notifications: [{ ...n, id: nid(`${done}-s${Date.now()}`), schedule: { at: new Date(Date.now() + 10 * 60000), allowWhileIdle: true } }] }).catch(() => {});
      }
    });
  })();
  return nativeReady;
}
async function syncNative() {
  await prepareNative();
  if (nativePerm !== 'granted') return;
  const now = Date.now();
  const want = new Map();
  for (const it of data.items) {
    if (it.done) continue;
    for (const { due, at, k } of alarmsOf(it, now + NATIVE_HORIZON)) {
      if (at <= now + 5000 || (it.fired ?? 0) >= at) continue;
      const seq = nagSeq(it, due, k);
      want.set(nid(seq), { it, due, at, k, key: `${at}|${it.text}|${seq}` });
    }
  }
  const map = read(NATIVE_KEY, {});
  const cancel = Object.keys(map).filter((id) => want.get(+id)?.key !== map[id]);
  if (cancel.length) await Notif.cancel({ notifications: cancel.map((id) => ({ id: +id })) }).catch(() => {});
  cancel.forEach((id) => delete map[id]);
  const add = [...want].filter(([id]) => !map[id]);
  if (add.length) {
    try {
      await Notif.schedule({
        notifications: add.map(([id, { it, due, at, k }]) => ({
          id, title: k ? 'MyList · ancora da fare' : 'MyList', body: body(it), largeBody: body(it),
          channelId: 'promemoria', actionTypeId: 'voce', autoCancel: true,
          schedule: { at: new Date(at), allowWhileIdle: true },
          extra: { done: `${it.id}|${due}` },
        })),
      });
      add.forEach(([id, { key }]) => { map[id] = key; });
    } catch (err) { console.warn('notifiche native', err); }
  }
  localStorage.setItem(NATIVE_KEY, JSON.stringify(map));
}

// —— Addio ntfy ——
// Gli avvisi che la 1.32 e prima avevano programmato su ntfy.sh (fino a 3 giorni avanti) vanno cancellati,
// altrimenti arriverebbero lo stesso. Si riprova a ogni apertura finché non è andata.
async function cleanupNtfy() {
  const map = read('mylist.push.v1', null);
  const topic = settings.ntfyTopic;
  if (!map && !topic) return;
  if (!navigator.onLine) return;
  let ok = true;
  const now = Date.now();
  for (const [seq, key] of Object.entries(map || {})) {
    const [at, was] = key.split('|');
    if (!was || +at < now - 3 * 3600e3) continue;
    for (const s of [seq, `${seq}-s`]) {
      const r = await fetch(`https://ntfy.sh/${was}/${s}`, { method: 'DELETE' }).catch(() => null);
      if (!r || (!r.ok && r.status !== 404)) ok = false;
    }
  }
  if (!ok) return;
  localStorage.removeItem('mylist.push.v1');
  localStorage.removeItem('mylist.doneSince.v1');
  if (topic) { settings.ntfyTopic = ''; saveSettings(); }
}

export function syncReminders() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { armLocal(); if (native && Notif) syncNative(); }, 250);
}

export function initReminders({ fire: cb, remoteDone }) {
  onFire = cb;
  onRemoteDone = remoteDone;
  window.addEventListener('mylist:saved', syncReminders);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) syncReminders(); });
  cleanupNtfy().catch(() => {});
  syncReminders();
}
