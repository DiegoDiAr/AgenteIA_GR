// SOLO PRUEBAS: conversaciones, decisiones del modelo y catálogo sintéticos.
// Validan historial, aislamiento, herramientas y filtros; no decisiones espontáneas de OpenAI.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { createApp } from '../server.mjs';
import { createTokko, normalizeProperty } from '../lib/tokko.mjs';

const json = value => new Response(JSON.stringify(value));
const text = value => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] }] });
let callId = 0;
const tool = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: 'synthetic-context-' + ++callId, arguments: JSON.stringify(args) }] });
const args = changes => Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) =>
  [key, key in changes ? changes[key] : schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
const places = [{ id: 801, name: 'Miraflores', full_location: 'Peru | Lima | Lima | Miraflores' }, { id: 802, name: 'Lince', full_location: 'Peru | Lima | Lima | Lince' }];
const fixture = (id, { type = 2, operation = 2, location = places[0], price = 2700, photos = 11 } = {}) => ({
  id, publication_title: 'SOLO PRUEBA · Ficha sintética ' + id, type: { id: type, name: 'Tipo sintético ' + type },
  location, fake_address: 'Dirección sintética', description: 'SOLO PRUEBA · Descripción publicada.',
  operations: [{ operation_id: operation, operation_type: operation === 2 ? 'Alquiler' : 'Venta', prices: [{ currency: 'PEN', price }] }],
  photos: Array.from({ length: photos }, (_, index) => ({ original: 'https://photos.example.test/' + id + '/' + index + '.jpg' })),
});
function harness(sequence, catalog = [], diagnostics = false) {
  const bodies = [], upstream = [];
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'api.openai.com') {
      assert.equal(url.pathname, '/v1/responses');
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'gpt-6-luna'); assert.deepEqual(body.reasoning, { effort: 'none' });
      assert.equal(body.tool_choice, 'auto'); assert.deepEqual(body.tools, TOOLS);
      bodies.push(body); assert.ok(sequence.length, 'No se permiten llamadas adicionales');
      return json(sequence.shift());
    }
    assert.equal(url.hostname, 'www.tokkobroker.com', 'No hay solicitudes a servicios ajenos al proveedor simulado');
    upstream.push(url);
    if (url.pathname.includes('/location/quicksearch/')) return json({ objects: places });
    if (url.pathname.includes('/property/search/')) {
      const data = JSON.parse(url.searchParams.get('data'));
      assert.equal(data.only_available, 'checked');
      const found = catalog.filter(p => data.current_localization_id.includes(p.location.id) &&
        (!data.property_types.length || data.property_types.includes(p.type.id)) &&
        p.operations.some(op => data.operation_types.includes(op.operation_id) &&
          op.prices.some(price => (data.currency === 'ANY' || data.currency === price.currency) &&
            price.price >= data.price_from && price.price <= data.price_to)));
      return json({ objects: found, meta: { total_count: found.length, next: null } });
    }
    const match = url.pathname.match(/^\/api\/v1\/property\/(\d+)\/$/);
    const detail = match && catalog.find(p => p.id === Number(match[1]));
    assert.ok(detail, 'Solo se recuperan IDs del catálogo sintético');
    return json(detail);
  };
  return {
    fetchImpl, bodies, upstream,
    chat: createChat({ apiKey: 'synthetic-key', model: 'gpt-6-luna', diagnostics, fetchImpl, tokko: createTokko({ apiKey: 'synthetic-key', fetchImpl }) }),
    searches: () => upstream.filter(url => url.pathname.includes('/property/search/')).map(url => JSON.parse(url.searchParams.get('data'))),
    done: () => assert.equal(sequence.length, 0),
  };
}
function emptyContext(body) {
  const c = context(body);
  assert.equal(c.searchCriteria, null); assert.equal(c.lastSearch, null);
  assert.equal(c.lastSearchAttempt, null); assert.equal(c.lastViewedPropertyId, null);
  for (const key of ['lastResultIds', 'knownProperties', 'propertyDetails', 'responseCards']) assert.deepEqual(c[key], []);
}

test('confirmaciones: diálogo social completo conserva historial exacto sin consultas ni fichas', async t => {
  const entries = [];
  t.mock.method(console, 'info', line => entries.push(JSON.parse(line)));
  const messages = ['Hola', 'Bien bien', 'Hoy solo quería conversar un rato.'];
  const responses = ['SOLO PRUEBA · Saludo.', 'SOLO PRUEBA · Reacción social.', 'SOLO PRUEBA · Conversación cotidiana.'];
  const h = harness(responses.map(text), [], true), s = state();
  for (let index = 0; index < messages.length; index++) {
    const prior = structuredClone(s.history);
    const result = await h.chat(s, messages[index]);
    assert.deepEqual(h.bodies[index].input, [...prior, { role: 'user', content: messages[index] }]);
    emptyContext(h.bodies[index]);
    assert.deepEqual(result.properties, []); assert.deepEqual(result.searches, []);
  }
  assert.equal(s.turns, messages.length); assert.equal(h.upstream.length, 0);
  assert.equal(entries.length, messages.length);
  assert.ok(entries.every(e => e.event === 'agent_model_result' && e.status === 'no_tool_calls' && e.tools.length === 0));
  h.done();
});

