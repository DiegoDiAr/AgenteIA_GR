// Calendario civil de Lima: no depende del huso horario del proceso ni de cálculos del modelo.
export const TIME_ZONE = 'America/Lima';
const pad = n => String(n).padStart(2, '0');
const fold = text => String(text ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const months = ['enero','febrero','marzo','abril','mayo','junio','julio','agosto','septiembre','octubre','noviembre','diciembre'];
const weekdays = ['domingo','lunes','martes','miercoles','jueves','viernes','sabado'];
const localFormatter = new Intl.DateTimeFormat('en-CA', { timeZone: TIME_ZONE, year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', hourCycle:'h23' });
export function limaClock(now = new Date()) {
  const instant = new Date(now);
  if (!Number.isFinite(instant.getTime())) throw new TypeError('Reloj no válido');
  const p = Object.fromEntries(localFormatter.formatToParts(instant).map(item => [item.type,item.value]));
  return { timeZone: TIME_ZONE, date: p.year+'-'+p.month+'-'+p.day, time: p.hour+':'+p.minute, instant: instant.toISOString() };
}
function civil(iso) { const [y,m,d] = iso.split('-').map(Number); return new Date(Date.UTC(y,m-1,d)); }
function dayOffset(iso, offset) { const date = civil(iso); date.setUTCDate(date.getUTCDate()+offset); return date.toISOString().slice(0,10); }
function validDate(year, month, day) {
  if (year < 1000 || year > 9999 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const date = new Date(Date.UTC(year,month-1,day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month-1 && date.getUTCDate() === day ? year+'-'+pad(month)+'-'+pad(day) : null;
}
export function parseDatePreference(value, now = new Date()) {
  const original = String(value ?? '').trim(), text = fold(original), reference = limaClock(now);
  let remaining = text;
  const candidates = [], fragments = []; let issue = null;
  const collect = (pattern, resolve) => {
    remaining = remaining.replace(pattern, (...parts) => {
      const match = parts[0], groups = parts.slice(1,-2);
      fragments.push(original.slice(parts.at(-2), parts.at(-2)+match.length));
      const resolved = resolve(match,...groups);
      if (resolved) candidates.push(resolved);
      return ' '.repeat(match.length);
    });
  };
  collect(/\b(\d{4})-(\d{2})-(\d{2})\b/g, (_s,y,m,d) => validDate(+y,+m,+d) || (issue='invalid_date',null));
  collect(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d+))?\b/g, (_s,d,m,y) => {
    if (y && y.length !== 4) { issue=y.length === 2 ? 'ambiguous_year' : 'invalid_date'; return null; }
    const iso = validDate(y ? +y : +reference.date.slice(0,4),+m,+d);
    if (!iso) issue='invalid_date';
    else if (!y && iso < reference.date) issue='ambiguous_year';
    return iso;
  });
  collect(/\b(\d{1,2})\s+(?:de\s+)?(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)(?:\s+(?:de\s+)?(\d+))?\b/g, (_s,d,m,y) => {
    if (y && y.length !== 4) { issue=y.length === 2 ? 'ambiguous_year' : 'invalid_date'; return null; }
    const month = m === 'setiembre' ? 9 : months.indexOf(m)+1;
    const iso = validDate(y ? +y : +reference.date.slice(0,4),month,+d);
    if (!iso) issue='invalid_date';
    else if (!y && iso < reference.date) issue='ambiguous_year';
    return iso;
  });
  collect(/\bpasado\s+manana\b/g, () => dayOffset(reference.date,2));
  collect(/\b(?:hoy|esta manana|esta tarde|esta noche)\b/g, () => reference.date);
  // «de/por la mañana» expresa una franja, no el día siguiente.
  const morning = /\bmanana\b/g; let match;
  while ((match = morning.exec(remaining))) {
    if (/(?:de|por|en) la\s*$/.test(remaining.slice(0,match.index))) continue;
    fragments.push(original.slice(match.index,match.index+match[0].length)); candidates.push(dayOffset(reference.date,1));
  }
  const days = /\b(?:(el\s+)?(proximo|este)\s+|el\s+)?(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/g;
  while ((match = days.exec(remaining))) {
    const target = weekdays.indexOf(match[3]), delta = (target-civil(reference.date).getUTCDay()+7)%7;
    fragments.push(original.slice(match.index,match.index+match[0].length));
    if (candidates.length) {
      if (candidates.some(iso => civil(iso).getUTCDay() !== target)) issue='ambiguous_date';
      continue;
    }
    if (delta === 0 && match[2] !== 'proximo' && match[2] !== 'este') issue='ambiguous_weekday';
    candidates.push(dayOffset(reference.date, delta || (match[2] === 'este' ? 0 : 7)));
  }
  const unique = [...new Set(candidates)];
  if (unique.length > 1) issue='ambiguous_date';
  const found = fragments.length > 0;
  const candidate = unique.length === 1 ? unique[0] : null;
  if (!issue && candidate && candidate < reference.date) issue='past_date';
  return { found, value: issue ? null : candidate, candidate, original: found ? fragments.join(' · ') : original, issue: issue || (found ? null : 'unrecognized_date'), reference: reference.date, expressedAt: reference.instant };
}
const hourWords = { una:1,uno:1,dos:2,tres:3,cuatro:4,cinco:5,seis:6,siete:7,ocho:8,nueve:9,diez:10,once:11,doce:12 };
export function parseTimePreference(value, { period: previousPeriod = null } = {}) {
  let original = String(value ?? '').trim();
  const text = fold(original);
  if ([...text.matchAll(/\b\d+:\S+/g)].some(match => !/^\d{1,2}:\d{2}(?:[ap]\.?m\.?)?[.,]?$/.test(match[0]))) return {found:true,value:null,original,period:null,issue:'invalid_time'};
  const periodMatch = text.match(/\b(?:de|por|en) la (manana|tarde|noche|madrugada)\b|\besta (manana|tarde|noche)\b/);
  const explicitPeriod = periodMatch?.[1] || periodMatch?.[2] || null;
  const meridiemMatch = text.match(/(?<![a-z])([ap])\s*\.?\s*m\.?(?![a-z])/);
  const meridiem = meridiemMatch ? meridiemMatch[1]+'m' : null;
  const token = '(\\d{1,2}|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)';
  const timePattern = new RegExp('(?:\\ba las?\\s+|\\bsobre las?\\s+|\\bhacia las?\\s+|\\btipo\\s+)' + token + '(?::(\\d{2}))?(?:\\s+y (media|cuarto))?', 'g');
  const prefixed = [...text.matchAll(timePattern)];
  const clocks = [...text.matchAll(/\b(\d{1,2}):(\d{2})\b/g)];
  const suffixed = text.match(new RegExp('\\b'+token+'(?:\\s+y (media|cuarto))?\\s*(?:[ap]\\s*\\.?\\s*m\\.?|(?:de|por) la (?:manana|tarde|noche|madrugada))\\b'));
  const bare = text.match(new RegExp('^'+token+'(?::(\\d{2}))?(?:\\s+y (media|cuarto))?(?:\\s+aproximadas?)?$'));
  const match = prefixed[0] || clocks[0] || suffixed || bare;
  const numericValues = new Set([...prefixed, ...clocks].map(m => String(hourWords[m[1]] ?? +m[1])+':'+(m[2] || '00')));
  if (/\bentre\s+(?:las?\s+)?(?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\s+y\s+(?:las?\s+)?(?:\d{1,2}|una|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce)\b/.test(text) || numericValues.size > 1 || /\b(?:entre|o)\b/.test(text) && (prefixed.length > 1 || clocks.length > 1 || /\b\d{1,2}\s+o\s+\d{1,2}\b/.test(text))) return { found:true, value:null, original, period:explicitPeriod, issue:'ambiguous_time' };
  if (!match) return { found:Boolean(explicitPeriod), value:null, original:periodMatch ? original.slice(periodMatch.index,periodMatch.index+periodMatch[0].length) : original, period:explicitPeriod, issue:explicitPeriod ? 'time_required' : 'unrecognized_time' };
  original = original.slice(match.index, Math.max(match.index+match[0].length, periodMatch ? periodMatch.index+periodMatch[0].length : 0, meridiemMatch ? meridiemMatch.index+meridiemMatch[0].length : 0)).trim();
  const hourToken = match[1], isClock = match === clocks[0];
  let hour = hourWords[hourToken] ?? +hourToken;
  let minute = isClock || prefixed[0] === match || bare === match ? +(match[2] || (match[3] === 'media' ? 30 : match[3] === 'cuarto' ? 15 : 0)) : match[2] === 'media' ? 30 : match[2] === 'cuarto' ? 15 : 0;
  if (!Number.isInteger(hour) || hour > 23 || minute > 59) return { found:true,value:null,original,period:explicitPeriod,issue:'invalid_time' };
  const period = explicitPeriod || (meridiem ? meridiem === 'pm' ? 'tarde' : 'manana' : previousPeriod);
  const clock24 = (clocks.length > 0 && /^\d{2}$/.test(hourToken)) || hour >= 13 || hourToken === '00' || hourToken === '0' || hourToken?.startsWith('0');
  if (meridiem) {
    if (hour < 1 || hour > 12) return {found:true,value:null,original,period,issue:'invalid_time'};
    hour = hour%12 + (meridiem === 'pm' ? 12 : 0);
  } else if (period && (!clock24 || explicitPeriod && hour <= 12)) {
    if (period === 'tarde') hour = hour === 12 ? 12 : hour+12;
    else if (period === 'noche') hour = hour === 12 ? 0 : hour >= 6 ? hour+12 : hour;
    else if (hour === 12) return {found:true,value:null,original,period,issue:'ambiguous_time'};
  } else if (!clock24) return {found:true,value:null,original,period:null,issue:'ambiguous_time'};
  if (hour > 23 || explicitPeriod === 'manana' && hour >= 12 || explicitPeriod === 'tarde' && hour < 12 || explicitPeriod === 'noche' && hour >= 6 && hour < 18) return {found:true,value:null,original,period,issue:'invalid_time'};
  const resolvedPeriod = explicitPeriod || (meridiem ? meridiem === 'pm' ? 'tarde' : 'manana' : !clock24 ? previousPeriod : null) || (hour < 12 ? 'manana' : hour < 19 ? 'tarde' : 'noche');
  return {found:true,value:pad(hour)+':'+pad(minute),original,period:resolvedPeriod,issue:null};
}
const messages = {
  invalid_date:'La fecha no existe en el calendario; indica otra fecha.',
  ambiguous_year:'Necesito confirmar el año de esa fecha.',
  ambiguous_weekday:'¿Te refieres a hoy o a ese día de la próxima semana?',
  ambiguous_date:'Hay más de una fecha posible; confirma cuál prefieres.',
  unrecognized_date:'Necesito una fecha más concreta para la preferencia de visita.',
  past_date:'Esa fecha ya pasó en Lima; indica una nueva fecha preferida.',
  ambiguous_time:'Confirma si esa hora es de la mañana, tarde o noche.',
  invalid_time:'Ese horario no es válido o no coincide con la franja indicada.',
  time_required:'Conservo la franja; falta indicar la hora aproximada.',
  unrecognized_time:'Necesito una hora más concreta para la preferencia de visita.',
  past_time:'Ese horario ya pasó en Lima; indica una nueva fecha u hora.',
  legacy_date:'Confirma la fecha anterior para poder normalizarla con su referencia correcta.',
};
function displayDate(iso) {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return null;
  const label = new Intl.DateTimeFormat('es-PE',{timeZone:'UTC',weekday:'long',day:'numeric',month:'long',year:'numeric'}).format(civil(iso));
  return label.charAt(0).toUpperCase()+label.slice(1);
}
function displayTime(time) {
  if (!time) return null;
  const [hour,minute] = time.split(':').map(Number);
  return (hour%12 || 12)+':'+pad(minute)+(hour >= 12 ? ' p. m.' : ' a. m.');
}
export function temporalReference(message, now) {
  const date = parseDatePreference(message,now), time = parseTimePreference(message);
  return date.found || time.found ? { date:date.found ? date.original : null, time:time.found ? time.original : null, expressedAt:limaClock(now).instant } : null;
}
export function normalizeSchedule(previous, args, {now = new Date(), message = '', references = []} = {}) {
  const clock = limaClock(now), reset = args.reset_fields || [];
  let date = previous.preferred_date || null, time = previous.preferred_time || null;
  const schedule = structuredClone(previous.schedule || {timeZone:TIME_ZONE});
  schedule.timeZone = TIME_ZONE;
  const temporalUpdate = args.preferred_date != null || args.preferred_time != null;
  const sourceDate = temporalUpdate ? parseDatePreference(message,now) : null;
  const sourceTime = temporalUpdate ? parseTimePreference(message,{period:schedule.period}) : null;
  const dateInput = sourceDate?.found ? sourceDate.original : args.preferred_date;
  let dateResult = sourceDate?.found ? sourceDate : null;
  if (reset.includes('preferred_date')) { date=null; delete schedule.date; }
  else if (dateInput != null) {
    const echo = !sourceDate?.found && schedule.date && [schedule.date.original,date].some(value => fold(value) === fold(dateInput));
    if (!echo) {
      if (!dateResult) {
        const reference = [...references].reverse().find(ref => fold(ref.date) === fold(dateInput));
        dateResult = parseDatePreference(dateInput,reference?.expressedAt || now);
      }
      schedule.date = dateResult; date = dateResult.value;
    }
  } else if (date && !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    schedule.date = {original:date,issue:'legacy_date',value:null}; date=null;
  }
  let timeInput = sourceTime?.found ? message : args.preferred_time;
  if (!timeInput && args.preferred_date != null) {
    const embedded = parseTimePreference(args.preferred_date,{period:schedule.period});
    if (embedded.found) timeInput=args.preferred_date;
  }
  if (reset.includes('preferred_time')) { time=null; delete schedule.time; delete schedule.period; }
  else if (timeInput != null) {
    const echo = !sourceTime?.found && schedule.time && [schedule.time.original,time].some(value => fold(value) === fold(timeInput));
    if (!echo) {
      const result = parseTimePreference(timeInput,{period:schedule.period});
      // Guardar únicamente el fragmento horario evita copiar datos personales del mensaje.
      const clean = result.original;
      schedule.time = {...result, original:clean, expressedAt:clock.instant};
      schedule.period = result.period; time = result.value;
    }
  } else if (time && !/^\d{2}:\d{2}$/.test(time)) {
    schedule.time = {original:time,issue:'unrecognized_time',value:null}; time=null;
  }
  const issues = {};
  if (schedule.date?.issue) issues.date=schedule.date.issue;
  if (schedule.time?.issue) issues.time=schedule.time.issue;
  if (date && date < clock.date) issues.date='past_date';
  if (date === clock.date && time && time <= clock.time) issues.time='past_time';
  schedule.issues=issues;
  schedule.feedback=Object.values(issues).map(code=>messages[code]);
  schedule.dateLabel=displayDate(date);
  schedule.timeLabel=displayTime(time);
  schedule.periodLabel={manana:'por la mañana',tarde:'por la tarde',noche:'por la noche',madrugada:'de madrugada'}[schedule.period] || null;
  return { preferred_date:date, preferred_time:time, schedule };
}
