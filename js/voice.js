// Dettatura con la Web Speech API (Chrome Android la supporta nativamente).
// La fine della frase la decidiamo noi: dopo una pausa di silenzio l'ascolto si chiude e la nota parte da sola.
const getSR = () => window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!getSR();

// Parole che lasciano la frase in sospeso: se la pausa arriva dopo una di queste, aspettiamo di più
const DANGLING = new Set([
  // italiano
  'e', 'ed', 'o', 'oppure', 'poi', 'anche', 'ma', 'però', 'quindi', 'che', 'di', 'del', 'della', 'dello', 'dei', 'degli', 'delle',
  'a', 'al', 'alla', 'allo', 'ai', 'agli', 'alle', 'da', 'dal', 'dalla', 'in', 'nel', 'nella', 'nello', 'nei', 'nelle',
  'con', 'col', 'su', 'sul', 'sulla', 'per', 'tra', 'fra', 'il', 'lo', 'la', 'i', 'gli', 'le', 'un', 'uno', 'una',
  'mettilo', 'mettila', 'metti', 'aggiungi', 'compra', 'comprare', 'devo', 'ricordami', 'lista', 'tipo', 'cioè',
  // inglese
  'and', 'or', 'then', 'also', 'to', 'the', 'a', 'an', 'of', 'for', 'with', 'in', 'on', 'at', 'my',
]);

const lastWord = (t) => (t.trim().toLowerCase().match(/([\p{L}']+)[^\p{L}]*$/u) || [])[1] || '';
export const sentenceLooksOpen = (t) => DANGLING.has(lastWord(t));

/**
 * listen({ lang, pauseMs, onText, onPause, onDone })
 *  - onText(testo)          testo riconosciuto finora
 *  - onPause(ms | null)     parte (ms) o si annulla (null) il conto alla rovescia per l'invio
 *  - onDone(testo, errore)  ascolto finito: testo definitivo
 */
export function listen({ lang = 'it-IT', pauseMs = 1500, onText, onPause, onDone }) {
  const SR = getSR();
  const r = new SR();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false; // su Android il continuo duplica i risultati: una frase alla volta
  r.maxAlternatives = 1;

  let finalText = '';
  let interim = '';
  let error = null;
  let aborted = false;
  let timer = null;

  const text = () => (finalText + ' ' + interim).replace(/\s+/g, ' ').trim();
  const clear = () => { clearTimeout(timer); timer = null; };
  // Ogni nuovo pezzo di frase riavvia il conto alla rovescia; a fine pausa chiudiamo noi l'ascolto
  const arm = () => {
    clear();
    const t = text();
    if (!t) return;
    const ms = sentenceLooksOpen(t) ? pauseMs + 1500 : pauseMs;
    onPause?.(ms);
    timer = setTimeout(() => { timer = null; r.stop(); }, ms);
  };
  // Se dopo un po' non si sente nulla, chiudi
  const idle = setTimeout(() => { if (!text()) r.stop(); }, 7000);

  r.onresult = (e) => {
    finalText = '';
    interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    onText?.(text());
    arm();
  };
  // Il riconoscitore sente di nuovo voce: sospendi l'invio finché arrivano parole
  r.onspeechstart = () => { if (timer) { clear(); onPause?.(null); } };
  r.onerror = (e) => { error = e.error; };
  r.onend = () => {
    clear();
    clearTimeout(idle);
    onPause?.(null);
    if (aborted) return;
    onDone?.(text(), error);
  };

  r.start();
  return {
    stop: () => { clear(); r.stop(); },
    abort: () => {
      aborted = true;
      clear();
      clearTimeout(idle);
      r.abort();
    },
  };
}
