// Todas las propiedades, claves y respuestas de OpenAI/Tokko son SINTÉTICAS.
// Estas pruebas verifican ejecución de herramientas, no razonamiento de un LLM real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokko, mergeSearch, officialPropertyUrl } from '../lib/tokko.mjs';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { createApp } from '../server.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const district = (name, id = 101) => ({ id, name, full_location: `Peru | Lima | Lima | ${name}` });
const image = (id, index = 0, original = false) => `https://static.tokkobroker.com/${original ? 'original_' : ''}pictures/${id}_1234567890123456${index}123456789.jpg`;
const property = (id = 9001, location = district('Miraflores'), typeId = 2) => ({
  id, location, type: { id: typeId, name: typeId === 12 ? 'Nave Industrial' : 'Departamento' },
  publication_title: 'SOLO PRUEBA · Propiedad sintética', description: 'Datos exclusivos de pruebas.',
  operations: [{ operation_id: 2, operation_type: 'Alquiler', prices: [{ price: 4200, currency: 'PEN' }] }],
  photos: Array.from({ length: 17 }, (_, index) => ({ original: image(id, index, true), thumb: image(id, index) })),
});
const patch = changes => Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) => [key, key in changes ? changes[key] : schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
const tool = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'synthetic-call' }] });
const answer = () => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'Respuesta simulada para probar el backend.' }] }] });
function scripted(tokko, sequence) {
  const bodies = [], outputs = []; let step = 0;
  const chat = createChat({ apiKey: 'synthetic-key', tokko, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.tool_choice, 'auto'); assert.equal(body.store, false);
    bodies.push(body);
    if (body.input.at(-1)?.type === 'function_call_output') outputs.push(JSON.parse(body.input.at(-1).output));
    assert.ok(step < sequence.length, 'No hay llamadas adicionales no previstas');
    return json(sequence[step++]);
  } });
  return { chat, bodies, outputs };
}
function catalog({ locations = [district('Miraflores'), { id: 202, name: 'Miraflores', full_location: 'Peru | Lima | Yauyos | Miraflores' }], properties = [property()], failSearch, requests = [] } = {}) {
  return createTokko({ apiKey: 'synthetic-key', fetchImpl: async (input, options) => {
    const url = new URL(input); requests.push(url);
    assert.equal(url.hostname, 'www.tokkobroker.com'); assert.equal(options.redirect, 'error');
    if (url.pathname.includes('/quicksearch/')) return json({ objects: locations });
    if (url.pathname.includes('/property/search/')) {
      if (failSearch) return failSearch();
      const data = JSON.parse(url.searchParams.get('data'));
      const found = properties.filter(p => data.current_localization_id.includes(p.location.id) && (!data.property_types.length || data.property_types.includes(p.type.id)) && p.operations.some(op => data.operation_types.includes(op.operation_id) && op.prices.some(price => (data.currency === 'ANY' || price.currency === data.currency) && price.price >= data.price_from && price.price <= data.price_to)));
      const offset = Number(url.searchParams.get('offset')), limit = Number(url.searchParams.get('limit'));
      return json({ objects: found.slice(offset, offset + limit), meta: { total_count: found.length, next: null } });
    }
    const found = properties.find(p => url.pathname === `/api/v1/property/${p.id}/`);
    assert.ok(found, 'Solo IDs existentes en el proveedor simulado'); return json(found);
  } });
}

test('A/B: Miraflores y Miraflores, Lima consultan el distrito metropolitano sin confirmar Yauyos', async t => {
  for (const location of ['Miraflores', 'Miraflores, Lima', 'Perú | Lima | Lima | Miraflores']) await t.test(location, async () => {
    const requests = [], s = state();
    const { chat, outputs } = scripted(catalog({ requests }), [tool('search_properties', patch({ location, property_types: [2] })), answer()]);
    const response = await chat(s, `Busco un departamento en ${location}.`);
    assert.equal(response.properties.length, 1); assert.equal(outputs[0].status, 'matches');
    assert.equal(outputs[0].needsLocation, undefined);
    const search = requests.find(url => url.pathname.includes('/search/'));
    assert.deepEqual(JSON.parse(search.searchParams.get('data')).current_localization_id, [101]);
    assert.equal(s.lastSearch.resolvedLocation.paths[0], 'Peru | Lima | Lima | Miraflores');
  });
});

