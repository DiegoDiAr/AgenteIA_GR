// SOLO PRUEBAS: decisiones y proveedores simulados. No se usa la API real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
import { createApp } from '../server.mjs';

const json = value => new Response(JSON.stringify(value));
const answer = usage => ({ status: 'completed', usage, output: [{ type: 'message', content: [{ type: 'output_text', text: 'SOLO PRUEBA · Respuesta simulada.' }] }] });
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
const args = changes => Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) =>
  [key, key in changes ? changes[key] : schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
let id = 0;
const call = (name, parameters, extra = []) => ({ status: 'completed', output: [...extra, { type: 'function_call', name, call_id: 'synthetic-model-' + ++id, arguments: JSON.stringify(parameters) }] });
const property = (id, price, count) => normalizeProperty({
  id, publication_title: 'SOLO PRUEBA · Departamento ' + id, fake_address: 'Dirección sintética',
  type: { id: 2, name: 'Departamento' }, location: { full_location: 'Peru | Lima | Lima | Miraflores' },
  description: 'SOLO PRUEBA · Condiciones publicadas del inmueble ' + id + '. '.repeat(150),
  total_surface: 98, suite_amount: 3, bathroom_amount: 2, parking_lot_amount: 1,
  operations: [{ operation_id: 2, operation_type: 'Alquiler', prices: [{ price, currency: 'PEN' }] }],
  photos: Array.from({ length: count }, (_, index) => ({ original: 'https://photos.example.test/' + id + '/' + index + '.jpg' })),
});

test('comparación: cambiar a Luna solo añade reasoning none; prompt, contexto, herramientas y límites son idénticos', async () => {
  const requests = [];
  for (const model of ['gpt-4.1-mini', 'gpt-6-luna', 'modelo-sintetico-alternativo']) {
    const chat = createChat({ apiKey: 'synthetic-key', model, tokko: { search: () => assert.fail('El saludo no consulta Tokko') }, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      requests.push(JSON.parse(options.body));
      return json(answer());
    } });
    const result = await chat(state(), 'SOLO PRUEBA · Hola.');
    assert.deepEqual(result.properties, []);
  }
  const [baseline, luna, other] = requests;
  assert.equal(baseline.model, 'gpt-4.1-mini'); assert.equal(luna.model, 'gpt-6-luna');
  assert.equal(baseline.reasoning, undefined); assert.equal(other.reasoning, undefined);
  assert.deepEqual(luna.reasoning, { effort: 'none' });
  const { model: oldModel, ...original } = baseline;
  const { model: newModel, reasoning, ...trial } = luna;
  assert.deepEqual(trial, original);
  assert.deepEqual(luna.tools, TOOLS); assert.equal(luna.tool_choice, 'auto');
  assert.equal(luna.parallel_tool_calls, false); assert.equal(luna.store, false);
  assert.equal(luna.max_output_tokens, 2200);
});

test('comparación: Luna conserva búsqueda parcial, alternativa económica, fotos y recuperación de detalles desde memoria', async () => {
  const a = property(99501, 4200, 11), b = property(99502, 3200, 16), session = state();
  const reasoningItem = { id: 'rs_synthetic', type: 'reasoning', summary: [], encrypted_content: 'SOLO-PRUEBA-CONTENIDO-OPACO' };
  const sequence = [
    call('search_properties', args({ location: 'Miraflores', operation: 2, property_types: [2] }), [reasoningItem]), answer(),
    call('search_properties', args({ currency: 'PEN', max_price: 4199 })), answer(),
    call('get_property', { url: null, property_id: b.id }), answer(),
  ];
  const bodies = [], filters = [];
  const chat = createChat({ apiKey: 'synthetic-key', model: 'gpt-6-luna', tokko: {
    search: async search => {
      filters.push(structuredClone(search));
      return { properties: filters.length === 1 ? [a] : [b], filters: search, nextOffset: null };
    },
    detail: () => assert.fail('La propiedad conocida se recupera de memoria'),
  }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    bodies.push(JSON.parse(options.body)); assert.ok(sequence.length);
    return json(sequence.shift());
  } });
  const first = await chat(session, 'SOLO PRUEBA · Busco un departamento en alquiler por Miraflores.');
  const cheaper = await chat(session, 'SOLO PRUEBA · Está caro jajaja, ¿hay algo más económico?');
  const details = await chat(session, 'SOLO PRUEBA · Cuéntame todos sus detalles.');
  assert.equal(sequence.length, 0); assert.equal(bodies.length, 6); assert.equal(filters.length, 2);
  assert.ok(bodies.every(body => body.model === 'gpt-6-luna' && body.reasoning.effort === 'none'));
  assert.deepEqual(bodies[1].input.find(item => item.type === 'reasoning'), reasoningItem);
  for (const filter of filters) {
    assert.equal(filter.location, 'Miraflores'); assert.equal(filter.operation, 2);
    assert.deepEqual(filter.property_types, [2]);
  }
  assert.equal(filters[0].max_price, null); assert.equal(filters[1].max_price, 4199);
  assert.equal(filters[1].currency, 'PEN');
  assert.equal(first.properties[0].id, a.id); assert.deepEqual(first.properties[0].photos, a.photos);
  assert.equal(cheaper.properties[0].id, b.id); assert.deepEqual(cheaper.properties[0].photos, b.photos);
  assert.deepEqual(details.properties, []);
  assert.equal(session.properties.get(b.id).description, b.description);
  assert.deepEqual(session.properties.get(b.id).photos, b.photos);
  assert.deepEqual(context(bodies[5]).propertyDetails, [{ id: b.id, description: b.description }]);
  assert.deepEqual(context(bodies[5]).responseCards, []);
  assert.deepEqual(session.lastResultIds, [b.id]); assert.equal(session.searchCriteria.max_price, 4199);
});

