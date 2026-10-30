// SOLO PRUEBAS: ambos proveedores, publicaciones y respuestas del modelo son sintéticos.
// Verifican transporte, contexto y herramientas; NO evalúan la naturalidad de OpenAI real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { AppError } from '../lib/errors.mjs';
import { createTokko, normalizeProperty, validateSearch } from '../lib/tokko.mjs';

const json = value => new Response(JSON.stringify(value));
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const text = value => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text: value }] }] });
let callId = 0;
const tool = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: 'synthetic-' + ++callId, arguments: JSON.stringify(args) }] });
const args = changes => Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) => [key, key in changes ? changes[key] : schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
const miraflores = { id: 101, name: 'Miraflores', full_location: 'Peru | Lima | Lima | Miraflores' };
const publication = 'https://gruporentabilizarme.com/Propiedades/Detalle?id=99900001';
const image = (id, index = 0, original = false) => 'https://static.tokkobroker.com/' + (original ? 'original_' : '') + 'pictures/' + id + '_1234567890123456' + index + '123456789.jpg';
const fixture = (id, price, photos, location = miraflores) => ({
  id, publication_title: 'SOLO PRUEBA · Ficha sintética ' + id, reference_code: 'SOLO-PRUEBA-' + id,
  fake_address: 'Dirección sintética', location, type: { id: 2, name: 'Departamento' },
  description: 'SOLO PRUEBA. Tres dormitorios principales y un cuarto de servicio. Tercer piso sin ascensor.',
  suite_amount: 4, bathroom_amount: 2, room_amount: 5, parking_lot_amount: 1,
  total_surface: 98, surface_measurement: 'M2', tags: [{ name: 'Terraza' }],
  operations: [{ operation_id: 2, operation_type: 'Alquiler', prices: [{ price, currency: 'PEN', period: 1 }] }],
  photos: Array.from({ length: photos }, (_, index) => ({ original: image(id, index, true), thumb: image(id, index), description: 'SOLO PRUEBA · Imagen ' + (index + 1) })),
});

function harness(sequence, { properties = [], linked = null, model = 'gpt-4.1-mini' } = {}) {
  const bodies = [], upstream = []; let step = 0;
  const fetchImpl = async (input, options) => {
    const url = new URL(input);
    if (url.hostname === 'api.openai.com') {
      assert.equal(url.href, 'https://api.openai.com/v1/responses');
      const body = JSON.parse(options.body); bodies.push(structuredClone(body));
      assert.equal(body.model, model);
      assert.equal(body.tool_choice, 'auto'); assert.equal(body.parallel_tool_calls, false);
      assert.equal(body.store, false); assert.equal(body.max_output_tokens, 2200);
      assert.deepEqual(body.tools, TOOLS);
      assert.ok(step < sequence.length, 'No se permiten solicitudes adicionales al modelo simulado');
      return json(sequence[step++]);
    }
    upstream.push(url);
    assert.equal(options.redirect, 'error');
    if (url.href === publication && linked) return new Response('<meta property="og:image" content="' + image(linked.id) + '">');
    assert.equal(url.hostname, 'www.tokkobroker.com', 'Solo rutas previstas del proveedor simulado');
    if (url.pathname.includes('/quicksearch/')) return json({ objects: [miraflores] });
    if (url.pathname.includes('/property/search/')) {
      const data = JSON.parse(url.searchParams.get('data'));
      assert.equal(data.only_available, 'checked');
      const found = properties.filter(p => data.current_localization_id.includes(p.location.id) &&
        (!data.property_types.length || data.property_types.includes(p.type.id)) &&
        p.operations.some(op => data.operation_types.includes(op.operation_id) &&
          op.prices.some(price => (data.currency === 'ANY' || price.currency === data.currency) && price.price >= data.price_from && price.price <= data.price_to)));
      return json({ objects: found, meta: { total_count: found.length, next: null } });
    }
    const p = [...properties, ...(linked ? [linked] : [])].find(p => url.pathname === '/api/v1/property/' + p.id + '/');
    assert.ok(p, 'Solo se recuperan IDs de fichas sintéticas existentes');
    return json(p);
  };
  return {
    chat: createChat({ apiKey: 'synthetic-key', model, tokko: createTokko({ apiKey: 'synthetic-key', fetchImpl }), fetchImpl }),
    bodies, upstream, done() { assert.equal(step, sequence.length); },
  };
}

test('personalidad: saludos de distintos registros conservan el diálogo sin herramientas forzadas', async () => {
  const s = state();
  const messages = ['Hola, ¿qué tal tu día?', 'Buenas tardes. Gracias por la atención.', 'Todo bien, todavía estoy pensando qué buscar.'];
  const h = harness(messages.map((_, i) => text('SOLO PRUEBA · turno conversacional ' + i)), { model: 'modelo-sintetico-configurado' });
  for (const message of messages) {
    const result = await h.chat(s, message);
    assert.deepEqual(result.properties, []); assert.deepEqual(result.searches, []);
  }
  assert.equal(h.upstream.length, 0);
  assert.equal(s.turns, 3);
  assert.deepEqual(h.bodies[2].input.filter(i => i.role === 'user').map(i => i.content), messages);
  assert.ok(h.bodies[2].input.some(i => i.role === 'assistant' && i.content === s.history[1].content));
  h.done();
});

test('personalidad: búsqueda, nuevo presupuesto y recomendación conservan datos, filtros y galerías', async () => {
  const a = fixture(91001, 1600, 17), b = fixture(91002, 4600, 11), s = state();
  const h = harness([
    tool('search_properties', args({ location: 'Miraflores', property_types: [2], operation: 2, currency: 'PEN', max_price: 1700 })),
    text('SOLO PRUEBA · presentación breve.'),
    tool('search_properties', args({ max_price: 5000 })),
    text('SOLO PRUEBA · presupuesto actualizado.'),
    tool('show_property', { property_id: null, result_index: 1 }),
    tool('show_property', { property_id: null, result_index: 2 }),
    text('SOLO PRUEBA · comparación con las fichas recuperadas.'),
  ], { properties: [a, b] });
  const first = await h.chat(s, 'Hola, busco un depa en alquiler en Miraflores hasta 1700 soles.');
  assert.deepEqual(first.properties.map(p => p.id), [a.id]);
  const second = await h.chat(s, 'Ahora puedo llegar a 5000.');
  const searches = h.upstream.filter(url => url.pathname.includes('/property/search/'));
  assert.equal(searches.length, 2);
  const payloads = searches.map(url => JSON.parse(url.searchParams.get('data')));
  assert.equal(payloads[0].price_to, 1700); assert.equal(payloads[1].price_to, 5000);
  for (const payload of payloads) {
    assert.deepEqual(payload.current_localization_id, [101]);
    assert.deepEqual(payload.operation_types, [2]); assert.deepEqual(payload.property_types, [2]);
    assert.equal(payload.currency, 'PEN'); assert.equal(payload.price_from, 0);
    assert.deepEqual(payload.filters, []);
  }
  assert.deepEqual(second.properties.map(p => p.id), [a.id, b.id]);
  const comparison = await h.chat(s, 'Estoy indeciso, ayúdame a comparar esas opciones.');
  assert.equal(h.upstream.filter(url => url.pathname.includes('/property/search/')).length, 2);
  assert.deepEqual(comparison.properties.map(p => p.resultIndex), [1, 2]);
  comparison.properties.forEach((p, index) => {
    const { resultIndex, ...data } = p;
    assert.deepEqual(data, normalizeProperty([a, b][index]));
  });
  const verified = context(h.bodies[4]);
  assert.deepEqual(context(h.bodies[0]).responseCards, []);
  assert.deepEqual(context(h.bodies[1]).responseCards, [{ propertyId: a.id, resultIndex: 1, photoCount: 17 }]);
  const expectedCards = [{ propertyId: a.id, resultIndex: 1, photoCount: 17 }, { propertyId: b.id, resultIndex: 2, photoCount: 11 }];
  assert.deepEqual(context(h.bodies[3]).responseCards, expectedCards);
  assert.deepEqual(verified.responseCards, []);
  assert.deepEqual(context(h.bodies[5]).responseCards, expectedCards.slice(0, 1));
  assert.deepEqual(context(h.bodies[6]).responseCards, expectedCards);
  assert.equal(verified.searchCriteria.max_price, 5000);
  assert.equal(verified.searchCriteria.location, 'Miraflores');
  assert.deepEqual(verified.lastResultIds, [a.id, b.id]);
  assert.deepEqual(verified.knownProperties.map(p => p.photoCount), [17, 11]);
  assert.equal(verified.knownProperties[0].bedrooms, 4);
  assert.equal(verified.knownProperties[0].description, undefined);
  assert.equal(verified.knownProperties[0].descriptionAvailable, true);
  assert.deepEqual(verified.knownProperties[1].operations, normalizeProperty(b).operations);
  const outputs = h.bodies[6].input.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output));
  assert.deepEqual(outputs.map(p => p.id), [a.id, b.id]);
  assert.deepEqual(outputs.map(p => p.photoCount), [17, 11]);
  assert.ok(outputs.every(p => p.galleryDisplayed));
  assert.ok(h.bodies[4].input.some(i => i.content === 'Ahora puedo llegar a 5000.'));
  h.done();
});