test('una provincia explícita participa en la resolución y no se cambia silenciosamente por Lima ciudad', async () => {
  const requests = [];
  const result = await catalog({ requests, properties: [] }).search({ location: 'Miraflores, Yauyos, Lima' });
  assert.deepEqual(result.resolvedLocation.ids, [202]); assert.equal(result.needsLocation, undefined);
});

test('C: un nuevo presupuesto hereda Miraflores, alquiler, departamento y PEN; reinicia la página', async () => {
  const requests = [], s = state();
  const sequence = [tool('search_properties', patch({ location: 'Miraflores, Lima', property_types: [2], operation: 2, currency: 'PEN', max_price: 1700 })), answer(), tool('search_properties', patch({ max_price: 5000, offset: 35 })), answer()];
  const { chat, outputs, bodies } = scripted(catalog({ requests }), sequence);
  const first = await chat(s, 'Busco un departamento en alquiler en Miraflores hasta 1700 soles.');
  assert.equal(first.properties.length, 0); assert.equal(outputs[0].status, 'no_matches');
  const second = await chat(s, 'Ahora puedo pagar hasta 5000.');
  assert.equal(second.properties[0].id, 9001); assert.equal(second.properties[0].photos.length, 17);
  const searches = requests.filter(url => url.pathname.includes('/search/'));
  assert.equal(searches.length, 2);
  const data = JSON.parse(searches[1].searchParams.get('data'));
  assert.equal(data.price_to, 5000); assert.equal(data.price_from, 0); assert.equal(data.currency, 'PEN');
  assert.deepEqual(data.operation_types, [2]); assert.deepEqual(data.property_types, [2]); assert.deepEqual(data.current_localization_id, [101]);
  assert.equal(searches[1].searchParams.get('offset'), '0');
  assert.equal(s.searchCriteria.max_price, 5000); assert.equal(s.searchCriteria.location, 'Miraflores, Lima');
  const context = JSON.parse(bodies.at(-1).instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
  assert.equal(context.searchCriteria.max_price, 5000); assert.equal(context.lastSearchAttempt.status, 'matches');
});

test('quitar criterios es explícito; no se impide buscar sin presupuesto, operación o tipo', () => {
  const previous = { location: 'Miraflores', operation: 2, currency: 'PEN', max_price: 1700, property_types: [2], features: ['terraza'], offset: 20 };
  const merged = mergeSearch(previous, patch({ reset_fields: ['max_price', 'operation', 'property_types', 'features'] }));
  assert.equal(merged.max_price, null); assert.equal(merged.operation, null); assert.deepEqual(merged.property_types, []); assert.deepEqual(merged.features, []);
  assert.equal(merged.location, 'Miraflores'); assert.equal(merged.currency, 'PEN'); assert.equal(merged.offset, 0);
  assert.equal('reset_fields' in merged, false);
  assert.throws(() => mergeSearch(previous, { reset_fields: ['inventado'] }), error => error.code === 'invalid_filters');
  assert.equal(mergeSearch(previous, { offset: 25 }).offset, 25);
});

test('una aclaración geográfica real resuelve la jerarquía y persiste al cambiar el presupuesto', async () => {
  const locations = [{ id: 301, name: 'Zona', full_location: 'Peru | Lima | Lima | Sector A | Zona' }, { id: 302, name: 'Zona', full_location: 'Peru | Lima | Lima | Sector B | Zona' }];
  const s = state(), requests = [];
  const { chat, outputs } = scripted(catalog({ locations, properties: [], requests }), [tool('search_properties', patch({ location: 'Zona', currency: 'PEN', max_price: 1700 })), answer(), tool('search_properties', patch({ location: 'Zona, Sector B' })), answer(), tool('search_properties', patch({ max_price: 5000 })), answer()]);
  await chat(s, 'Quiero buscar en Zona hasta 1700 soles.');
  assert.equal(outputs[0].status, 'needs_location'); assert.equal(outputs[0].locations.length, 2);
  assert.equal(requests.filter(url => url.pathname.includes('/search/')).length, 0);
  await chat(s, 'Sector B.'); await chat(s, 'Puedo aumentar el presupuesto a 5000.');
  assert.equal(outputs[1].needsLocation, undefined); assert.equal(outputs[2].needsLocation, undefined);
  assert.deepEqual(s.lastSearch.resolvedLocation.ids, [302]); assert.equal(s.searchCriteria.location, 'Zona, Sector B');
});

test('distritos del proveedor y almacenes funcionan sin una lista de distritos en el código', async t => {
  for (const name of ['Lince', 'San Isidro', 'Santiago de Surco', 'Los Olivos', 'San Miguel', 'La Molina', 'Distrito nuevo sintético']) await t.test(name, async () => {
    const location = district(name, 400);
    const result = await catalog({ locations: [location], properties: [property(9001, location, 12)] }).search({ location: name, property_types: [12] });
    assert.equal(result.properties[0].typeId, 12); assert.deepEqual(result.resolvedLocation.ids, [400]);
  });
});

const publication = 'https://gruporentabilizarme.com/Propiedades/Detalle?id=11177376';
function linkedCatalog({ id = 9001, html, photoMismatch = false, pageStatus = 200, pageFailure = false, detailStatus = 200, requests = [] } = {}) {
  return createTokko({ apiKey: 'synthetic-key', fetchImpl: async (input, options) => {
    const url = new URL(input); requests.push(url); assert.equal(options.redirect, 'error');
    if (url.hostname === 'gruporentabilizarme.com') {
      assert.equal(url.href, publication);
      if (pageFailure) throw new Error('Detalle técnico privado');
      return new Response(html ?? `<meta content="${image(id)}" property="og:image">`, { status: pageStatus });
    }
    assert.equal(url.hostname, 'www.tokkobroker.com'); assert.equal(url.pathname, `/api/v1/property/${id}/`);
    return json(photoMismatch ? { ...property(id), photos: [{ original: image(id).replace('1234567890123456', '9999999999999999') }] } : property(id), detailStatus);
  } });
}

test('D: enlace sin búsqueda previa resuelve un ID distinto por imágenes y conserva todas las fotos y contexto', async () => {
  const requests = [], s = state(); s.lastResultIds = [777];
  const { chat, outputs, bodies } = scripted(linkedCatalog({ requests }), [tool('get_property', { url: publication, property_id: null }), answer(), answer(), tool('show_property', { property_id: 9001, result_index: null }), answer()]);
  const first = await chat(s, `Cuéntame de esta propiedad: ${publication}`);
  assert.equal(first.properties[0].id, 9001); assert.equal(first.properties[0].photos.length, 17);
  assert.equal(first.properties[0].publicUrl, publication); assert.equal(first.properties[0].resultIndex, null);
  assert.equal(requests.length, 2); assert.ok(!requests.some(url => url.pathname === '/api/v1/property/11177376/'));
  assert.deepEqual(s.lastResultIds, [777]); assert.equal(s.lastViewedPropertyId, 9001);
  assert.equal(outputs[0].galleryDisplayed, true); assert.equal(outputs[0].photoCount, 17);
  await chat(s, '¿Cuánto cuesta la que te pasé?');
  const context = JSON.parse(bodies[2].instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
  assert.equal(context.lastViewedPropertyId, 9001); assert.equal(context.knownProperties[0].sourceUrl, publication);
  const photos = await chat(s, 'Muéstrame todas sus fotos.');
  assert.equal(photos.properties[0].photos.length, 17); assert.equal(requests.length, 2);
  assert.deepEqual(s.lastResultIds, [777]);
});

test('un ID explícito de Tokko se consulta sin exigir resultados anteriores', async () => {
  const requests = [], s = state();
  const { chat } = scripted(catalog({ requests }), [tool('get_property', { property_id: 9001, url: null }), answer()]);
  const result = await chat(s, 'Consulta el ID de Tokko 9001.');
  assert.equal(requests.length, 1); assert.equal(result.properties[0].id, 9001); assert.equal(result.properties[0].photos.length, 17);
});

test('el dominio, ruta y protocolo del enlace se validan antes de realizar solicitudes', async () => {
  const requests = [], tokko = linkedCatalog({ requests });
  for (const url of ['https://example.test/Propiedades/Detalle?id=1', 'https://gruporentabilizarme.com.evil.test/Propiedades/Detalle?id=1', 'https://gruporentabilizarme.com@127.0.0.1/Propiedades/Detalle?id=1', 'http://127.0.0.1:8787/', 'https://gruporentabilizarme.com:444/Propiedades/Detalle?id=1', 'https://gruporentabilizarme.com/redirect?url=http://localhost', 'https://gruporentabilizarme.com/Propiedades/Detalle?id=1&id=2', 'file:///etc/passwd']) await assert.rejects(tokko.fromUrl(url), error => error.code === 'invalid_property_url');
  assert.equal(requests.length, 0);
  assert.equal(officialPropertyUrl('http://www.gruporentabilizarme.com/Propiedades/Detalle?id=1&tracking=x'), 'https://gruporentabilizarme.com/Propiedades/Detalle?id=1');
});

test('publicaciones sin evidencia, con varios IDs o con imágenes incompatibles no inventan correspondencias', async t => {
  for (const options of [{ html: '<h1>Sin información verificable</h1>' }, { html: `<img src="${image(9001)}"><img src="${image(9002)}">` }, { photoMismatch: true }]) await t.test(JSON.stringify(options), async () => {
    await assert.rejects(linkedCatalog(options).fromUrl(publication), error => error.code === 'property_unresolved');
  });
});

test('enlaces con galería pública y sin og:image también se verifican contra la ficha', async () => {
  const result = await linkedCatalog({ html: `<img src='${image(9001)}'>` }).fromUrl(publication);
  assert.equal(result.id, 9001); assert.equal(result.photos.length, 17);
});

test('fallos de página y de Tokko no agregan fichas ni se presentan como inventario vacío', async t => {
  for (const [options, expected] of [[{ pageStatus: 404 }, 'publication_not_found'], [{ pageStatus: 500 }, 'publication_unavailable'], [{ pageStatus: 302 }, 'publication_unavailable'], [{ pageFailure: true }, 'publication_unavailable'], [{ detailStatus: 401 }, 'invalid_credentials']]) await t.test(expected + JSON.stringify(options), async () => {
    const s = state(), { chat, outputs } = scripted(linkedCatalog(options), [tool('get_property', { url: publication, property_id: null }), answer()]);
    const result = await chat(s, 'Consulta este enlace.');
    assert.equal(outputs[0].status, 'error'); assert.equal(outputs[0].error, expected);
    assert.deepEqual(result.properties, []); assert.equal(s.properties.size, 0);
    assert.ok(!JSON.stringify(outputs).includes('Detalle técnico privado'));
  });
});

test('E/F: vacío válido, error HTTP, transporte y formato generan salidas distintas de herramienta', async t => {
  const cases = [
    ['no_matches', null, null],
    ['service_unavailable', () => { throw new Error('URL privada con key=SECRET'); }, 'error'],
    ['invalid_credentials', () => json({}, 401), 'error'],
    ['upstream_limit', () => json({}, 429), 'error'],
    ['upstream_error', () => json({}, 500), 'error'],
    ['invalid_response', () => json({ objects: [] }), 'error'],
    ['invalid_response', () => json(null), 'error'],
    ['tokko_error', () => json({ error_message: 'SECRET' }), 'error'],
  ];
  for (const [expected, failSearch, status] of cases) await t.test(expected, async () => {
    const s = state(), { chat, outputs } = scripted(catalog({ properties: [], failSearch }), [tool('search_properties', patch({ location: 'Miraflores', currency: 'PEN', max_price: 5000 })), answer()]);
    const result = await chat(s, 'Busca hasta 5000 soles.');
    assert.deepEqual(result.properties, []); assert.equal(outputs[0].status, status || 'no_matches');
    assert.equal(outputs[0].error, status ? expected : undefined);
    assert.equal(result.searches.length, status ? 0 : 1);
    assert.equal(s.lastSearchAttempt.status, status || 'no_matches');
    assert.equal(s.searchCriteria.max_price, 5000); assert.ok(!JSON.stringify(outputs).includes('SECRET'));
  });
});

test('una ubicación no identificada no se convierte en búsqueda general ni catálogo vacío', async () => {
  const requests = [], s = state();
  const { chat, outputs } = scripted(catalog({ requests }), [tool('search_properties', patch({ location: 'Lugar que no coincide' })), answer()]);
  const result = await chat(s, 'Busca en Lugar que no coincide.');
  assert.equal(outputs[0].status, 'needs_location'); assert.deepEqual(result.searches, []);
  assert.equal(requests.length, 1);
});

test('G: saludo natural deja a OpenAI responder sin ejecutar herramientas ni consultar Tokko', async () => {
  let requests = 0;
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: () => { requests++; assert.fail('Un saludo no debe consultar Tokko'); } });
  const s = state(), { chat, bodies } = scripted(tokko, [answer(), answer()]);
  const first = await chat(s, 'Hola, ¿cómo estás?'); await chat(s, 'Gracias, te cuento en un momento.');
  assert.equal(requests, 0); assert.deepEqual(first.properties, []); assert.deepEqual(first.searches, []);
  assert.ok(bodies[1].input.some(item => item.content === 'Hola, ¿cómo estás?'));
});

