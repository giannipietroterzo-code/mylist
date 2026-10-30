// Date, orari e promemoria senza AI: "alle 16:00", "tra 20 minuti", "domani", "avvisami mezz'ora prima"
// Una voce può avere: due (YYYY-MM-DD), time (HH:MM), remind (minuti di anticipo, 0 = all'ora; null = nessun avviso)

export const dayKey = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
export const hhmm = (d) => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
export const addDays = (n, from = new Date()) => { const d = new Date(from); d.setDate(d.getDate() + n); return dayKey(d); };

// Momento dell'avviso (ms) o null
export function remindAt(it) {
  if (!it.due || !it.time || it.remind == null) return null;
  return new Date(`${it.due}T${it.time}:00`).getTime() - it.remind * 60000;
}

// "tra 20 minuti" → scadenza e orario esatti
export function fromNow(min, now = new Date()) {
  const d = new Date(now.getTime() + min * 60000);
  return { due: dayKey(d), time: hhmm(d) };
}

// Orario senza giorno: oggi se non è ancora passato, altrimenti domani
export const dayFor = (time, now = new Date()) => (time > hhmm(now) ? dayKey(now) : addDays(1, now));

const WORD = { un: 1, uno: 1, una: 1, due: 2, tre: 3, quattro: 4, cinque: 5, sei: 6, sette: 7, otto: 8, nove: 9, dieci: 10, undici: 11, dodici: 12, quindici: 15, venti: 20, trenta: 30, quaranta: 40, cinquanta: 50 };
const num = (s) => (/^\d+$/.test(s) ? +s : WORD[s.toLowerCase()] ?? null);
const UNIT = { min: 1, minut: 1, or: 60, giorn: 1440, settiman: 10080 };