test('personalidad: un enlace de otro distrito se recupera y conserva su referencia sin cambiar la búsqueda', async () => {
  const a = fixture(91001, 1600, 17);
  const linked = fixture(92003, 2300, 16, { id: 202, name: 'Lince', full_location: 'Peru | Lima | Lima | Lince' });
  const s = state(); s.properties.set(a.id, normalizeProperty(a)); s.lastResultIds = [a.id];
  s.searchCriteria = validateSearch({ location: 'Miraflores', property_types: [2], operation: 2, currency: 'PEN', max_price: 5000 });
  const prior = structuredClone(s.searchCriteria);
  const h = harness([
    tool('get_property', { url: publication, property_id: null }), text('SOLO PRUEBA · análisis de publicación.'),
    tool('show_property', { property_id: linked.id, result_index: null }), text('SOLO PRUEBA · referencia posterior.'),
  ], { properties: [a], linked });
  const result = await h.chat(s, '¿Qué opinas de esta propiedad? ' + publication);
  assert.equal(result.properties[0].id, linked.id);
  assert.equal(result.properties[0].location, linked.location.full_location);
  assert.equal(result.properties[0].sourceUrl, publication);
  assert.deepEqual(result.properties[0].photos, normalizeProperty(linked).photos);
  assert.deepEqual(s.searchCriteria, prior); assert.deepEqual(s.lastResultIds, [a.id]);
  assert.equal(s.lastViewedPropertyId, linked.id);
  const followup = await h.chat(s, 'Enséñame otra vez las fotos de la que te pasé.');
  assert.equal(followup.properties[0].id, linked.id); assert.equal(followup.properties[0].photos.length, 16);
  assert.deepEqual(s.searchCriteria, prior);
  assert.equal(context(h.bodies[2]).lastViewedPropertyId, linked.id);
  assert.equal(h.upstream.length, 2);
  const linkCard = [{ propertyId: linked.id, resultIndex: null, photoCount: 16 }];
  assert.deepEqual(context(h.bodies[0]).responseCards, []);
  assert.deepEqual(context(h.bodies[1]).responseCards, linkCard);
  assert.deepEqual(context(h.bodies[2]).responseCards, []);
  assert.deepEqual(context(h.bodies[3]).responseCards, linkCard);
  assert.ok(!h.upstream.some(url => url.pathname.includes('/search/') || url.pathname.includes('/property/99900001/')));
  h.done();
});