test('confirmaciones: sí, ok, dale y claro después de un intercambio social no requieren búsquedas', async () => {
  for (const confirmation of ['Sí', 'ok', 'dale', 'claro']) {
    const s = state(), h = harness([
      text('SOLO PRUEBA · Saludo social.'), text('SOLO PRUEBA · Reacción social.'),
      text('SOLO PRUEBA · Continuación del diálogo.'),
    ]);
    await h.chat(s, 'Hola'); await h.chat(s, 'Bien bien');
    const previous = structuredClone(s.history);
    const result = await h.chat(s, confirmation);
    assert.deepEqual(h.bodies[2].input, [...previous, { role: 'user', content: confirmation }]);
    emptyContext(h.bodies[2]);
    assert.equal(h.upstream.length, 0); assert.deepEqual(result.properties, []);
    assert.deepEqual(result.searches, []); assert.equal(s.properties.size, 0);
    h.done();
  }
});

test('confirmaciones: aceptar una propuesta explícita conserva sus criterios y ejecuta la búsqueda simulada', async t => {
  const entries = [];
  t.mock.method(console, 'info', line => entries.push(JSON.parse(line)));
  const p = fixture(99601), s = state();
  const proposal = 'SOLO PRUEBA · ¿Buscamos departamentos en alquiler en Miraflores?';
  const h = harness([
    text(proposal),
    tool('search_properties', args({ location: 'Miraflores', operation: 2, property_types: [2] })),
    text('SOLO PRUEBA · Presentación de ficha.'),
  ], [p], true);
  await h.chat(s, 'Estoy pensando en mudarme.');
  const result = await h.chat(s, 'Dale');
  assert.deepEqual(h.bodies[1].input, [
    { role: 'user', content: 'Estoy pensando en mudarme.' },
    { role: 'assistant', content: proposal }, { role: 'user', content: 'Dale' },
  ]);
  assert.equal(h.searches().length, 1);
  const filter = h.searches()[0];
  assert.deepEqual(filter.current_localization_id, [801]);
  assert.deepEqual(filter.property_types, [2]); assert.deepEqual(filter.operation_types, [2]);
  assert.equal(s.searchCriteria.max_price, null);
  const { resultIndex, ...card } = result.properties[0];
  assert.equal(resultIndex, 1); assert.deepEqual(card, normalizeProperty(p));
  assert.ok(entries.some(e => e.event === 'agent_model_result' && e.tools.includes('search_properties')));
  assert.ok(entries.some(e => e.event === 'agent_tokko' && e.status === 'matches' && e.resultCount === 1));
  assert.deepEqual(context(h.bodies[2]).responseCards, [{ propertyId: p.id, resultIndex: 1, photoCount: 11 }]);
  h.done();
});

test('confirmaciones: solicitud directa parcial no pide presupuesto ni mezcla tipos y operaciones', async () => {
  const p = fixture(99611);
  const catalog = [p, fixture(99612, { type: 3 }), fixture(99613, { type: 12 }), fixture(99614, { operation: 1 })];
  const h = harness([
    text('SOLO PRUEBA · Saludo.'),
    tool('search_properties', args({ location: 'Miraflores', operation: 2, property_types: [2] })),
    text('SOLO PRUEBA · Resultado de búsqueda parcial.'),
  ], catalog), s = state();
  await h.chat(s, 'Hola');
  const result = await h.chat(s, 'Quiero alquilar un departamento en Miraflores.');
  assert.deepEqual(result.properties.map(p => p.id), [p.id]);
  const filter = h.searches()[0];
  assert.deepEqual(filter.property_types, [2]); assert.deepEqual(filter.operation_types, [2]);
  assert.deepEqual(filter.current_localization_id, [801]);
  assert.equal(filter.price_from, 0); assert.equal(filter.currency, 'ANY');
  assert.equal(s.searchCriteria.max_price, null); assert.deepEqual(s.searchCriteria.property_types, [2]);
  assert.deepEqual(result.properties[0].photos, normalizeProperty(p).photos);
  assert.equal(h.searches().length, 1);
  h.done();
});

