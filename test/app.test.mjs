// Datos sintéticos EXCLUSIVOS de pruebas. Nunca se sirven en la aplicación.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokko, normalizeProperty, validateSearch, safeUrl } from '../lib/tokko.mjs';
import { createChat } from '../lib/chat.mjs';
import { createApp } from '../server.mjs';

const json = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } });
const fixture = (id, price = 100) => ({ id, publication_title: `SOLO PRUEBA ${id}`, reference_code: `TEST-${id}`, fake_address: 'Dirección pública de prueba', real_address: 'PRIVADO', description: 'Terraza y piscina', tags: [{name:'Piscina'}, {name:'Terraza'}], suite_amount: 2, bathroom_amount: 1, type: { id: 2, name: 'Departamento' }, location: { full_location: 'Peru | Lima | Lima | Distrito de prueba' }, operations: [{ operation_id: 1, operation_type: 'Venta', prices: [{ price, currency: 'USD' }] }], photos: Array.from({ length: 17 }, (_, i) => ({ original: `https://photos.example.test/${id}/${i}.jpg`, thumb: `https://photos.example.test/${id}/${i}-thumb.jpg` })), public_url: `https://example.test/propiedad/${id}`, internal_comments: 'SECRETO', web_price: true });
const session = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const answer = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const call = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: 'test-call', arguments: JSON.stringify(args) }] });
const withLimaLocations = handler => async url => {
  if (url.pathname.includes('/location/quicksearch/')) return json({ objects: [{ id: 500, name: 'Lima', full_location: 'Peru | Lima | Lima' }] });
  if (url.pathname === '/api/v1/location/500/') return json({ id: 500, state: '/api/v1/state/252/' });
  return handler(url);
};

