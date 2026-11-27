// MyList dentro l'app Android (Capacitor, cartella app/). Sul sito questo modulo non fa niente.
// Nella WebView di Android mancano dettatura e voce del browser: qui le rifacciamo coi plugin nativi, con la stessa
// forma delle API web (SpeechRecognition, speechSynthesis), così voice.js, talk.js e il resto dell'app non cambiano.
// Le notifiche native (allarmi esatti, anche ad app chiusa e dopo un riavvio) le usa reminders.js tramite Notif.
// Va importato per PRIMO in app.js: deve sostituire le API prima che gli altri moduli le guardino.
export const native = !!window.Capacitor?.isNativePlatform?.();
const plugin = (name) => (native ? window.Capacitor.Plugins?.[name] || window.Capacitor.registerPlugin?.(name) : null);
export const Notif = plugin('LocalNotifications');
const Speech = plugin('SpeechRecognition');
const TTS = plugin('TextToSpeech');
const App = plugin('App');

// —— Aggiornamenti dell'app ——
// Fuori dal Play Store Android non aggiorna da solo: a ogni versione l'APK va su GitHub Releases e il sito pubblica
// apk.json ({ version, url, notes }). L'app lo legge all'apertura; "Aggiorna" apre il link, Chrome scarica l'APK
// e Android chiede di installarlo sopra (stessa firma: i dati restano).
const UPDATE_URL = 'https://giannipietroterzo-code.github.io/mylist/apk.json';
const parts = (v) => String(v).split('.').map((n) => parseInt(n, 10) || 0);
const newer = (a, b) => { const [a1, a2 = 0] = parts(a), [b1, b2 = 0] = parts(b); return a1 !== b1 ? a1 > b1 : a2 > b2; };
export async function checkUpdate() {
  if (!native) return null;
  try {
    const r = await fetch(`${UPDATE_URL}?t=${Date.now()}`, { cache: 'no-store' });
    if (!r.ok) return null;
    const u = await r.json();
    return u?.version && u.url && newer(u.version, window.MYLIST_VERSION || '0') ? u : null;
  } catch (e) { return null; }
}
// un indirizzo esterno, nella WebView di Capacitor, si apre nel browser del telefono: è lui a scaricare l'APK
export function openUpdate(u) { location.href = u.url; }

// —— Dettatura: SpeechRecognition sopra il riconoscitore di Android ——
// Una sessione = una frase: Android si ferma da solo alla pausa, come Chrome. Le parole arrivano man mano
// (partialResults); alla chiusura l'ultima versione diventa definitiva.
class NativeRecognition {
  constructor() {
    this.lang = 'it-IT';
    this.interimResults = true;
    this.continuous = false;
    this.maxAlternatives = 1;
    this._subs = [];
    this._text = '';
    this._done = false;
    this._heard = false;
  }
  async start() {
    try {
      const p = await Speech.checkPermissions().catch(() => ({ speechRecognition: 'prompt' }));
      if (p.speechRecognition !== 'granted') {
        const r = await Speech.requestPermissions();
        if (r.speechRecognition !== 'granted') return this._fail('not-allowed');
      }
      if (this._done) return;
      this._subs.push(await Speech.addListener('partialResults', (d) => {
        const t = (d.matches?.[0] || '').trim();
        if (!t || this._done) return;
        if (!this._heard) { this._heard = true; this.onspeechstart?.({}); }
        this._text = t;
        this._emit(false);
      }));
      this._subs.push(await Speech.addListener('listeningState', (d) => {
        if (d.status === 'started') this.onaudiostart?.({});
        else if (d.status === 'stopped') setTimeout(() => this._finish(), 250); // l'ultimo pezzo arriva un attimo dopo
      }));
      Speech.start({ language: this.lang, maxResults: 1, partialResults: true, popup: false })
        .then((r) => { if (r?.matches?.[0]) { this._text = r.matches[0]; this._finish(); } })
        .catch((e) => {
          const msg = String(e?.message || e);
          if (/match|understand|speech|timeout|busy|client/i.test(msg)) this._finish(); // silenzio, niente di capito o fermato: fine normale
          else this._fail(/permission/i.test(msg) ? 'not-allowed' : /network/i.test(msg) ? 'network' : 'audio-capture');
        });
    } catch (e) { this._fail('audio-capture'); }
  }
  _emit(final) {
    const res = [{ transcript: this._text, confidence: 1 }];
    res.isFinal = final;
    this.onresult?.({ results: [res], resultIndex: 0 });
  }
  _cleanup() { this._subs.forEach((s) => s.remove?.()); this._subs = []; }
  _finish() {
    if (this._done) return;
    this._done = true;
    if (this._text) this._emit(true);
    this._cleanup();
    Speech.stop().catch(() => {});
    this.onend?.({});
  }
  _fail(code) {
    if (this._done) return;
    this.onerror?.({ error: code });
    this._finish();
  }
  stop() { Speech.stop().catch(() => {}); setTimeout(() => this._finish(), 700); }
  abort() { this._text = ''; this._finish(); }
}

// —— Voce: speechSynthesis sopra il motore di sintesi di Android ——
class NativeUtterance {
  constructor(text = '') { this.text = text; this.lang = 'it-IT'; this.rate = 1; this.pitch = 1; this.voice = null; }
}
const synth = {
  speaking: false,
  _voices: [],
  _listeners: [],
  getVoices() { return this._voices; },
  speak(u) {
    this.speaking = true;
    u.onstart?.({});
    const opts = { text: u.text, lang: u.lang || 'it-IT', rate: u.rate || 1, pitch: u.pitch || 1, category: 'playback' };
    if (u.voice?._index != null) opts.voice = u.voice._index;
    TTS.speak(opts)
      .then(() => { this.speaking = false; u.onend?.({}); })
      .catch((e) => { this.speaking = false; u.onerror?.({ error: String(e?.message || e) }); });
  },
  cancel() { this.speaking = false; TTS.stop().catch(() => {}); },
  pause() {},
  resume() {},
  addEventListener(type, fn) { if (type === 'voiceschanged') this._listeners.push(fn); },
};

if (native) {
  document.documentElement.classList.add('native');
  if (Speech) {
    window.SpeechRecognition = NativeRecognition;
    window.webkitSpeechRecognition = NativeRecognition;
  }
  if (TTS) {
    window.SpeechSynthesisUtterance = NativeUtterance;
    Object.defineProperty(window, 'speechSynthesis', { value: synth, configurable: true });
    TTS.getSupportedVoices().then(({ voices }) => {
      // il plugin chiama tutte le voci "italiano Italia": il nome vero e unico è voiceURI (es. it-it-x-itb-network)
      synth._voices = (voices || []).map((v, i) => ({ name: v.voiceURI || v.name, lang: v.lang, voiceURI: v.voiceURI, localService: v.localService, default: v.default, _index: i }));
      synth._listeners.forEach((f) => f());
    }).catch(() => {});
  }
  // Tasto indietro: chiude quello che è aperto sopra (dettatura, finestre, schede); altrimenti manda l'app in sottofondo
  App?.addListener('backButton', () => {
    const voice = document.getElementById('voice');
    if (voice && !voice.hidden) return document.getElementById('voiceCancel')?.click();
    const picker = document.getElementById('targetPicker');
    if (picker && !picker.hidden) { picker.hidden = true; return; }
    const open = [...document.querySelectorAll('dialog[open]')].pop();
    if (open) return open.close();
    const search = document.getElementById('searchBox');
    if (search && !search.hidden) return document.getElementById('searchClose')?.click();
    App.minimizeApp?.();
  });
}
