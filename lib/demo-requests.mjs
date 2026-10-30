import { AppError } from './errors.mjs';
import { normalizeSchedule } from './visit-schedule.mjs';

const fields = ['property_id', 'name', 'contact', 'preferred_date', 'preferred_time', 'comment'];
export const DEMO_REQUEST_TOOL = {
  type: 'function', name: 'prepare_demo_request', strict: true,
  description: 'Crear, completar, revisar o corregir un borrador SIMULADO de visita o contacto con asesor, solo en la demo. Envía los datos proporcionados por el cliente; null conserva lo conocido y reset_fields permite borrarlo. Puede ejecutarse con datos incompletos para guardarlos progresivamente. No agenda, no envía ni confirma disponibilidad. Reutiliza nombre y contacto ya conocidos. Para revisar envía kind y el resto null/[]; no hace falta repetir fichas.',
  parameters: { type: 'object', properties: {
    kind: { type: 'string', enum: ['visit', 'advisor'] },
    property_id: { type: ['integer', 'null'], description: 'ID canónico de una propiedad conocida, nunca el ID de una web sin resolver. Opcional en contacto con asesor.' },
    ...Object.fromEntries(fields.filter(field => field !== 'property_id').map(field => [field, { type: ['string', 'null'], ...(field === 'preferred_date' ? { description: 'Expresión de fecha original del cliente, sin calcularla: mañana, pasado mañana, el lunes o una fecha explícita. El backend resuelve el calendario de Lima. null conserva la fecha guardada.' } : field === 'preferred_time' ? { description: 'Expresión horaria original del cliente: 3 de la tarde, 15:00 o por la mañana. No inventes AM/PM ni una hora para una franja. null conserva la preferencia guardada.' } : {}) }])),
    reset_fields: { type: 'array', items: { type: 'string', enum: fields } },
  }, required: ['kind', ...fields, 'reset_fields'], additionalProperties: false },
};
export const DEMO_INSTRUCTIONS = `
Modo demostración de atención comercial:
Puedes preparar solicitudes simuladas con prepare_demo_request cuando el cliente pida visitar una propiedad o hablar con un asesor. Esta herramienta solo guarda estado temporal de esta sesión. No envía mensajes, no reserva citas ni consulta agendas; no afirmes recepción por un asesor, disponibilidad de fecha ni visita confirmada. El estado preparado significa únicamente «Solicitud preparada — simulación, pendiente de confirmación».
Recoge progresivamente lo que falte en demoState y el historial, con preguntas breves; no preguntes todos los campos de golpe ni datos ya conocidos. Para visita se necesitan propiedad identificada, nombre, contacto, fecha preferida y hora aproximada; comentario opcional. Para asesor bastan nombre y contacto, asociando la propiedad de interés cuando la referencia sea clara; no elijas arbitrariamente entre varias. Una preferencia de fecha u hora no es disponibilidad confirmada. No inventes datos para completar.
Guarda con la herramienta los datos nuevos o correcciones, incluso antes de tener todo; puede revisar y cambiar propiedad, fecha, hora o contacto. null mantiene lo anterior; reset_fields borra una preferencia indicada por el cliente. Si la referencia de propiedad es ambigua, aclárala. Reutiliza demoState.profile cuando corresponda. Las tarjetas demoRequests muestran el resumen editable mediante conversación y el estado de simulación. No vuelvas a mostrar fichas inmobiliarias solo por preparar o revisar una solicitud.
Fechas y horas: demoClock indica la referencia local de Lima. Envía las expresiones originales del cliente, sin calcular el calendario ni convertir horas ambiguas por tu cuenta. El backend devuelve preferred_date ISO, preferred_time de 24 horas y schedule con originales, referencia y aclaraciones. Conserva lo ya normalizado: en revisiones o datos ajenos al horario envía null para fecha/hora. Si el cliente cambia una preferencia, envía la nueva expresión; una franja como por la mañana reemplaza la hora anterior y requiere aclarar la hora aproximada. Usa schedule.feedback para aclarar fechas ambiguas, inválidas o pasadas, sin afirmar disponibilidad ni completar una solicitud con horario pendiente.
`;
export function prepareDemoRequest(state, args, known, options = {}) {
  if (!['visit', 'advisor'].includes(args.kind)) throw new AppError('Tipo de solicitud no válido.', 400, 'invalid_demo_request');
  if (!Array.isArray(args.reset_fields) || args.reset_fields.some(field => !fields.includes(field))) throw new AppError('Campos de solicitud no válidos.', 400, 'invalid_demo_request');
  const next = structuredClone(state || { profile: {}, requests: {} });
  const current = next.requests[args.kind] || { kind: args.kind, property_id: args.kind === 'advisor' ? next.requests.visit?.property_id ?? null : null, name: next.profile.name || null, contact: next.profile.contact || null, preferred_date: null, preferred_time: null, comment: null };
  const request = { ...current };
  for (const field of fields) {
    const value = args[field];
    if (args.reset_fields.includes(field)) request[field] = null;
    else if (value != null) {
      if (field === 'property_id') {
        if (!Number.isSafeInteger(value) || !known.has(value)) throw new AppError('Primero identifica la propiedad entre los inmuebles consultados.', 400, 'unknown_property');
        request[field] = value;
      } else {
        if (typeof value !== 'string' || !value.trim() || value.length > 4000) throw new AppError('Revisa los datos de la solicitud.', 400, 'invalid_demo_request');
        request[field] = value.trim();
      }
    }
  }
  Object.assign(request, normalizeSchedule(current, args, options));
  setRequestStatus(request);
  request.simulation = true; request.notified = false; request.confirmed = false;
  const property = known.get(request.property_id);
  request.propertyLabel = property ? [property.reference || property.id, property.title].filter(Boolean).join(' · ') : null;
  next.requests[args.kind] = request;
  for (const field of ['name', 'contact']) {
    if (args.reset_fields.includes(field)) delete next.profile[field];
    else if (request[field]) next.profile[field] = request[field];
  }
  return { state: next, request };
}

function setRequestStatus(request) {
  const required = request.kind === 'visit' ? ['property_id', 'name', 'contact', 'preferred_date', 'preferred_time'] : ['name', 'contact'];
  const missing = required.filter(field => !request[field]);
  if (request.schedule?.issues?.date && !missing.includes('preferred_date')) missing.push('preferred_date');
  if (request.schedule?.issues?.time && !missing.includes('preferred_time')) missing.push('preferred_time');
  request.missingFields = missing;
  request.status = missing.length ? 'draft' : 'prepared';
  request.statusLabel = missing.length ? 'Borrador — simulación' : 'Solicitud preparada — simulación, pendiente de confirmación';
}
export function refreshDemoState(state, now) {
  const next = structuredClone(state || { profile: {}, requests: {} });
  for (const request of Object.values(next.requests)) {
    Object.assign(request, normalizeSchedule(request, { reset_fields: [] }, { now }));
    setRequestStatus(request);
  }
  return next;
}