test('normalización conserva las 17 fotografías y excluye datos internos', () => {
  const p = normalizeProperty(fixture(1));
  assert.equal(p.photos.length, 17); assert.equal(p.photos[16].url, 'https://photos.example.test/1/16.jpg');
  assert.equal(p.operations[0].prices[0].amount, 100); assert.equal(p.bedrooms, 2);
  assert.ok(!JSON.stringify(p).includes('SECRETO')); assert.ok(!JSON.stringify(p).includes('PRIVADO'));
  assert.equal(normalizeProperty({ ...fixture(1), web_price: false }).operations[0].prices.length, 0);
});
test('no inventa fotografías, precio, superficie ni enlaces ausentes', () => {
  const p = normalizeProperty({ id: 9 }); assert.deepEqual(p.photos, []); assert.deepEqual(p.operations, []); assert.equal(p.publicUrl, null); assert.equal(p.area, null);
  for (const url of ['javascript:alert(1)', 'https://example.test/?key=private', 'https://user:secret@example.test']) assert.equal(safeUrl(url), null);
});
test('presupuesto requiere moneda y los filtros inválidos se rechazan', () => {
  assert.throws(() => validateSearch({ max_price: 100 }), /moneda/);
  assert.throws(() => validateSearch({ min_price: 200, max_price: 100, currency: 'USD' }), /mínimo/);
  assert.throws(() => validateSearch({ max_price: -1, currency: 'USD' }));
  assert.throws(() => validateSearch({ property_types: [0] }));
  assert.throws(() => validateSearch({ offset: -1 }));
});
test('Tokko recibe ubicación real, moneda, tipo, operación y características; devuelve detalle con todas las fotos', async () => {
  const urls = [];
  const tokko = createTokko({ apiKey: 'PRIVATE-TEST-KEY', fetchImpl: async url => {
    urls.push(new URL(url));
    if (url.pathname.includes('quicksearch')) return json({ objects: [{ id: 123, name: 'Distrito de prueba', full_location: 'Peru | Lima | Lima | Distrito de prueba' }] });
    if (url.pathname.includes('/search/')) return json({ objects: [fixture(1)], meta: { total_count: 1, next: null } });
    return json(fixture(1));
  } });
  const result = await tokko.search({ location: 'Distrito de prueba', currency: 'USD', max_price: 200, property_types: [2], operation: 1, min_bedrooms: 2, max_bedrooms: 2, min_bathrooms: 1, min_parking: 1, features: ['piscina'] });
  const data = JSON.parse(urls[1].searchParams.get('data'));
  assert.deepEqual(data.current_localization_id, [123]); assert.equal(data.current_localization_type, 'division');
  assert.deepEqual(data.property_types, [2]); assert.deepEqual(data.operation_types, [1]); assert.equal(data.currency, 'USD'); assert.equal(data.price_to, 200);
  assert.ok(data.filters.some(f => f[0] === 'suite_amount' && f[1] === '>=' && f[2] === 2));
  assert.ok(data.filters.some(f => f[0] === 'suite_amount' && f[1] === '<=' && f[2] === 2));
  assert.equal(result.properties[0].photos.length, 17); assert.equal(result.nextOffset, null); assert.ok(!JSON.stringify(result).includes('PRIVATE-TEST-KEY'));
});
test('ubicación ambigua o inexistente no dispara una búsqueda general', async () => {
  for (const objects of [[], [{ id: 1, name: 'Distrito', full_location: 'Peru | Lima | Lima | Zona A | Distrito' }, { id: 2, name: 'Distrito', full_location: 'Peru | Lima | Lima | Zona B | Distrito' }]]) {
    let requests = 0;
    const tokko = createTokko({ apiKey: 'test', fetchImpl: async () => { requests++; return json({ objects }); } });
    const result = await tokko.search({ location: 'Distrito' }); assert.equal(result.needsLocation, true); assert.equal(requests, 1); assert.deepEqual(result.properties, []);
  }
});
test('paginación no se detiene por páginas cortas y características no producen falso inventario agotado', async () => {
  const requests = [];
  const tokko = createTokko({ apiKey: 'test', fetchImpl: withLimaLocations(async url => {
    requests.push(new URL(url));
    return json({ objects: [], meta: { total_count: 300, next: '/api/v1/property/search/?offset=100&key=NO-EXPOSURE' } });
  }) });
  const result = await tokko.search({ features: ['gimnasio'] });
  assert.equal(result.nextOffset, 100); assert.equal(result.partialFeatureScan, true); assert.equal(result.properties.length, 0); assert.ok(!JSON.stringify(result).includes('NO-EXPOSURE'));
  assert.equal(requests[0].searchParams.get('limit'), '100');
});
test('página con más de cinco coincidencias retoma en la siguiente sin saltarlas', async () => {
  const objects = Array.from({ length: 12 }, (_, i) => fixture(i + 1));
  const tokko = createTokko({ apiKey: 'test', fetchImpl: withLimaLocations(async url => url.pathname.includes('/search/') ? json({ objects, meta: { total_count: 12, next: null } }) : json(fixture(Number(url.pathname.split('/').at(-2))))) });
  const result = await tokko.search({ features: ['piscina'] }); assert.equal(result.properties.length, 5); assert.equal(result.nextOffset, 5);
});
test('errores de Tokko no exponen claves ni cuerpos upstream', async () => {
  const tokko = createTokko({ apiKey: 'SECRET', fetchImpl: async () => json({ error: 'SECRET + private URL' }, 401) });
  await assert.rejects(tokko.search({}), error => error.code === 'invalid_credentials' && !error.message.includes('SECRET'));
  await assert.rejects(createTokko({}).search({}), error => error.code === 'missing_tokko_key');
});
test('menciones negadas o cercanas no se convierten en una característica verificada', async () => {
  for (const description of ['Departamento sin piscina', 'Piscina cercana a la propiedad', 'Departamento con piscina']) {
    const p = { ...fixture(1), tags: [], description };
    const tokko = createTokko({ apiKey: 'test', fetchImpl: withLimaLocations(async () => json({ objects: [p], meta: { total_count: 1, next: null } })) });
    const result = await tokko.search({ features: ['piscina'] }); assert.equal(result.properties.length, 0); assert.ok(result.message.includes('etiquetas explícitas'));
  }
});
test('saludo y agradecimiento sin tool calls nunca consultan Tokko; historial conserva contexto', async () => {
  const bodies = []; let searches = 0;
  const chat = createChat({ apiKey: 'test', tokko: { search: async () => { searches++; } }, fetchImpl: async (_, options) => { bodies.push(JSON.parse(options.body)); return json(answer('Hola. ¿Qué buscas?')); } });
  const s = session(); await chat(s, 'Hola'); await chat(s, 'Gracias');
  assert.equal(searches, 0); assert.equal(bodies[0].tool_choice, 'auto'); assert.equal(bodies[0].store, false); assert.ok(bodies[1].input.some(i => i.content === 'Hola')); assert.equal(s.turns, 2);
});
test('búsqueda, precio de la segunda y todas sus fotos mantienen IDs y orden', async () => {
  const s = session(), properties = [normalizeProperty(fixture(11)), normalizeProperty(fixture(22, 200))];
  let step = 0, searches = 0;
  const responses = [call('search_properties', {}), answer('Encontré dos opciones.'), answer('La segunda cuesta USD 200.'), call('show_property', { property_id: null, result_index: 2 }), answer('Estas son todas sus fotos.')];
  const chat = createChat({ apiKey: 'test', tokko: { search: async () => { searches++; return { properties, filters: {}, nextOffset: null, totalCandidates: 2 }; } }, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    if (step === 1) assert.equal(JSON.parse(body.input.at(-1).output).properties[1].photoCount, 17);
    if (step === 2) { assert.ok(body.instructions.includes('22')); assert.ok(body.instructions.includes('200')); }
    return json(responses[step++]);
  } });
  const found = await chat(s, 'Busca departamentos'); assert.deepEqual(found.properties.map(p => p.resultIndex), [1, 2]);
  await chat(s, '¿Cuánto cuesta la segunda?'); const photos = await chat(s, 'Muéstrame todas sus fotos');
  assert.equal(searches, 1); assert.equal(photos.properties[0].id, 22); assert.equal(photos.properties[0].photos.length, 17); assert.deepEqual(s.lastResultIds, [11, 22]);
});
test('refinamiento a más barata envía filtros al backend y actualiza orden de resultados', async () => {
  const s = session(); s.lastSearch = { filters: { location: 'Distrito', max_price: 200, currency: 'USD', operation: 1, property_types: [2] } };
  let step = 0, captured;
  const filters = { location: 'Distrito', max_price: 199, currency: 'USD', operation: 1, property_types: [2] };
  const chat = createChat({ apiKey: 'test', tokko: { search: async args => { captured = args; return { properties: [normalizeProperty(fixture(33, 150))], filters: args, nextOffset: null }; } }, fetchImpl: async () => json(step++ ? answer('Una opción más barata.') : call('search_properties', filters)) });
  await chat(s, '¿Tienes una más barata?'); assert.deepEqual(captured, filters); assert.deepEqual(s.lastResultIds, [33]);
});
test('fallo de OpenAI no confirma un turno parcial; falta de clave es explícita', async () => {
  const s = session();
  const chat = createChat({ apiKey: 'test', tokko: {}, fetchImpl: async () => json({}, 429) });
  await assert.rejects(chat(s, 'Hola'), error => error.code === 'upstream_limit'); assert.equal(s.history.length, 0); assert.equal(s.turns, 0);
  await assert.rejects(createChat({ tokko: {} })(s, 'Hola'), error => error.code === 'missing_openai_key');
});
test('sesiones distintas no comparten resultados', async () => {
  const a = session(), b = session(); a.properties.set(1, normalizeProperty(fixture(1))); a.lastResultIds = [1];
  let step = 0;
  const chat = createChat({ apiKey: 'test', tokko: {}, fetchImpl: async (_, options) => {
    if (step === 1) assert.equal(JSON.parse(JSON.parse(options.body).input.at(-1).output).error, 'unknown_property');
    return json(step++ ? answer('¿A cuál te refieres?') : call('show_property', { property_id: 1, result_index: null }));
  } });
  const result = await chat(b, 'La primera'); assert.equal(result.properties.length, 0); assert.equal(b.properties.size, 0);
});

