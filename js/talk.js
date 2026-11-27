// Parlare con l'assistente a mani libere (come Mino in MyMind). Al centro c'è il nucleo, il logo di MyList con
// intorno linee morbide, che cambia con quello che succede: a riposo respira; quando ascolta le tre barre e
// le linee seguono la voce; quando pensa la spunta si disegna e le linee girano; quando parla tutto pulsa con la voce.
// Detto a voce → risponde a voce, e il microfono si riapre da solo. Scritto nella riga in fondo → risponde scritto.
// "Sì" / "no" / "annulla" detti a voce confermano, scartano o annullano le modifiche dell'ultima risposta.
// Regola presa da Mino: UN GIRO ALLA VOLTA. Ogni cosa nuova (ascolto, risposta, chiusura) ferma quella di prima,
// che non può più né parlare né scrivere sullo schermo (ogni suo passo controlla T.turn).
import { icon } from './icons.js';
import { settings, saveSettings } from './store.js';
import { sentenceLooksOpen } from './voice.js';
import { ask, act, openRef, fmt, spoken, changesHTML, aiName, lastReply, canUndo } from './chat.js';

const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
const END = 2000;        // silenzio dopo l'ultima parola che vuol dire «ho finito»
const WAIT = 8000;       // quanto aspetta che cominci a parlare
const WAIT_AGAIN = 6500; // …se il microfono si è riaperto da solo dopo una risposta
const RATES = [1, 1.1, 1.2, 1.35, 1.5];
const T = { turn: 0, state: 'off', energy: 0, smooth: 0, rot: 0, draw: 0, sr: null, finish: null, due: null, timer: 0 };
const $ = (id) => document.getElementById(id);
let app = {};

export const talkOpen = () => !$('talk').hidden;

function setState(state, label) {
  T.state = state;
  $('talk').dataset.state = state;
  if (label !== undefined) $('talkLabel').textContent = label;
}
const note = (t = '') => { $('talkNote').textContent = t; };

// ferma il giro in corso, qualunque cosa stesse facendo
function halt() {
  T.turn++;
  try { T.sr?.abort(); } catch (e) { /* già chiuso */ }
  T.sr = null; T.finish = null; T.due = null;
  clearTimeout(T.timer);
  window.speechSynthesis?.cancel();
}

/** openTalk({ listen, text }): listen → parte già in ascolto · text → una frase già detta da mandare */
export function openTalk({ listen = false, text = '' } = {}) {
  const el = $('talk');
  const first = el.hidden;
  el.hidden = false;
  $('talkName').textContent = aiName();
  if (first) {
    $('talkYou').textContent = '';
    $('talkChanges').innerHTML = '';
    $('talkSays').innerHTML = `<p class="talk-hi">Dimmi cosa fare o chiedimi cosa c'è: liste, scadenze, appunti, idee.</p>`;
    note(getSR() ? 'Tocca il cerchio per parlare, o per interrompermi.' : 'Qui non posso ascoltarti: scrivimi qui sotto.');
    setState('rest', getSR() ? 'Tocca per parlare' : '');
    cancelAnimationFrame(T.draw);
    T.draw = requestAnimationFrame(paint);
    pills();
  }
  if (text.trim()) return think(text, true);
  if (listen) return hear(false);
}
export function closeTalk() {
  if ($('talk').hidden) return;
  halt();
  setState('off', '');
  $('talk').hidden = true;
  cancelAnimationFrame(T.draw);
}

function tap() {
  if (T.state === 'listen' && T.finish) return T.finish();  // hai finito di parlare: manda subito quello che ha sentito
  hear(false);                                               // a riposo: parla. Mentre pensa o parla: lo interrompi
}