test('personalidad: el backend no exige emojis ni recorta o reescribe respuestas por estilo o extensión', async () => {
  const s = state(), outputs = [
    'SOLO PRUEBA · respuesta sin emojis ni pregunta final.',
    'SOLO PRUEBA · comentario cercano 😊',
    'SOLO PRUEBA · explicación detallada.\n\n' + 'Información sintética para verificar la conservación íntegra de la respuesta. '.repeat(100).trimEnd(),
  ];
  const h = harness(outputs.map(text));
  for (let i = 0; i < outputs.length; i++) {
    const result = await h.chat(s, 'Turno sintético de estilo ' + i);
    assert.equal(result.message, outputs[i]);
    assert.equal(s.history.at(-1).content, outputs[i]);
  }
  assert.equal(h.upstream.length, 0); h.done();
});

test('voz: los ejemplos permanecen en instrucciones y no se insertan como diálogo ni datos de la sesión', async () => {
  const s = state(), published = fixture(93001, 2875, 16);
  s.properties.set(published.id, normalizeProperty(published));
  const response = 'SOLO PRUEBA · salida libre del modelo simulado.';
  const h = harness([text(response)]);
  const user = 'Hola, hoy solo quería saludar.';
  const result = await h.chat(s, user);
  assert.match(h.bodies[0].instructions, /Ejemplos de tono, no plantillas:/);
  assert.deepEqual(h.bodies[0].input, [{ role: 'user', content: user }]);
  assert.deepEqual(s.history, [{ role: 'user', content: user }, { role: 'assistant', content: response }]);
  const verified = context(h.bodies[0]).knownProperties[0];
  assert.equal(verified.description, undefined);
  assert.equal(verified.descriptionAvailable, true);
  assert.equal(verified.photoCount, 16);
  assert.deepEqual(verified.operations, normalizeProperty(published).operations);
  assert.equal(result.message, response);
  assert.deepEqual(result.properties, []);
  assert.equal(h.upstream.length, 0);
  h.done();
});

