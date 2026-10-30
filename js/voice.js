// Dettatura con la Web Speech API (Chrome Android la supporta nativamente)
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const voiceSupported = !!SR;

export function listen({ lang = 'it-IT', onText, onDone }) {
  const r = new SR();
  r.lang = lang;
  r.interimResults = true;
  r.continuous = false; // su Android il continuo duplica i risultati: una frase alla volta
  r.maxAlternatives = 1;

  let finalText = '';
  let interim = '';
  let error = null;
  let aborted = false;

  r.onresult = (e) => {
    finalText = '';
    interim = '';
    for (let i = 0; i < e.results.length; i++) {
      const res = e.results[i];
      if (res.isFinal) finalText += res[0].transcript;
      else interim += res[0].transcript;
    }
    onText?.((finalText + ' ' + interim).replace(/\s+/g, ' ').trim());
  };
  r.onerror = (e) => {
    error = e.error;
  };
  r.onend = () => {
    if (aborted) return;
    onDone?.((finalText || interim).replace(/\s+/g, ' ').trim(), error);
  };

  r.start();
  return {
    stop: () => r.stop(),
    abort: () => {
      aborted = true;
      r.abort();
    },
  };
}