// —— L'ascolto ——
// Il riconoscimento di Chrome su Android si chiude da solo a ogni pausa (e in modo continuo duplica le parole), quindi
// un ascolto è UNA finestra di tempo nostra: se si chiude a metà frase se ne apre un altro e quello che aveva capito resta.
// A decidere che hai finito è il silenzio dopo l'ultima parola (di più se la frase resta in sospeso: «compra il latte e…»).
function hear(again) {
  halt();
  const g = T.turn;
  const SR = getSR();
  if (!SR) { setState('rest', ''); return note('Qui non posso ascoltarti: scrivimi qui sotto.'); }
  window.speechSynthesis?.cancel();
  const parts = [];
  let fin = '', mid = '', closed = false, endAt = 0, rec = null, restarts = 0, startedAt = 0, ready = false, extended = false;
  const text = () => [...parts, fin, mid].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim();
  const arm = (ms) => {
    endAt = Date.now() + ms;
    T.due = { start: Date.now(), ms, words: !!text() };
    clearTimeout(T.timer);
    T.timer = setTimeout(close, ms);
  };
  const close = () => {
    if (closed) return;
    closed = true;
    clearTimeout(T.timer);
    if (g !== T.turn) return;
    T.due = null; T.finish = null;
    try { rec?.abort(); } catch (e) { /* già chiuso */ }
    T.sr = null;
    const t = text();
    if (t) heard(t);
    else setState('rest', again ? 'Tocca per parlare' : 'Non ho sentito');
  };
  const start = () => {
    const q = new SR();
    rec = q; T.sr = q;
    q.lang = settings.lang || 'it-IT';
    q.interimResults = true;
    q.continuous = false;
    q.maxAlternatives = 1;
    startedAt = Date.now();
    const mine = (f) => (e) => { if (rec === q && !closed && g === T.turn) f(e); };
    // «Ti ascolto» solo quando il microfono è davvero aperto: prima le prime sillabe andrebbero perse
    q.onaudiostart = mine(() => {
      if (ready) return;
      ready = true;
      setState('listen', 'Ti ascolto');
      navigator.vibrate?.(10);
    });
    // c'è di nuovo voce dopo una pausa: non chiudere proprio adesso (una volta sola per pausa, il rumore non la allunga all'infinito)
    q.onspeechstart = mine(() => { T.energy = Math.min(1, T.energy + 0.3); if (!extended && endAt - Date.now() < END) { extended = true; arm(END); } });
    q.onresult = mine((e) => {
      fin = ''; mid = ''; extended = false;
      for (const x of e.results) { if (x.isFinal) fin += x[0].transcript; else mid += x[0].transcript; }
      fin = fin.trim(); mid = mid.trim();
      const t = text();
      $('talkYou').textContent = t;
      T.energy = Math.min(1, T.energy + 0.5);
      arm(sentenceLooksOpen(t) ? END + 1500 : END);
    });
    q.onerror = mine((e) => {
      if (!['not-allowed', 'service-not-allowed', 'audio-capture', 'network', 'language-not-supported'].includes(e.error)) return; // «no-speech»: ci pensa onend
      closed = true;
      clearTimeout(T.timer);
      T.due = null; T.sr = null; T.finish = null;
      note(/allowed/.test(e.error) ? 'Non ho il permesso di usare il microfono.' : e.error === 'network' ? 'Per ascoltarti serve la rete.' : `Il microfono non va (${e.error}).`);
      setState('rest', 'Tocca per riprovare');
    });
    q.onend = () => {
      if (rec !== q) return;
      const here = [fin, mid].filter(Boolean).join(' ');
      if (here) parts.push(here);
      fin = ''; mid = '';
      if (closed || g !== T.turn) return;
      // chiuso dal telefono prima del tempo: si riapre se stavi già parlando (o se si è chiuso appena aperto, una volta)
      const midway = parts.length > 0, early = Date.now() - startedAt < 1200 && restarts === 0;
      if ((midway || early) && Date.now() < endAt - 150 && restarts < 6) {
        restarts++;
        try { start(); return; } catch (err) { /* non riparte: chiudi */ }
      }
      close();
    };
    q.start();
  };
  $('talkSays').querySelector('.talk-hi')?.remove(); // il saluto sparisce; una risposta vera resta, da rileggere
  setState('wake', 'Apro il microfono…');
  $('talkYou').textContent = '';
  note('');
  T.finish = close;
  arm(again ? WAIT_AGAIN : WAIT);
  try { start(); } catch (err) { closed = true; clearTimeout(T.timer); T.due = null; setState('rest', 'Il microfono non parte'); }
}