test('voz: un turno con humor y nuevo tope ejecuta los filtros indicados sin perder ubicación ni inventar fichas', async () => {
  const expensive = fixture(94001, 2600, 17), cheaper = fixture(94002, 1400, 11), s = state();
  s.properties.set(expensive.id, normalizeProperty(expensive)); s.lastResultIds = [expensive.id];
  s.searchCriteria = validateSearch({ location: 'Miraflores', property_types: [2], operation: 2, currency: 'PEN', max_price: 3000 });
  const message = 'Con ese precio mi chanchito pide vacaciones 😂. Mejor hasta 1500 soles.';
  // La decisión de llamar a search_properties está simulada: no se evalúa el humor del modelo.
  const h = harness([
    tool('search_properties', args({ max_price: 1500 })),
    text('SOLO PRUEBA · alternativa recuperada del proveedor simulado.'),
  ], { properties: [expensive, cheaper] });
  const result = await h.chat(s, message);
  const request = h.upstream.find(url => url.pathname.includes('/property/search/'));
  const data = JSON.parse(request.searchParams.get('data'));
  assert.equal(data.price_to, 1500); assert.equal(data.currency, 'PEN');
  assert.deepEqual(data.current_localization_id, [101]);
  assert.deepEqual(data.property_types, [2]); assert.deepEqual(data.operation_types, [2]);
  assert.deepEqual(result.properties.map(p => p.id), [cheaper.id]);
  assert.deepEqual(result.properties[0].photos, normalizeProperty(cheaper).photos);
  assert.deepEqual(result.properties[0].operations, normalizeProperty(cheaper).operations);
  assert.equal(s.searchCriteria.location, 'Miraflores'); assert.equal(s.searchCriteria.max_price, 1500);
  assert.ok(h.bodies[1].input.some(i => i.role === 'user' && i.content === message));
  h.done();
});

