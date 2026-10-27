// El cliente existente es el único responsable de sesión, mensajes, peticiones,
// fichas y galería. Esta capa solo facilita recorrer las fichas en /demo.
import '/app.js';

const messages = document.querySelector('#messages');
let resultId = 0;
const observers = new Map();
function decorateResults() {
  for (const [list, observer] of observers) if (!list.isConnected) { observer.disconnect(); observers.delete(list); }
  let added = false;
  for (const list of messages.querySelectorAll('.result-list:not([data-demo-ready])')) {
    list.dataset.demoReady = 'true';
    added = true;
    list.setAttribute('role', 'region');
    list.setAttribute('aria-label', 'Propiedades encontradas');
    list.tabIndex = 0;
    const cards = [...list.children];
    if (cards.length < 2) continue;
    list.id = `demo-results-${++resultId}`;
    const tools = document.createElement('div');
    tools.className = 'demo-result-tools';
    const note = document.createElement('span');
    note.textContent = `${cards.length} propiedades · Desliza para revisar`;
    const actions = document.createElement('div');
    const previous = document.createElement('button'), next = document.createElement('button');
    for (const [button, label, text] of [[previous, 'Propiedad anterior', '‹'], [next, 'Propiedad siguiente', '›']]) {
      button.type = 'button';
      button.textContent = text;
      button.setAttribute('aria-label', label);
      button.setAttribute('aria-controls', list.id);
      actions.append(button);
    }
    tools.append(note, actions);
    list.before(tools);
    const move = direction => {
      const width = cards[0].getBoundingClientRect().width;
      const gap = parseFloat(getComputedStyle(list).columnGap) || 0;
      list.scrollBy({ left: direction * (width + gap), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    };
    const update = () => {
      previous.disabled = list.scrollLeft <= 2;
      next.disabled = list.scrollLeft + list.clientWidth >= list.scrollWidth - 2;
    };
    previous.addEventListener('click', () => move(-1));
    next.addEventListener('click', () => move(1));
    list.addEventListener('keydown', event => {
      if (event.target === list && ['ArrowLeft', 'ArrowRight'].includes(event.key)) {
        event.preventDefault();
        move(event.key === 'ArrowLeft' ? -1 : 1);
      }
    });
    list.addEventListener('scroll', update, { passive: true });
    const observer = new ResizeObserver(update);
    observer.observe(list);
    observers.set(list, observer);
    update();
  }
  // El cliente ya siguió la respuesta; los controles agregan altura después.
  if (added) requestAnimationFrame(() => { messages.scrollTop = messages.scrollHeight; });
}
new MutationObserver(decorateResults).observe(messages, { childList: true });
decorateResults();