test('confirmaciones: cambio de distrito y presupuesto sustituye criterios y conserva alquiler y departamento', async () => {
  const a = fixture(99621, { price: 3000 });
  const b = fixture(99622, { location: places[1], price: 1900, photos: 16 });
  const h = harness([
    tool('search_properties', args({ location: 'Miraflores', operation: 2, property_types: [2], currency: 'PEN', max_price: 3200 })), text('SOLO PRUEBA · Primera búsqueda.'),
    tool('search_properties', args({ location: 'Lince', max_price: 2000 })), text('SOLO PRUEBA · Nueva búsqueda.'),
  ], [a, b, fixture(99623, { location: places[1], type: 3, price: 1900 }), fixture(99624, { location: places[1], operation: 1, price: 1900 })]), s = state();
  await h.chat(s, 'Busco un departamento de alquiler en Miraflores hasta 3200 soles.');
  const result = await h.chat(s, 'Mejor en Lince y hasta 2000.');
  const filters = h.searches(); assert.equal(filters.length, 2);
  assert.deepEqual(filters[0].current_localization_id, [801]);
  assert.deepEqual(filters[1].current_localization_id, [802]);
  assert.equal(filters[0].price_to, 3200); assert.equal(filters[1].price_to, 2000);
  for (const filter of filters) {
    assert.deepEqual(filter.property_types, [2]); assert.deepEqual(filter.operation_types, [2]);
    assert.equal(filter.currency, 'PEN');
  }
  assert.deepEqual(result.properties.map(p => p.id), [b.id]);
  assert.deepEqual(result.properties[0].photos, normalizeProperty(b).photos);
  assert.deepEqual(s.lastResultIds, [b.id]); assert.equal(s.searchCriteria.location, 'Lince');
  assert.equal(s.searchCriteria.max_price, 2000);
  h.done();
});

test('confirmaciones HTTP: sesiones intercaladas y nueva conversación no comparten historial, filtros ni fichas', async t => {
  const p = fixture(99631);
  const h = harness([
    tool('search_properties', args({ location: 'Miraflores', operation: 2, property_types: [2] })), text('SOLO PRUEBA · Ficha de sesión A.'),
    text('SOLO PRUEBA · Saludo en B.'),
    tool('show_property', { property_id: null, result_index: 1 }), text('SOLO PRUEBA · Fotos de A.'),
    text('SOLO PRUEBA · Reacción social en B.'), text('SOLO PRUEBA · Confirmación social en B.'),
    text('SOLO PRUEBA · Nueva sesión A.'), text('SOLO PRUEBA · Agradecimiento en B.'),
  ], [p]);
  const app = createApp({ env: { OPENAI_MODEL: 'gpt-6-luna', OPENAI_API_KEY: 'synthetic-key', TOKKO_API_KEY: 'synthetic-key' }, fetchImpl: h.fetchImpl });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = 'http://127.0.0.1:' + app.address().port;
  const post = (message, cookie) => fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ message }) });
  const firstA = await post('Busco departamentos de alquiler en Miraflores.');
  assert.equal(firstA.status, 200);
  const cookieA = firstA.headers.get('set-cookie').split(';')[0];
  assert.deepEqual((await firstA.json()).properties.map(p => p.id), [p.id]);
  const firstB = await post('Hola');
  const cookieB = firstB.headers.get('set-cookie').split(';')[0];
  assert.notEqual(cookieA, cookieB);
  assert.deepEqual((await firstB.json()).properties, []);
  emptyContext(h.bodies[2]); assert.deepEqual(h.bodies[2].input, [{ role: 'user', content: 'Hola' }]);
  const showA = await post('Muéstrame todas las fotos de la primera.', cookieA);
  assert.deepEqual((await showA.json()).properties[0].photos, normalizeProperty(p).photos);
  assert.deepEqual((await (await post('Bien bien', cookieB)).json()).properties, []);
  assert.deepEqual((await (await post('Sí', cookieB)).json()).properties, []);
  emptyContext(h.bodies[5]); emptyContext(h.bodies[6]);
  assert.deepEqual(h.bodies[6].input.filter(i => i.role === 'user').map(i => i.content), ['Hola', 'Bien bien', 'Sí']);
  assert.equal(h.searches().length, 1);
  assert.equal((await fetch(base + '/api/session/reset', { method: 'POST', headers: { Cookie: cookieA } })).status, 200);
  const beforeExpired = h.bodies.length;
  assert.equal((await post('Hola', cookieA)).status, 409);
  assert.equal(h.bodies.length, beforeExpired);
  assert.deepEqual((await (await post('Sí')).json()).properties, []);
  emptyContext(h.bodies[7]); assert.deepEqual(h.bodies[7].input, [{ role: 'user', content: 'Sí' }]);
  assert.deepEqual((await (await post('Gracias', cookieB)).json()).properties, []);
  emptyContext(h.bodies[8]);
  assert.deepEqual(h.bodies[8].input.filter(i => i.role === 'user').map(i => i.content), ['Hola', 'Bien bien', 'Sí', 'Gracias']);
  assert.equal(h.searches().length, 1);
  h.done();
});
