export function renderDemoRequest(request, doc, onEdit) {
  const el = (tag, text, className = '') => { const node = doc.createElement(tag); node.className = className; if (text != null) node.textContent = text; return node; };
  const node = el('section', null, 'demo-request');
  node.setAttribute('aria-label', request.kind === 'visit' ? 'Solicitud de visita simulada' : 'Solicitud de asesor simulada');
  node.append(el('h3', request.kind === 'visit' ? 'Solicitud de visita' : 'Contacto con un asesor'));
  node.append(el('p', request.statusLabel, 'demo-request-status'));
  node.append(el('p', 'No enviada. Sin reserva ni disponibilidad confirmada.', 'demo-request-note'));
  const fields = [['propertyLabel', 'Propiedad'], ['name', 'Nombre'], ['contact', 'Contacto'], ['preferred_date', 'Fecha preferida'], ['preferred_time', 'Hora aproximada'], ['comment', 'Comentario']];
  const details = el('dl');
  for (const [key, label] of fields) {
    const value = key === 'preferred_date' ? request.schedule?.dateLabel || request[key] : key === 'preferred_time' ? request.schedule?.timeLabel || request[key] || request.schedule?.periodLabel : request[key];
    if (value) details.append(el('dt', label), el('dd', value));
  }
  node.append(details);
  for (const feedback of request.schedule?.feedback || []) node.append(el('p', feedback, 'demo-request-note'));
  if (request.schedule?.date?.original || request.schedule?.time?.original) node.append(el('p', 'Preferencia recibida: ' + [request.schedule?.date?.original, request.schedule?.time?.original].filter(Boolean).join(' · '), 'demo-request-note'));
  if (request.missingFields?.length) {
    const labels = { property_id: 'propiedad', name: 'nombre', contact: 'contacto', preferred_date: 'fecha preferida', preferred_time: 'hora aproximada' };
    node.append(el('p', 'Por completar: ' + request.missingFields.map(key => labels[key]).join(', '), 'demo-request-note'));
  }
  const button = el('button', 'Corregir solicitud'); button.type = 'button'; button.addEventListener('click', () => onEdit(request.kind)); node.append(button);
  return node;
}
