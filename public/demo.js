// Una capa de presentación sobre el mismo cliente, endpoint, sesión y galería.
import '/app.js';
import { createFollowState, carouselPosition, swipeStep } from './demo-state.js';

const $ = selector => document.querySelector(selector);
const messages = $('#messages'), dialog = $('#gallery'), jump = $('#demo-jump');
const follow = createFollowState(messages.scrollTop);
const observers = new Map();
let resultId = 0;
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
function updateJump() { jump.hidden = !follow.unread; }
function followEnd(force = false) {
  if (follow.request(force)) requestAnimationFrame(() => {
    // Sin animaciones de scroll encadenadas que puedan vencer un gesto del lector.
    if (follow.following) messages.scrollTo({ top: messages.scrollHeight, behavior: 'instant' });
  });
  updateJump();
}
messages.addEventListener('chat:scroll-request', event => { event.preventDefault(); followEnd(); });
messages.addEventListener('chat:user-sent', () => followEnd(true));
messages.addEventListener('chat:reset', () => { follow.reset(); updateJump(); });
messages.addEventListener('scroll', () => { follow.scroll(messages); updateJump(); }, { passive: true });
jump.addEventListener('click', () => { followEnd(true); $('#message').focus({ preventScroll: true }); });

function decorateCard(card) {
  if (card.dataset.demoCard) return;
  card.dataset.demoCard = 'true';
  const title = card.querySelector('h3')?.textContent || 'Propiedad';
  const media = card.querySelector('.property-media');
  const image = media.querySelector('img'), photos = media.querySelector('.photo-count');
  const body = document.createElement('div');
  body.className = 'demo-property-body';
  for (const child of [...card.children]) if (child !== media) body.append(child);
  const actions = document.createElement('div');
  actions.className = 'demo-property-actions';
  if (photos) {
    const badge = document.createElement('span');
    badge.className = 'demo-photo-badge'; badge.textContent = photos.textContent.replace(/^Ver /, '');
    media.append(badge);
    actions.append(photos);
  }
  const link = body.querySelector('a');
  if (link) { link.classList.add('demo-public-link'); actions.append(link); }
  body.append(actions); card.append(body);
  for (const fact of body.querySelectorAll('.property-facts>span')) {
    const value = fact.textContent;
    const kind = value.includes('dorm.') ? 'bed' : value.includes('baños') ? 'bath' : value.includes('cocheras') ? 'car' : /totales|cubiertos|terreno/.test(value) ? 'area' : 'rooms';
    fact.dataset.icon = kind;
  }
  if (image) {
    image.tabIndex = 0; image.setAttribute('role', 'button');
    image.setAttribute('aria-label', 'Ver fotografías de ' + title);
    image.addEventListener('keydown', event => {
      if (['Enter', ' '].includes(event.key)) { event.preventDefault(); image.click(); }
    });
  }
}
function decorateResults() {
  for (const [list, observer] of observers) if (!list.isConnected) { observer.disconnect(); observers.delete(list); }
  let added = false;
  for (const list of messages.querySelectorAll('.result-list:not([data-demo-ready])')) {
    list.dataset.demoReady = 'true'; added = true;
    list.setAttribute('role', 'region'); list.setAttribute('aria-label', 'Propiedades encontradas');
    list.tabIndex = 0;
    const cards = [...list.children]; cards.forEach(decorateCard);
    if (cards.length < 2) continue;
    list.id = `demo-results-${++resultId}`;
    const tools = document.createElement('div'); tools.className = 'demo-result-tools';
    const note = document.createElement('span'); note.className = 'demo-result-count'; note.setAttribute('aria-live', 'polite');
    const actions = document.createElement('div');
    const previous = document.createElement('button'), next = document.createElement('button');
    for (const [button, label, text] of [[previous, 'Propiedad anterior', '‹'], [next, 'Propiedad siguiente', '›']]) {
      button.type = 'button'; button.textContent = text;
      button.setAttribute('aria-label', label); button.setAttribute('aria-controls', list.id); actions.append(button);
    }
    tools.append(note, actions); list.before(tools);
    const metrics = () => ({ width: cards[0].getBoundingClientRect().width, gap: parseFloat(getComputedStyle(list).columnGap) || 0 });
    const move = direction => {
      const { width, gap } = metrics();
      list.scrollBy({ left: direction * (width + gap), behavior: reduced() ? 'instant' : 'smooth' });
    };
    const update = () => {
      const { width, gap } = metrics(), state = carouselPosition(list, width, gap, cards.length);
      previous.disabled = state.previousDisabled; next.disabled = state.nextDisabled;
      const scrollable = !state.previousDisabled || !state.nextDisabled; actions.hidden = !scrollable;
      note.textContent = !scrollable ? `${cards.length} propiedades` : list.clientWidth >= (width + gap) * 1.75 ? `${cards.length} propiedades · Desliza para explorar` : `Opción ${state.index + 1} de ${cards.length} · Desliza para explorar`;
    };
    previous.addEventListener('click', () => move(-1)); next.addEventListener('click', () => move(1));
    list.addEventListener('keydown', event => {
      if (event.target !== list) return;
      if (['ArrowLeft', 'ArrowRight'].includes(event.key)) { event.preventDefault(); move(event.key === 'ArrowLeft' ? -1 : 1); }
      if (['Home', 'End'].includes(event.key)) {
        event.preventDefault(); list.scrollTo({ left: event.key === 'Home' ? 0 : list.scrollWidth, behavior: reduced() ? 'instant' : 'smooth' });
      }
    });
    list.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update); observer.observe(list); observers.set(list, observer); update();
  }
  if (added) followEnd();
}
new MutationObserver(records => {
  for (const record of records) for (const node of record.addedNodes) if (node.nodeType === 1 && node.matches('.message.assistant')) follow.incoming();
  decorateResults(); updateJump();
}).observe(messages, { childList: true });
decorateResults();