// Quantità di tempo: "20 minuti", "2 ore", "un'ora", "mezz'ora", "mezzora", "un quarto d'ora", "un giorno"
const AMOUNT = String.raw`(mezz['’ ]?\s?ora|un\s+quarto\s+d['’ ]?\s?ora|(?:\d+|un|uno|una|due|tre|quattro|cinque|sei|dieci|quindici|venti|trenta|quaranta|cinquanta)\s*['’]?\s*(?:minut[oi]|min|or[ae]|giorn[oi]|settiman[ae]))`;
function minutes(a) {
  a = a.toLowerCase();
  if (a.startsWith('mezz')) return 30;
  if (a.includes('quarto')) return 15;
  const m = a.match(/^(\d+|\p{L}+)\s*['’]?\s*(min|minut|or|giorn|settiman)/u);
  return m ? (num(m[1]) ?? 1) * UNIT[m[2]] : null;
}

const REMIND_VERB = String.raw`(?:avvisami|avvisarmi|avvertimi|ricordamelo|ricordami|ricordarmi|notificami|mandami\s+un\s+avviso|fammi\s+un\s+promemoria)`;
const HOUR = String.raw`(\d{1,2}|una|due|tre|quattro|cinque|sei|sette|otto|nove|dieci|undici|dodici)`;
const DAYS = ['domenica', 'lunedi', 'martedi', 'mercoledi', 'giovedi', 'venerdi', 'sabato'];
const MONTHS = ['gennaio', 'febbraio', 'marzo', 'aprile', 'maggio', 'giugno', 'luglio', 'agosto', 'settembre', 'ottobre', 'novembre', 'dicembre'];

/**
 * Estrae giorno, orario e avviso da una frase e li toglie dal testo.
 * parseWhen("Alle 16:00 devo prendere la pasticca avvisami mezzora prima")
 *   → { text: "Prendere la pasticca", due: oggi, time: "16:00", remind: 30 }
 */
export function parseWhen(raw, now = new Date()) {
  let t = ` ${raw.trim()} `;
  let due = null;
  let time = null;
  let lead = null;
  let inMin = null;
  let evening = /\b(stasera|stanotte)\b/i.test(t);
  const wants = new RegExp(`\\b${REMIND_VERB}\\b`, 'i').test(t);
  const cut = (re, fn) => { t = t.replace(re, (...m) => { fn(...m); return ' '; }); };

  // anticipo: "avvisami mezz'ora prima", "30 minuti prima", "con un'ora di anticipo"
  cut(new RegExp(`\\s(?:e\\s+)?(?:${REMIND_VERB}\\s+)?(?:con\\s+)?${AMOUNT}\\s+(?:prima|di\\s+anticipo)\\b`, 'iu'), (m, a) => { lead = minutes(a); });
  // relativo: "tra 20 minuti", "fra un'ora"
  cut(new RegExp(`\\s(?:tra|fra)\\s+${AMOUNT}(?=[\\s,.!?])`, 'iu'), (m, a) => { inMin = minutes(a); });
  // orario: "alle 16:00", "alle 4 e mezza del pomeriggio", "all'una", "per le 9", "a mezzogiorno"
  cut(/\s(?:a\s+)?(mezzogiorno|mezzanotte)(?=[\s,.!?])/iu, (m, w) => { time = w.toLowerCase() === 'mezzogiorno' ? '12:00' : '00:00'; });
  cut(new RegExp(`\\s(?:alle|all['’]\\s*|per\\s+le|verso\\s+le|entro\\s+le|dalle|ore)\\s*(?:ore\\s+)?${HOUR}(?:[:.](\\d{2}))?(?:\\s+e\\s+(mezza|mezzo|un\\s+quarto|\\d{1,2}))?(?:\\s+(?:di\\s+|del(?:la)?\\s+)?(mattina|pomeriggio|sera|notte))?(?=[\\s,.!?])`, 'iu'),
    (m, h, mm, plus, part) => {
      let H = num(h);
      if (H == null || H > 23) return;
      let M = mm ? +mm : 0;
      if (plus) M = /mezz/i.test(plus) ? 30 : /quarto/i.test(plus) ? 15 : +plus;
      const p = (part || '').toLowerCase();
      // "alle 4" detto a voce di solito è il pomeriggio; "alle 9 di sera" → 21
      if (H < 12 && (p === 'pomeriggio' || p === 'sera' || evening || (!p && !mm && H >= 1 && H <= 7))) H += 12;
      time = `${String(H).padStart(2, '0')}:${String(Math.min(M, 59)).padStart(2, '0')}`;
    });

  // giorno
  const rel = { oggi: 0, stasera: 0, stamattina: 0, stanotte: 0, domani: 1, dopodomani: 2 };
  cut(/\s(?:per\s+|entro\s+)?(oggi|stasera|stamattina|stanotte|dopodomani|domani)(?:\s+(mattina|pomeriggio|sera))?(?=[\s,.!?])/iu, (m, w, part) => {
    due = addDays(rel[w.toLowerCase()], now);
    if (part && /sera|pomeriggio/i.test(part)) evening = true;
  });
  cut(/\s(?:per\s+|entro\s+)?(?:il\s+|la\s+)?(luned[iì]|marted[iì]|mercoled[iì]|gioved[iì]|venerd[iì]|sabato|domenica)(?:\s+prossim[oa])?(?=[\s,.!?])/iu, (m, w) => {
    const target = DAYS.indexOf(w.toLowerCase().replace('ì', 'i'));
    const diff = ((target - now.getDay() + 7) % 7) || 7;
    due = addDays(diff, now);
  });
  cut(new RegExp(`\\s(?:per\\s+|entro\\s+)?(?:il\\s+)?(\\d{1,2})\\s+(${MONTHS.join('|')})(?=[\\s,.!?])`, 'iu'), (m, d, mo) => {
    const y = now.getFullYear();
    let dt = new Date(y, MONTHS.indexOf(mo.toLowerCase()), +d);
    if (dayKey(dt) < dayKey(now)) dt = new Date(y + 1, dt.getMonth(), dt.getDate());
    due = dayKey(dt);
  });
  // "alle 9" detto dopo "stasera": correggi a 21
  if (time && evening && +time.slice(0, 2) < 12) time = `${+time.slice(0, 2) + 12}:${time.slice(3)}`;

  if (inMin != null) ({ due, time } = fromNow(inMin, now));
  else if (time && !due) due = dayFor(time, now);

  // "tra 20 minuti…" è quasi sempre un "avvisami": l'avviso parte anche senza chiederlo
  let remind = lead != null ? lead : (wants && time) || inMin != null ? 0 : null;
  if (remind == null && wants && due) { time = time || '09:00'; remind = 0; }
  if (remind != null && !time) { time = '09:00'; due = due || dayFor(time, now); }

  // pulizia del testo: verbi di servizio e connettori rimasti
  t = t.replace(new RegExp(`\\s(?:e\\s+)?${REMIND_VERB}(?:\\s+(?:di|che))?(?=\\s)`, 'giu'), ' ');
  t = t.replace(/\s+/g, ' ').trim().replace(/^[,.;:]\s*/, '').replace(/[,;:]\s*$/, '');
  for (let i = 0; i < 3; i++) t = t.replace(/^(?:devo|dovrei|bisogna|ricordati\s+di|ricordarsi\s+di|di|che|e)\s+/i, '');
  if (t) t = t[0].toUpperCase() + t.slice(1);
  return { text: t, due, time, remind };
}