test('las nuevas herramientas conservan contratos strict compatibles con Responses', () => {
  for (const tool of TOOLS) {
    assert.equal(tool.strict, true); assert.equal(tool.parameters.additionalProperties, false);
    assert.deepEqual([...tool.parameters.required].sort(), Object.keys(tool.parameters.properties).sort());
  }
});

test('un reintento después de un fallo de Tokko conserva los filtros actualizados', async () => {
  let fail = true;
  const requests = [], s = state();
  const base = catalog({ requests, failSearch: () => fail ? json({}, 503) : json({ objects: [property()], meta: { total_count: 1, next: null } }) });
  const { chat, outputs } = scripted(base, [tool('search_properties', patch({ location: 'Miraflores', property_types: [2], operation: 2, currency: 'PEN', max_price: 5000 })), answer(), tool('search_properties', patch({})), answer()]);
  await chat(s, 'Busca departamentos en alquiler en Miraflores hasta 5000 soles.');
  assert.equal(outputs[0].status, 'error'); assert.equal(s.lastSearch, null);
  fail = false;
  const result = await chat(s, 'Intenta otra vez con lo que te dije.');
  assert.equal(result.properties.length, 1); assert.equal(outputs[1].status, 'matches');
  const search = requests.filter(url => url.pathname.includes('/search/')).at(-1);
  const data = JSON.parse(search.searchParams.get('data'));
  assert.equal(data.price_to, 5000); assert.equal(data.currency, 'PEN');
  assert.deepEqual(data.property_types, [2]); assert.deepEqual(data.operation_types, [2]);
});