const stage = $('.gallery-stage'), zoom = $('#demo-zoom'), gestureNote = $('#demo-gallery-hint');
let touch = null;
function resetZoom() {
  dialog.classList.remove('is-zoomed'); zoom.setAttribute('aria-pressed', 'false'); zoom.textContent = 'Ampliar imagen';
  stage.scrollTop = 0; stage.scrollLeft = 0;
  gestureNote.textContent = 'Desliza o usa las flechas para ver todas las fotografías.';
}
zoom.addEventListener('click', () => {
  const active = dialog.classList.toggle('is-zoomed');
  zoom.setAttribute('aria-pressed', String(active)); zoom.textContent = active ? 'Ajustar imagen' : 'Ampliar imagen';
  gestureNote.textContent = active ? 'Desplázate por la imagen ampliada. Ajusta la imagen para volver a navegar.' : 'Desliza o usa las flechas para ver todas las fotografías.';
});
dialog.addEventListener('close', resetZoom);
new MutationObserver(resetZoom).observe($('#gallery-count'), { childList: true });
stage.addEventListener('pointerdown', event => {
  if (event.pointerType === 'mouse' || dialog.classList.contains('is-zoomed') || event.target.closest('button')) return;
  touch = { x: event.clientX, y: event.clientY, id: event.pointerId };
  stage.setPointerCapture(event.pointerId);
});
stage.addEventListener('pointerup', event => {
  if (!touch || touch.id !== event.pointerId) return;
  const step = swipeStep(touch, { x: event.clientX, y: event.clientY }); touch = null;
  if (step) $(step > 0 ? '#gallery-next' : '#gallery-prev').click();
});
stage.addEventListener('pointercancel', () => { touch = null; });

function viewportHeight() {
  document.body.style.setProperty('--demo-height', `${visualViewport?.height || innerHeight}px`);
  followEnd();
}
window.visualViewport?.addEventListener('resize', viewportHeight);
window.addEventListener('resize', viewportHeight);
new ResizeObserver(entries => {
  $('.chat-panel').style.setProperty('--composer-height', `${entries[0].contentRect.height + 28}px`);
}).observe($('.composer-wrap'));
viewportHeight();