// —— Quello che hai detto ——
const YES = /^(?:sì|si|ok|okay|va bene|vai|applica|conferma|confermo|procedi|fallo|certo|esatto|giusto)(?![\p{L}\p{N}])[\s,.!]*/iu;
const NO = /^(?:no|scarta|lascia stare|lascia perdere|niente|non farlo)(?![\p{L}\p{N}])[\s,.!]*/iu;
const UNDO = /^(?:annulla|torna indietro|rimetti (?:com'era|come prima)|ripristina)[\s.!]*$/iu;
const BYE = /^(?:basta|stop|fine|chiudi|a posto così|ho finito|grazie(?:,? (?:basta|a posto|è tutto|così))?|è tutto)[\s.!]*$/iu;
const short = (t) => t.split(/\s+/).length <= 4;

function heard(t) {
  const m = lastReply();
  if (m?.state === 'pending') {
    const y = t.match(YES), n = t.match(NO);
    if (y) {
      act('apply', m.id);
      const rest = t.slice(y[0].length).trim();
      if (rest && !short(rest)) return think(rest, true);
      return reply(m, 'Fatto.', true);
    }
    if (n) {
      act('discard', m.id);
      const rest = t.slice(n[0].length).trim();
      if (rest) return think(rest, true); // «no, mettilo giovedì»: scarta e chiedi di nuovo
      return reply(m, 'Va bene, lascio stare.', true);
    }
  }
  if (UNDO.test(t) && canUndo(m)) {
    act('undo', m.id);
    return reply(m, m.state === 'undone' ? 'Annullato, è tutto come prima.' : 'Nel frattempo è cambiato altro: sistemalo a mano.', true);
  }
  if (BYE.test(t)) {
    $('talkYou').textContent = t;
    return say('Va bene, a dopo.', T.turn, false);
  }
  think(t, true);
}

// risposte decise qui, senza IA: aggiorna le carte della risposta e dillo
function reply(m, text, voice) {
  halt();
  showChanges(m);
  $('talkSays').innerHTML = `<p>${app.esc(text)}</p>`;
  if (voice) say(text, T.turn);
  else setState('rest', 'Tocca per parlare');
}

async function think(text, voice) {
  halt();
  const g = T.turn;
  setState('think', 'Ci penso');
  $('talkYou').textContent = text;
  $('talkSays').innerHTML = '';
  $('talkChanges').innerHTML = '';
  note('');
  const m = await ask(text);
  if (g !== T.turn || !talkOpen()) return;
  if (!m) return setState('rest', 'Tocca per parlare');
  $('talkSays').innerHTML = fmt(m.text);
  $('talkSays').classList.toggle('long', m.text.length > 220);
  showChanges(m);
  if (m.noAi) {
    note('');
    $('talkChanges').innerHTML = `<button class="pill-btn" data-act="settings">${icon('gear')}Apri le Impostazioni</button>`;
  }
  if (!voice || document.hidden) return setState('rest', 'Tocca per parlare');
  let words = spoken(m.text);
  if (m.state === 'pending' && !/\?\s*$/.test(words)) words += ' Confermi?';
  say(words, g);
}

function showChanges(m) {
  $('talkChanges').innerHTML = m ? changesHTML(m) : '';
}

// —— La voce ——
// Una frase alla volta: su Android un testo lungo detto tutto insieme a volte si interrompe a metà.
function voices() {
  const lang = (settings.lang || 'it-IT').slice(0, 2);
  const vs = (window.speechSynthesis?.getVoices() || []).filter((v) => v.lang.replace('_', '-').toLowerCase().startsWith(lang));
  // nel giro del tasto prima le voci migliori, nello stesso ordine della scelta di partenza
  const rank = (v) => { const i = VOICE_PREF.findIndex((re) => re.test(v.name)); return i < 0 ? 99 : i; };
  return vs.map((v, i) => [v, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([v]) => v);
}
// le voci di Google su Android si chiamano it-it-x-itb-network: diventano "Voce B · online"
function voiceName(v) {
  const g = v.name.match(/^[a-z]{2}-[a-z]{2}-x-[a-z]{2}([a-z])-(local|network)$/i);
  if (g) return `Voce ${g[1].toUpperCase()}${g[2] === 'network' ? ' · online' : ''}`;
  return v.name.replace(/^(Google|Microsoft|Apple)\s+/i, '').replace(/\s*\(.*\)\s*$/, '').replace(/\s+-\s+.*$/, '').trim() || v.name;
}
// la voce di partenza: Alice (Mac e iPhone: la più naturale tra quelle del sistema), poi le femminili di Google
// (b, c), meglio quelle online, poi le altre
const VOICE_PREF = [/^alice\b/i, /-x-itb-network$/i, /-x-itc-network$/i, /-x-itb-local$/i, /-x-itc-local$/i, /network$/i, /google/i];
export function chosenVoice() {
  const vs = voices();
  const pref = VOICE_PREF.map((re) => vs.find((v) => re.test(v.name))).find(Boolean);
  return vs.find((v) => v.name === settings.talkVoice) || pref || vs[0] || null;
}

function say(text, g, thenListen = true) {
  const done = () => {
    if (g !== T.turn) return;
    setState('rest', 'Tocca per parlare');
    if (!thenListen) return;
    // dopo un respiro, per non sentire la coda della propria voce
    T.timer = setTimeout(() => { if (g === T.turn && talkOpen() && !document.hidden) hear(true); }, 420);
  };
  // ogni riga (le voci di un elenco) è una frase a sé, con la sua pausa
  const flat = String(text).split('\n').map((l) => l.trim()).filter(Boolean).map((l) => (/[.!?…:;]$/.test(l) ? l : l + '.')).join(' ');
  // si spezza solo dove la punteggiatura è seguita da uno spazio: «alle 10:30» e «19.00» restano interi
  const sentences = (flat.match(/.+?(?:[.!?…:]+(?=\s|$)|$)/g) || []).map((s) => s.trim()).filter(Boolean);
  if (!window.speechSynthesis || !sentences.length) return done();
  setState('speak', aiName());
  const v = chosenVoice();
  const next = () => {
    if (g !== T.turn) return;
    const s = sentences.shift();
    if (!s) return done();
    const u = new SpeechSynthesisUtterance(s);
    u.lang = settings.lang || 'it-IT';
    if (v) u.voice = v;
    u.rate = settings.talkRate || 1.1;
    let over = false;
    const end = () => { if (over) return; over = true; clearTimeout(T.timer); next(); };
    u.onend = end;
    u.onerror = end;
    u.onboundary = () => { T.energy = Math.min(1, T.energy + 0.35); };
    // a volte Chrome non avvisa della fine: un tempo massimo per frase
    clearTimeout(T.timer);
    T.timer = setTimeout(end, 2500 + (s.length * 95) / u.rate);
    speechSynthesis.speak(u);
  };
  speechSynthesis.cancel();
  next();
}

// le due pastiglie in testata: con che voce parla, quanto è svelto
function pills() {
  $('talkRate').textContent = String(settings.talkRate || 1.1).replace('.', ',') + '×';
  const vs = voices();
  $('talkVoice').hidden = vs.length < 2;
  const v = chosenVoice();
  $('talkVoice').textContent = v ? voiceName(v) : '';
}
function trySample() {
  halt();
  say(`Ecco, parlo così. Ti torna?`, T.turn, false);
}

// —— Il nucleo ——
// Il logo di MyList (tre barre e la spunta, viewBox 104 150 304 212) libero al centro.
// Intorno, cinque linee sottili e morbide che si intrecciano. A riposo respirano; quando ascolti si allargano e
// ondeggiano con la voce; quando pensa girano svelte e si stringono; quando parla pulsano.
// Mentre ascolta, una linea punteggiata intorno si accorcia col tempo che resta prima che chiuda la frase.
const BARS = [[122, 224, 288], [172, 176, 336], [222, 208, 304]];
const CHECK = [[268, 262], [312, 306], [390, 204]];
const CHECK_LEN = Math.hypot(44, 44) + Math.hypot(78, 102);
// le linee: lobi (k), ampiezza, velocità, fase, misura, opacità
const BLOBS = [
  { k: [2, 3, 5], amp: [0.07, 0.05, 0.025], spd: [0.5, -0.7, 0.9], ph: 0, size: 1.0, alpha: 0.9 },
  { k: [3, 2, 4], amp: [0.06, 0.06, 0.03], spd: [-0.6, 0.8, 0.4], ph: 1.3, size: 0.97, alpha: 0.6 },
  { k: [2, 4, 3], amp: [0.08, 0.04, 0.03], spd: [0.7, 0.5, -1.1], ph: 2.6, size: 1.03, alpha: 0.45 },
  { k: [3, 5, 2], amp: [0.05, 0.03, 0.06], spd: [-0.4, 1.0, 0.6], ph: 3.9, size: 0.94, alpha: 0.35 },
  { k: [4, 2, 5], amp: [0.05, 0.07, 0.02], spd: [0.9, -0.5, 0.7], ph: 5.2, size: 1.06, alpha: 0.25 },
];
function blob(g, c, r, b, t, wobble) {
  const N = 72;
  g.beginPath();
  for (let n = 0; n <= N; n++) {
    const a = (n / N) * Math.PI * 2;
    let f = 1;
    for (let q = 0; q < 3; q++) f += b.amp[q] * wobble * Math.sin(b.k[q] * a + b.spd[q] * t + b.ph);
    const x = c + Math.cos(a) * r * f, y = c + Math.sin(a) * r * f;
    if (n) g.lineTo(x, y); else g.moveTo(x, y);
  }
  g.closePath();
}
function paint(now) {
  const el = $('talk');
  if (el.hidden) return;
  T.draw = requestAnimationFrame(paint);
  const cv = $('talkCore').querySelector('canvas');
  const dpr = window.devicePixelRatio || 1, side = cv.clientWidth;
  if (!side) return;
  if (cv.width !== Math.round(side * dpr)) cv.width = cv.height = Math.round(side * dpr);
  const g = cv.getContext('2d'), c = side / 2, R = side * 0.3, s = T.state, sec = now / 1000;
  const css = getComputedStyle(el);
  const acc = css.getPropertyValue('--accent').trim() || '#F5B800';
  const ring = css.getPropertyValue('--accent-ink').trim() || acc;
  const ink = css.getPropertyValue('--text').trim() || '#222';
  const faint = css.getPropertyValue('--text-3').trim() || '#999';
  const surf = css.getPropertyValue('--surface').trim() || '#fff';
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, side, side);
  if (s === 'speak') T.energy = Math.max(T.energy, 0.3 + 0.35 * Math.abs(Math.sin(sec * 8.5)) * Math.abs(Math.sin(sec * 2.1)));
  T.smooth += (T.energy - T.smooth) * 0.22;
  T.energy *= 0.9;
  const e = T.smooth, breath = 0.5 + 0.5 * Math.sin(sec * 1.3), off = s === 'off' || s === 'wake';
  // il tempo delle linee: più svelto quando pensa o ti ascolta
  T.rot += (s === 'think' ? 2.6 : s === 'listen' ? 1.3 + e * 2 : s === 'speak' ? 1.1 + e * 1.5 : 0.45) / 60;
  const T0 = side * 0.42 * (1 + (s === 'rest' ? breath * 0.015 : e * 0.035)); // misura del logo
  g.lineCap = 'round'; g.lineJoin = 'round';

  // quanto sono larghe e mosse
  const grow = s === 'think' ? 0.88 : s === 'listen' ? 1 + e * 0.1 : s === 'speak' ? 1 + e * 0.1 : 0.97 + breath * 0.03;
  const wob = s === 'think' ? 1.3 : s === 'rest' ? 0.7 : 0.9 + e * 0.9;
  // linee morbide intorno al logo, che si intrecciano e si muovono con la voce
  BLOBS.forEach((b, q) => {
    const r = R * 1.02 * b.size * grow;
    g.strokeStyle = q % 2 ? ring : acc;
    g.globalAlpha = (off ? 0.2 : b.alpha) * (s === 'rest' ? 0.7 : 1);
    g.lineWidth = q === 0 ? 1.8 : 1.1;
    blob(g, c, r, b, T.rot + q * 0.4, wob);
    g.stroke();
  });
  g.globalAlpha = 1;

  // mentre ascolta: il tempo che resta, una linea punteggiata che si accorcia
  if (s === 'listen' && T.due) {
    const left = Math.max(0, 1 - (Date.now() - T.due.start) / T.due.ms);
    g.strokeStyle = T.due.words ? ring : faint; g.globalAlpha = T.due.words ? 0.9 : 0.5; g.lineWidth = 3;
    g.setLineDash([0.1, 9]);
    g.beginPath(); g.arc(c, c, R * 1.58, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left); g.stroke();
    g.setLineDash([]); g.globalAlpha = 1;
  }

  g.globalAlpha = 1;
  // il logo, libero al centro
  const k = (T0 * 0.8) / 304, X = (x) => c + (x - 256) * k, Y = (y) => c + (y - 256) * k;
  BARS.forEach(([x, y1, y2], i) => {
    const mid = (y1 + y2) / 2, half = (y2 - y1) / 2;
    let f = 1;
    if (s === 'listen' || s === 'speak') f = 0.45 + e * (0.75 + 0.35 * Math.sin(sec * (7 + i * 2.3) + i * 1.7));
    else if (s === 'rest') f = 0.94 + 0.06 * Math.sin(sec * 1.3 + i * 0.9);
    else if (s === 'think') f = 0.7 + 0.3 * Math.abs(Math.sin(sec * 3 - i * 0.8));
    const h = Math.max(17, half * Math.min(1.25, f));
    g.strokeStyle = ink; g.globalAlpha = off ? 0.35 : 0.92; g.lineWidth = 34 * k;
    g.beginPath(); g.moveTo(X(x), Y(mid - h)); g.lineTo(X(x), Y(mid + h)); g.stroke();
  });
  // la spunta: si disegna mentre pensa, si accende quando parla
  g.strokeStyle = acc; g.globalAlpha = off ? 0.4 : 1; g.lineWidth = 34 * k;
  g.shadowColor = acc;
  g.shadowBlur = off ? 0 : s === 'speak' ? 6 + e * 18 : 4;
  if (s === 'think') {
    const t = (sec * 0.9) % 1.6;
    g.setLineDash([CHECK_LEN * k, CHECK_LEN * k]);
    g.lineDashOffset = CHECK_LEN * k * (1 - Math.min(1, t / 1.1));
  }
  g.beginPath(); g.moveTo(X(CHECK[0][0]), Y(CHECK[0][1])); g.lineTo(X(CHECK[1][0]), Y(CHECK[1][1])); g.lineTo(X(CHECK[2][0]), Y(CHECK[2][1])); g.stroke();
  g.setLineDash([]); g.lineDashOffset = 0; g.shadowBlur = 0; g.globalAlpha = 1; g.lineCap = 'butt';
}

export function initTalk(deps) {
  app = deps;
  $('talkClose').innerHTML = icon('x');
  $('talkSend').innerHTML = icon('send');
  $('talkConv').innerHTML = `${icon('comments')}<span>Conversazione</span>`;
  $('talkClose').onclick = () => $('chat').close();
  $('talkConv').onclick = () => closeTalk();
  $('talkCore').onclick = tap;
  $('talkRate').onclick = () => {
    const i = RATES.indexOf(settings.talkRate);
    settings.talkRate = RATES[(i + 1) % RATES.length];
    saveSettings();
    pills();
    trySample();
  };
  $('talkVoice').onclick = () => {
    const vs = voices();
    if (!vs.length) return;
    const i = vs.indexOf(chosenVoice());
    settings.talkVoice = vs[(i + 1) % vs.length].name;
    saveSettings();
    pills();
    trySample();
  };
  window.speechSynthesis?.addEventListener?.('voiceschanged', () => { if (talkOpen()) pills(); });
  $('talkForm').addEventListener('submit', (e) => {
    e.preventDefault();
    const input = $('talkInput');
    const t = input.value.trim();
    if (!t) return;
    input.value = '';
    input.blur();
    think(t, false);
  });
  $('talkScene').addEventListener('click', (e) => {
    const ref = e.target.closest('[data-ref]');
    if (ref) { halt(); setState('rest', 'Tocca per parlare'); return openRef(ref.dataset.ref); }
    const b = e.target.closest('[data-act]');
    if (!b) return;
    if (b.dataset.act === 'settings') { $('chat').close(); return app.openSettings(); }
    halt();
    act(b.dataset.act, b.dataset.id);
    const m = lastReply();
    showChanges(m && m.id === b.dataset.id ? m : null);
    setState('rest', 'Tocca per parlare');
  });
  // l'app va in sottofondo: microfono e voce si fermano
  document.addEventListener('visibilitychange', () => {
    // mentre pensa no: la risposta arriva lo stesso e resta scritta, senza voce
    if (document.hidden && talkOpen() && ['wake', 'listen', 'speak'].includes(T.state)) { halt(); setState('rest', 'Tocca per parlare'); }
  });
  // dopo aver modificato una voce aperta da un cartellino, le carte si aggiornano
  $('sheet').addEventListener('close', () => { if (talkOpen()) { const m = lastReply(); if (m && $('talkChanges').innerHTML) showChanges(m); } });
}