test('HTTP sirve interfaz, protege archivos privados y valida peticiones y sesión', async t => {
  let calls = 0;
  const app = createApp({ env: { OPENAI_API_KEY: 'SECRET1', TOKKO_API_KEY: 'SECRET2' }, chatImpl: async (s, message) => { calls++; s.history.push(message); return { message: String(s.history.length), properties: [], searches: [] }; } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve)); t.after(() => new Promise(resolve => app.close(resolve)));
  const base = `http://127.0.0.1:${app.address().port}`;
  const health = await (await fetch(`${base}/api/health`)).text(); assert.ok(health.includes('true')); assert.ok(!health.includes('SECRET'));
  assert.equal((await fetch(base)).status, 200);
  for (const path of ['/.env', '/server.mjs', '/test/app.test.mjs', '/lib/tokko.mjs']) assert.equal((await fetch(base + path)).status, 404);
  const post = (body, cookie, origin) => fetch(`${base}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}), ...(origin ? { Origin: origin } : {}) }, body });
  assert.equal((await post('{')).status, 400); assert.equal((await post('{}')).status, 400); assert.equal((await post(JSON.stringify({ message: 'x'.repeat(4001) }))).status, 400);
  assert.equal((await post('{"message":"Hola"}', null, 'https://other.example')).status, 403);
  const response = await post('{"message":"Hola"}'); const cookie = response.headers.get('set-cookie').split(';')[0]; assert.ok(response.headers.get('set-cookie').includes('HttpOnly')); assert.equal((await response.json()).message, '1');
  assert.equal((await (await post('{"message":"Hola"}', cookie)).json()).message, '2'); assert.equal((await (await post('{"message":"Hola"}')).json()).message, '1');
  await fetch(`${base}/api/session/reset`, { method: 'POST', headers: { Cookie: cookie } }); assert.equal((await post('{"message":"Hola"}', cookie)).status, 409); assert.equal(calls, 3);
});
