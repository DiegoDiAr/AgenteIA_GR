const $ = selector => document.querySelector(selector);
const messages = $('#messages'), input = $('#message'), errorBox = $('#error'), dialog = $('#gallery');
let busy = false, transcript = [], galleryProperty = null, photoIndex = 0;
const storageKey = 'rentabilizarme-chat-v1';
function el(tag, className, content) { const node = document.createElement(tag); if (className) node.className = className; if (content != null) node.textContent = content; return node; }
const galleryImage = el('img'); galleryImage.id = 'gallery-image'; galleryImage.alt = ''; $('#gallery-image-slot').append(galleryImage);
function scrollEnd() { messages.scrollTop = messages.scrollHeight; }
function persist() { try { sessionStorage.setItem(storageKey, JSON.stringify(transcript)); } catch { /* Una galería muy grande puede superar la cuota; la sesión del backend sigue viva. */ } }
function showError(message) { errorBox.textContent = message; errorBox.hidden = false; }
function money(price) { return `${price.currency || ''} ${new Intl.NumberFormat('es-PE', { maximumFractionDigits: 2 }).format(price.amount)}`.trim(); }
function renderProperty(p, count) {
  const card = el('article', `property${count === 1 ? ' single' : ''}`);
  const media = el('div', 'property-media');
  if (p.photos.length) {
    const image = el('img'); image.src = p.photos[0].url; image.alt = p.photos[0].caption; image.loading = 'lazy'; image.referrerPolicy = 'no-referrer';
    image.addEventListener('error', () => { image.hidden = true; const note = el('p', 'no-photo', 'La fotografía no pudo cargarse. Abre la galería para ver las demás.'); media.prepend(note); }, { once: true });
    image.addEventListener('click', () => openGallery(p)); media.append(image);
    const button = el('button', 'photo-count', `Ver ${p.photos.length} ${p.photos.length === 1 ? 'foto' : 'fotos'}`); button.type = 'button'; button.addEventListener('click', () => openGallery(p)); media.append(button);
  } else media.append(el('p', 'no-photo', 'Sin fotografías publicadas'));
  card.append(media);
  const meta = el('div', 'property-meta'); meta.append(el('span', '', p.resultIndex ? `Opción ${p.resultIndex} · ${p.type || 'Propiedad'}` : p.type || 'Propiedad'), el('span', '', p.reference)); card.append(meta, el('h3', '', p.title));
  card.append(el('p', 'property-location', [p.address, p.location].filter(Boolean).join(' · ') || 'Ubicación no publicada'));
  const prices = el('div', 'property-price'); let hasPrice = false;
  for (const operation of p.operations) {
    for (const price of operation.prices) { hasPrice = true; const row = el('div', '', money(price)); row.append(el('small', '', [operation.name, price.period ? `Período publicado: ${price.period}` : ''].filter(Boolean).join(' · '))); prices.append(row); }
    if (!operation.prices.length) { const row = el('div', '', 'Precio a consultar'); row.append(el('small', '', operation.name)); prices.append(row); }
  }
  if (!hasPrice && !p.operations.length) prices.append(el('div', '', 'Precio a consultar'));
  card.append(prices);
  const facts = el('div', 'property-facts');
  for (const [value, label] of [[p.bedrooms, 'dorm.'], [p.bathrooms, 'baños'], [p.parking, 'cocheras'], [p.rooms, 'amb.']]) if (value !== null && value > 0) facts.append(el('span', '', `${value} ${label}`));
  if (p.area > 0) facts.append(el('span', '', `${p.area} ${p.areaUnit || '(unidad no publicada)'} totales`));
  if (p.coveredArea > 0) facts.append(el('span', '', `${p.coveredArea} ${p.areaUnit || '(unidad no publicada)'} cubiertos`));
  if (p.landArea > 0) facts.append(el('span', '', `${p.landArea} ${p.areaUnit || '(unidad no publicada)'} de terreno`));
  card.append(facts);
  if (p.description || p.features.length) { const details = el('details'); details.append(el('summary', '', 'Descripción y características')); if (p.description) details.append(el('p', '', p.description)); if (p.features.length) details.append(el('p', 'feature-list', p.features.join(' · '))); card.append(details); }
  if (p.publicUrl) { const link = el('a', '', 'Ver ficha pública ↗'); link.href = p.publicUrl; link.target = '_blank'; link.rel = 'noopener noreferrer'; card.append(link); }
  return card;
}
function renderMessage(item) {
  const node = el('article', `message ${item.role}`); node.append(el('span', 'message-label', item.role === 'user' ? 'TÚ' : 'ASISTENTE'), el('p', 'message-text', item.text));
  if (item.properties?.length) { const list = el('div', 'result-list'); item.properties.forEach(p => list.append(renderProperty(p, item.properties.length))); node.append(list); }
  for (const search of item.searches || []) {
    if (search.nextOffset !== null) node.append(el('p', 'result-note', search.partialFeatureScan ? 'Se han revisado parte de las opciones para comprobar tus características. Puedes pedirme que siga buscando.' : 'Hay más opciones. Puedes pedirme que muestre los siguientes resultados.'));
    else if (search.count === 0) node.append(el('p', 'result-note', search.filters?.features?.length ? 'No se encontraron coincidencias con esas etiquetas publicadas. Puedes ajustar las características; la ausencia de una etiqueta no confirma que el inmueble carezca de ella.' : 'Tokko no devolvió coincidencias para estos filtros. Puedes ajustar la zona o el presupuesto.'));
  }
  messages.append(node); return node;
}
function setBusy(value) { busy = value; $('#send').disabled = value; $('#new-chat').disabled = value; input.disabled = value; $('#chat-form').setAttribute('aria-busy', String(value)); }
async function send(message) {
  if (busy || !message.trim()) return;
  message = message.trim(); errorBox.hidden = true; setBusy(true);
  const item = { role: 'user', text: message }; const userNode = renderMessage(item);
  const pending = el('div', 'pending', 'Preparando tu respuesta…'); pending.setAttribute('role', 'status'); messages.append(pending); input.value = ''; input.style.height = 'auto'; scrollEnd();
  try {
    const response = await fetch('/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
    const data = await response.json();
    if (!response.ok) { const error = new Error(data.message || 'No se pudo enviar el mensaje.'); error.code = data.error; throw error; }
    transcript.push(item);
    const answer = { role: 'assistant', text: data.message, properties: data.properties || [], searches: data.searches || [] }; transcript.push(answer); renderMessage(answer); persist();
  } catch (error) {
    userNode.remove(); input.value = message; showError(error.message || 'No hay conexión con el servidor. Intenta nuevamente.');
    if (['session_expired', 'conversation_limit'].includes(error.code)) { const reset = el('button', '', 'Iniciar nueva conversación'); reset.type = 'button'; reset.addEventListener('click', resetChat); errorBox.append(reset); }
  } finally { pending.remove(); setBusy(false); input.focus(); scrollEnd(); }
}
async function resetChat() {
  if (busy) return;
  try {
    const response = await fetch('/api/session/reset', { method: 'POST' });
    if (!response.ok) throw new Error('No se pudo iniciar una conversación. Intenta nuevamente.');
    transcript = []; persist(); messages.querySelectorAll('.message').forEach(node => node.remove()); errorBox.hidden = true; input.value = ''; input.focus(); messages.scrollTop = 0;
  } catch (error) { showError(error.message); }
}
function openGallery(property) {
  galleryProperty = property; photoIndex = 0; $('#gallery-title').textContent = property.title; const thumbs = $('#gallery-thumbs'); thumbs.replaceChildren();
  property.photos.forEach((photo, index) => { const button = el('button'); button.type = 'button'; button.setAttribute('aria-label', `Ver fotografía ${index + 1}`); const img = el('img'); img.src = photo.thumbnail || photo.url; img.alt = ''; img.loading = 'lazy'; img.referrerPolicy = 'no-referrer'; button.append(img); button.addEventListener('click', () => { photoIndex = index; showPhoto(); }); thumbs.append(button); });
  showPhoto(); dialog.showModal();
}
function showPhoto() {
  const photos = galleryProperty.photos, photo = photos[photoIndex];
  const image = $('#gallery-image'); $('#gallery-image-error').hidden = true; image.hidden = false; image.src = photo.url; image.alt = photo.caption; image.referrerPolicy = 'no-referrer';
  $('#gallery-count').textContent = `${photoIndex + 1} de ${photos.length} fotografías publicadas`; $('#gallery-caption').textContent = photo.caption;
  $('#gallery-prev').disabled = photos.length < 2; $('#gallery-next').disabled = photos.length < 2;
  [...$('#gallery-thumbs').children].forEach((button, index) => button.setAttribute('aria-current', String(index === photoIndex)));
  $('#gallery-thumbs').children[photoIndex]?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
}
function changePhoto(delta) { photoIndex = (photoIndex + delta + galleryProperty.photos.length) % galleryProperty.photos.length; showPhoto(); }
$('#gallery-image').addEventListener('error', () => { $('#gallery-image').hidden = true; $('#gallery-image-error').hidden = false; });
$('#gallery-close').addEventListener('click', () => dialog.close());
$('#gallery-prev').addEventListener('click', () => changePhoto(-1)); $('#gallery-next').addEventListener('click', () => changePhoto(1));
dialog.addEventListener('keydown', event => { if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changePhoto(event.key === 'ArrowLeft' ? -1 : 1); } });
dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
$('#chat-form').addEventListener('submit', event => { event.preventDefault(); send(input.value); });
input.addEventListener('keydown', event => { if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); send(input.value); } });
input.addEventListener('input', () => { input.style.height = 'auto'; input.style.height = `${Math.min(input.scrollHeight, 135)}px`; });
$('#new-chat').addEventListener('click', resetChat);
document.querySelectorAll('[data-prompt]').forEach(button => button.addEventListener('click', () => { if (!busy) { input.value = button.dataset.prompt; input.focus(); } }));
try { const saved = JSON.parse(sessionStorage.getItem(storageKey) || '[]'); if (Array.isArray(saved)) { transcript = saved; transcript.forEach(renderMessage); scrollEnd(); } } catch { sessionStorage.removeItem(storageKey); }
async function health() {
  try { const response = await fetch('/api/health'); if (!response.ok) throw new Error(); const data = await response.json(); const ready = data.openaiConfigured && data.tokkoConfigured;
    $('#connection-status').textContent = ready ? 'Asistente configurado' : 'Configuración pendiente'; $('#connection-status').classList.toggle('ready', ready);
    if (!ready) { $('#config-notice').hidden = false; $('#config-notice').textContent = data.openaiConfigured ? 'La conversación está disponible. Falta conectar el catálogo de Tokko para consultar propiedades.' : 'El asistente aún no está conectado. Configura las credenciales privadas del servidor para conversar y consultar propiedades reales.'; }
  } catch { $('#connection-status').textContent = 'Sin conexión'; $('#config-notice').hidden = false; $('#config-notice').textContent = 'No se pudo conectar con el servidor. Recarga la página para volver a intentar.'; }
}
health();