test('presentación: una consulta detallada recupera la descripción íntegra de la memoria sin consultar Tokko', async () => {
  const p = fixture(95001, 2700, 17), s = state();
  p.description += '\nSOLO PRUEBA · Condiciones publicadas adicionales. '.repeat(150);
  s.properties.set(p.id, normalizeProperty(p)); s.lastResultIds = [p.id]; s.lastViewedPropertyId = p.id;
  const h = harness([
    tool('get_property', { property_id: p.id, url: null }),
    text('SOLO PRUEBA · explicación solicitada con los datos completos guardados.'),
  ]);
  const result = await h.chat(s, 'Explícame sus características y las condiciones publicadas con detalle.');
  const verified = context(h.bodies[0]);
  assert.deepEqual(verified.responseCards, []);
  assert.equal(verified.knownProperties[0].description, undefined);
  assert.deepEqual(verified.propertyDetails, []);
  assert.ok(p.description.length > 5000);
  const detailed = context(h.bodies[1]);
  assert.deepEqual(detailed.propertyDetails, [{ id: p.id, description: p.description.trim() }]);
  assert.deepEqual(detailed.responseCards, []);
  assert.deepEqual(verified.knownProperties[0].operations, normalizeProperty(p).operations);
  assert.equal(verified.knownProperties[0].photoCount, 17);
  assert.deepEqual(s.properties.get(p.id), normalizeProperty(p));
  assert.deepEqual(result.properties, []);
  assert.deepEqual(s.properties.get(p.id).photos, normalizeProperty(p).photos);
  assert.equal(h.upstream.length, 0);
  h.done();
});

test('presentación: vacío y error mantienen sus estados sin anunciar fichas recordadas como nuevas', async () => {
  for (const failure of [false, true]) {
    const s = state(), previous = normalizeProperty(fixture(95002, 2700, 16));
    s.properties.set(previous.id, previous); s.lastResultIds = [previous.id];
    const bodies = []; let searches = 0;
    const responses = [tool('search_properties', args({ location: 'Miraflores', currency: 'PEN', max_price: 1000 })), text('SOLO PRUEBA · estado de herramienta simulado.')];
    const chat = createChat({ apiKey: 'synthetic-key', tokko: { search: async filters => {
      searches++;
      if (failure) throw new AppError('SOLO PRUEBA · fallo del proveedor.', 502, 'synthetic_provider_error');
      return { properties: [], filters, nextOffset: null };
    } }, fetchImpl: async (url, options) => {
      assert.equal(url, 'https://api.openai.com/v1/responses');
      bodies.push(JSON.parse(options.body));
      assert.ok(responses.length, 'No se permiten peticiones adicionales');
      return json(responses.shift());
    } });
    const result = await chat(s, 'Busca otra opción hasta 1000 soles.');
    const verified = context(bodies[1]), output = JSON.parse(bodies[1].input.at(-1).output);
    assert.deepEqual(verified.responseCards, []);
    assert.equal(verified.knownProperties[0].id, previous.id);
    assert.equal(verified.lastSearchAttempt.status, failure ? 'error' : 'no_matches');
    assert.equal(output.status, failure ? 'error' : 'no_matches');
    assert.deepEqual(result.properties, []);
    assert.equal(result.searches.length, failure ? 0 : 1);
    assert.equal(searches, 1); assert.equal(responses.length, 0);
  }
});

test('presentación: una ficha sin fotos informa cero y conserva sus demás datos publicados', async () => {
  const p = fixture(95003, 2700, 0), s = state();
  const h = harness([
    tool('search_properties', args({ location: 'Miraflores', property_types: [2], operation: 2, currency: 'PEN', max_price: 3000 })),
    text('SOLO PRUEBA · ficha sintética sin imágenes.'),
  ], { properties: [p] });
  const result = await h.chat(s, 'Busca un departamento de alquiler en Miraflores hasta 3000 soles.');
  assert.deepEqual(context(h.bodies[1]).responseCards, [{ propertyId: p.id, resultIndex: 1, photoCount: 0 }]);
  const { resultIndex, ...published } = result.properties[0];
  assert.deepEqual(published, normalizeProperty(p));
  assert.deepEqual(published.photos, []);
  const toolOutput = JSON.parse(h.bodies[1].input.at(-1).output);
  assert.equal(toolOutput.properties[0].description, undefined);
  assert.equal(context(h.bodies[1]).knownProperties[0].descriptionAvailable, true);
  assert.equal(toolOutput.properties[0].photoCount, 0);
  h.done();
});