test('Surco se resuelve con los nombres y la jerarquía del proveedor, sin alias rígidos', async () => {
  const locations = [district('Santiago de Surco', 701), { id: 702, name: 'Surco', full_location: 'Peru | Lima | Huarochirí | Surco' }];
  const result = await catalog({ locations, properties: [] }).search({ location: 'Surco, Lima' });
  assert.deepEqual(result.resolvedLocation.ids, [701]);
});

test('HTTP: el enlace nuevo entrega la ficha y todas las fotos al frontend existente', async t => {
  let step = 0, reads = 0;
  const responses = [tool('get_property', { url: publication, property_id: null }), answer(), tool('show_property', { property_id: 9001, result_index: null }), answer()];
  const app = createApp({ env: { OPENAI_API_KEY: 'synthetic-key', TOKKO_API_KEY: 'synthetic-key' }, fetchImpl: async input => {
    const url = new URL(input); reads++;
    if (url.hostname === 'api.openai.com') { assert.ok(step < responses.length); return json(responses[step++]); }
    if (url.href === publication) return new Response(`<meta property="og:image" content="${image(9001)}">`);
    assert.equal(url.hostname, 'www.tokkobroker.com'); assert.equal(url.pathname, '/api/v1/property/9001/');
    return json(property());
  } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const endpoint = `http://127.0.0.1:${app.address().port}/api/chat`;
  const first = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: `Cuéntame de esta propiedad: ${publication}` }) });
  assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  const card = (await first.json()).properties[0];
  assert.equal(card.id, 9001); assert.equal(card.photos.length, 17); assert.equal(card.publicUrl, publication); assert.equal(card.resultIndex, null);
  assert.ok(card.photos.every(photo => photo.url && photo.thumbnail && photo.caption));
  const second = await fetch(endpoint, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: cookie }, body: JSON.stringify({ message: 'Muéstrame otra vez todas sus fotos.' }) });
  assert.equal(second.status, 200); assert.equal((await second.json()).properties[0].photos.length, 17);
  assert.equal(reads, 6); assert.equal(step, 4);
});
