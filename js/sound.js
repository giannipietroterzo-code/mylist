// Suoneria dei promemoria con l'app aperta: un "din-don" sintetizzato (nessun file audio da scaricare)
let ctx = null;

// I browser fanno partire l'audio solo dopo un tocco: prepariamo il contesto al primo tocco sulla pagina
export function primeSound() {
  const wake = () => {
    try {
      ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
      if (ctx.state === 'suspended') ctx.resume();
    } catch (err) { ctx = null; }
  };
  addEventListener('pointerdown', wake, { once: true, capture: true });
  addEventListener('keydown', wake, { once: true, capture: true });
}

function bell(t, freq, vol) {
  // fondamentale + armoniche "da campanello", attacco secco e coda morbida
  [[1, 1], [2.01, 0.35], [3.02, 0.15]].forEach(([k, g]) => {
    const o = ctx.createOscillator();
    const a = ctx.createGain();
    o.type = 'sine';
    o.frequency.value = freq * k;
    a.gain.setValueAtTime(0.0001, t);
    a.gain.exponentialRampToValueAtTime(vol * g, t + 0.01);
    a.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
    o.connect(a).connect(ctx.destination);
    o.start(t);
    o.stop(t + 1.2);
  });
}

// times: quante volte ripetere il din-don (forte = 3)
export function chime(times = 1) {
  try {
    ctx = ctx || new (window.AudioContext || window.webkitAudioContext)();
    if (ctx.state === 'suspended') ctx.resume();
    const t0 = ctx.currentTime + 0.05;
    for (let i = 0; i < times; i++) {
      bell(t0 + i * 1.1, 1318.5, 0.35); // mi
      bell(t0 + i * 1.1 + 0.32, 1046.5, 0.3); // do
    }
  } catch (err) { /* audio non disponibile: resta la vibrazione */ }
}