test('iniciativa: alquiler por distrito sin presupuesto ejecuta filtros parciales y conserva ficha y fotos', async () => {
  const p = fixture(96001, 2700, 17), s = state();
  const h = harness([
    tool('search_properties', args({ location: 'Miraflores', property_types: [2], operation: 2 })),
    text('SOLO PRUEBA · opción del proveedor simulado.'),
    tool('show_property', { property_id: null, result_index: 1 }),
    text('SOLO PRUEBA · ficha que el cliente aceptó ver.'),
  ], { properties: [p] });
  const first = await h.chat(s, 'Me gustaría alquilar un departamento en Miraflores; vi un anuncio, pero no tengo el enlace.');
  const search = h.upstream.find(url => url.pathname.includes('/property/search/'));
  const data = JSON.parse(search.searchParams.get('data'));
  assert.deepEqual(data.current_localization_id, [101]); assert.deepEqual(data.operation_types, [2]);
  assert.deepEqual(data.property_types, [2]); assert.equal(data.currency, 'ANY');
  assert.equal(data.price_from, 0); assert.equal(data.price_to, 999999999);
  assert.deepEqual(data.filters, []);
  assert.equal(s.searchCriteria.max_price, null); assert.equal(s.searchCriteria.currency, null);
  const { resultIndex, ...published } = first.properties[0];
  assert.deepEqual(published, normalizeProperty(p)); assert.equal(published.photos.length, 17);
  assert.equal(h.upstream.some(url => url.hostname === 'gruporentabilizarme.com'), false);
  const accepted = await h.chat(s, 'Sí, a ver, muéstrame.');
  assert.equal(accepted.properties[0].id, p.id);
  assert.equal(h.upstream.filter(url => url.pathname.includes('/property/search/')).length, 1);
  assert.deepEqual(context(h.bodies[3]).responseCards, [{ propertyId: p.id, resultIndex: 1, photoCount: 17 }]);
  h.done();
});

test('iniciativa: recomendar conserva el historial incluso cuando la petición anterior no llamó herramientas', async () => {
  const p = fixture(96002, 2900, 16), s = state();
  const firstRequest = 'Busco un departamento en alquiler en Miraflores.';
  const h = harness([
    text('SOLO PRUEBA · turno anterior sin búsqueda.'),
    tool('search_properties', args({ location: 'Miraflores', property_types: [2], operation: 2 })),
    text('SOLO PRUEBA · recomendación con ficha recuperada.'),
  ], { properties: [p] });
  await h.chat(s, firstRequest);
  assert.equal(s.searchCriteria, null);
  const result = await h.chat(s, 'Mmmmm, no sé, ¿qué me recomiendas tú?');
  assert.ok(h.bodies[1].input.some(i => i.role === 'user' && i.content === firstRequest));
  assert.deepEqual(context(h.bodies[1]).responseCards, []);
  const data = JSON.parse(h.upstream.find(url => url.pathname.includes('/property/search/')).searchParams.get('data'));
  assert.deepEqual(data.current_localization_id, [101]); assert.deepEqual(data.operation_types, [2]);
  assert.deepEqual(data.property_types, [2]); assert.equal(data.currency, 'ANY');
  assert.equal(result.properties[0].id, p.id); assert.equal(result.properties[0].photos.length, 16);
  assert.deepEqual(context(h.bodies[2]).responseCards, [{ propertyId: p.id, resultIndex: 1, photoCount: 16 }]);
  h.done();
});

test('iniciativa: un saludo después de una búsqueda no repite consultas ni adjunta nuevas fichas', async () => {
  const p = fixture(96003, 1900, 11), s = state();
  s.properties.set(p.id, normalizeProperty(p)); s.lastResultIds = [p.id];
  s.searchCriteria = validateSearch({ location: 'Miraflores', operation: 2 });
  const prior = structuredClone(s.searchCriteria);
  const h = harness([text('SOLO PRUEBA · saludo libre del modelo simulado.')]);
  const result = await h.chat(s, 'Hola de nuevo, ¿qué tal?');
  assert.deepEqual(result.properties, []); assert.deepEqual(result.searches, []);
  assert.deepEqual(s.searchCriteria, prior); assert.equal(h.upstream.length, 0);
  h.done();
});