test('comparación: diagnóstico local registra latencia y solo contadores de tokens seguros cuando están disponibles', async t => {
  const entries = [];
  t.mock.method(console, 'info', line => entries.push(JSON.parse(line)));
  const responses = [
    answer({ input_tokens: 120, output_tokens: 25, total_tokens: 145, input_tokens_details: { cached_tokens: 80 }, output_tokens_details: { reasoning_tokens: 0 }, private_field: 'PRIVATE_PROVIDER_CONTENT' }),
    answer({ input_tokens: 'PRIVATE_USAGE_VALUE', output_tokens: -1, total_tokens: 1.5 }),
    answer(),
  ];
  const chat = createChat({ apiKey: 'synthetic-key', model: 'gpt-6-luna', diagnostics: true, tokko: {}, fetchImpl: async () => json(responses.shift()) });
  const s = state();
  for (let i = 0; i < 3; i++) await chat(s, 'PRIVATE_CLIENT_MESSAGE');
  assert.equal(entries.length, 3);
  assert.deepEqual(entries[0].usage, { inputTokens: 120, outputTokens: 25, totalTokens: 145, cachedInputTokens: 80, reasoningTokens: 0 });
  assert.equal(entries[0].model, 'gpt-6-luna'); assert.equal(entries[0].reasoningEffort, 'none');
  assert.ok(Number.isInteger(entries[0].elapsedMs) && entries[0].elapsedMs >= 0);
  const missing = { inputTokens: null, outputTokens: null, totalTokens: null, cachedInputTokens: null, reasoningTokens: null };
  assert.deepEqual(entries[1].usage, missing); assert.deepEqual(entries[2].usage, missing);
  assert.equal(JSON.stringify(entries).includes('PRIVATE'), false);
});

test('comparación HTTP: OPENAI_MODEL llega al backend y las dos interfaces usan el mismo endpoint existente', async t => {
  const requests = [];
  const app = createApp({ env: { OPENAI_MODEL: 'gpt-6-luna', OPENAI_API_KEY: 'synthetic-key', TOKKO_API_KEY: 'synthetic-key' }, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    requests.push(JSON.parse(options.body)); return json(answer());
  } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const base = 'http://127.0.0.1:' + app.address().port;
  for (const view of ['/', '/demo']) assert.equal((await fetch(base + view)).status, 200);
  assert.equal(requests.length, 0);
  for (const view of ['/', '/demo']) {
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Referer: base + view }, body: JSON.stringify({ message: 'SOLO PRUEBA · Hola.' }) });
    assert.equal(response.status, 200);
    assert.deepEqual((await response.json()).properties, []);
  }
  assert.equal(requests.length, 2);
  assert.ok(requests.every(body => body.model === 'gpt-6-luna' && body.reasoning.effort === 'none'));
});

test('genérica seguida de criterios: permite aclarar primero y buscar inmediatamente al recibir ubicación y operación', async () => {
  const p = property(99801, 2700, 11), session = state(), requests = [];
  session.properties.clear(); session.lastResultIds = [];
  const searchArgs = Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) => [key, schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
  Object.assign(searchArgs, { location: 'Miraflores', operation: 2, property_types: [2] });
  const sequence = [answer(), { status: 'completed', output: [{ type: 'function_call', name: 'search_properties', call_id: 'synthetic-partial', arguments: JSON.stringify(searchArgs) }] }, answer()];
  let searches = 0;
  const chat = createChat({ apiKey: 'synthetic-key', model: 'gpt-6-luna', tokko: { search: async filters => { searches++; return { properties: [p], filters, nextOffset: null }; } }, fetchImpl: async (_url, options) => { requests.push(JSON.parse(options.body)); return new Response(JSON.stringify(sequence.shift())); } });
  const generic = await chat(session, 'Estoy buscando una propiedad, ¿me ayudas?', { demo: true });
  assert.equal(searches, 0); assert.deepEqual(generic.properties, []);
  const found = await chat(session, 'Un departamento en alquiler en Miraflores.', { demo: true });
  assert.equal(searches, 1); assert.equal(found.properties.length, 1);
  assert.equal(session.searchCriteria.max_price, null); assert.equal(session.searchCriteria.operation, 2);
  assert.deepEqual(session.searchCriteria.property_types, [2]);
  assert.ok(requests[1].input.some(item => item.content === 'Estoy buscando una propiedad, ¿me ayudas?'));
  assert.deepEqual(found.properties[0].photos, p.photos);
});
