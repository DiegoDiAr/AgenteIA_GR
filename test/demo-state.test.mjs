import test from 'node:test';
import assert from 'node:assert/strict';
import { nearBottom, createFollowState, carouselPosition, swipeStep } from '../public/demo-state.js';
const metrics = (scrollTop, scrollHeight = 1800, clientHeight = 600) => ({ scrollTop, scrollHeight, clientHeight });

test('scroll de demo: sigue al recibir mientras el lector está al final', () => {
  const state = createFollowState();
  state.scroll(metrics(1200)); state.incoming();
  assert.equal(state.request(), true); assert.equal(state.unread, false);
});
test('scroll de demo: una respuesta tardía respeta al lector que subió en el historial', () => {
  const state = createFollowState(1200);
  state.scroll(metrics(900)); state.incoming();
  assert.equal(state.request(), false); assert.equal(state.request(), false); assert.equal(state.unread, true);
});
test('scroll de demo: novedades y envío propio recuperan el seguimiento', () => {
  const state = createFollowState(1200);
  state.scroll(metrics(700)); state.incoming();
  assert.equal(state.request(true), true); assert.equal(state.unread, false);
});
test('scroll de demo: volver al final y reiniciar limpian las novedades', () => {
  const state = createFollowState(1200);
  state.scroll(metrics(500)); state.incoming(); state.scroll(metrics(1200));
  assert.equal(state.unread, false); assert.equal(state.following, true);
  state.scroll(metrics(100)); state.incoming(); state.reset();
  assert.equal(state.unread, false); assert.equal(state.request(), true);
});
test('scroll de demo: tolerancia al final y conversaciones cortas', () => {
  assert.equal(nearBottom(metrics(1136)), true);
  assert.equal(nearBottom(metrics(1135)), false);
  assert.equal(nearBottom(metrics(0, 300)), true);
});
test('carrusel: límites y opción actual con tres fichas en móvil', () => {
  assert.deepEqual(carouselPosition({ scrollLeft: 0, clientWidth: 360, scrollWidth: 1017 }, 327, 13, 3), { previousDisabled: true, nextDisabled: false, index: 0 });
  assert.deepEqual(carouselPosition({ scrollLeft: 340, clientWidth: 360, scrollWidth: 1017 }, 327, 13, 3), { previousDisabled: false, nextDisabled: false, index: 1 });
  const end = carouselPosition({ scrollLeft: 657, clientWidth: 360, scrollWidth: 1017 }, 327, 13, 3);
  assert.equal(end.nextDisabled, true); assert.equal(end.index, 2);
});
test('carrusel: desactiva navegación innecesaria si las fichas caben completas', () => {
  const state = carouselPosition({ scrollLeft: 0, clientWidth: 1100, scrollWidth: 1100 }, 320, 16, 3);
  assert.equal(state.previousDisabled, true); assert.equal(state.nextDisabled, true);
});
test('galería táctil: distingue avance y retroceso de gestos verticales y pulsaciones', () => {
  const start = { x: 150, y: 100 };
  assert.equal(swipeStep(start, { x: 80, y: 105 }), 1);
  assert.equal(swipeStep(start, { x: 220, y: 95 }), -1);
  assert.equal(swipeStep(start, { x: 110, y: 105 }), 0);
  assert.equal(swipeStep(start, { x: 80, y: 200 }), 0);
  assert.equal(swipeStep(start, start), 0);
});
