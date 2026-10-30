// SOLO PRUEBA: proveedor y decisiones del modelo simulados, sin acceso a APIs reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, TOOLS, propertyContext } from '../lib/chat.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';

const fixture = (id, price, photoCount) => normalizeProperty({
  id, publication_title: 'SOLO PRUEBA · Departamento ' + id, reference_code: 'TEST-' + id,
  fake_address: 'Dirección sintética', location: { full_location: 'Peru | Lima | Lima | Miraflores' },
  type: { id: 2, name: 'Departamento' },
  description: ('SOLO PRUEBA · Condiciones exclusivas del inmueble ' + id + '. ').repeat(150) + 'FINAL-' + id,
  total_surface: 130, roofed_surface: 110, surface_measurement: 'M2',
  suite_amount: 4, room_amount: 5, bathroom_amount: 2, parking_lot_amount: 1,
  tags: [{ name: 'Terraza' }],
  operations: [{ operation_id: 2, operation_type: 'Alquiler', prices: [{ price, currency: 'PEN', period: 1 }] }],
  photos: Array.from({ length: photoCount }, (_, i) => ({ original: 'https://photos.example.test/' + id + '/' + i + '.jpg', description: 'SOLO PRUEBA ' + i })),
});
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const call = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: name, arguments: JSON.stringify(args) }] });
const answer = () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'SOLO PRUEBA · Respuesta simulada.' }] }] });
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
const outputs = body => body.input.filter(item => item.type === 'function_call_output').map(item => JSON.parse(item.output));
const searchArgs = changes => Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) =>
  [key, key in changes ? changes[key] : schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
function harness(sequence, tokko) {
  const bodies = [];
  return { bodies, chat: createChat({ apiKey: 'synthetic-key', tokko, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    bodies.push(JSON.parse(options.body));
    assert.ok(sequence.length, 'No se permiten llamadas adicionales');
    return new Response(JSON.stringify(sequence.shift()));
  } }), done: () => assert.equal(sequence.length, 0) };
}
function descriptions(value) {
  if (!value || typeof value !== 'object') return [];
  return Object.entries(value).flatMap(([key, item]) => key === 'description' ? [item] : descriptions(item));
}

test('contexto: búsqueda inicial usa un único resumen por ID y referencias; fichas y fotos permanecen completas', async () => {
  const a = fixture(98001, 1700, 11), b = fixture(98002, 5000, 16), session = state();
  const original = structuredClone([a, b]);
  let calls = 0;
  const h = harness([
    call('search_properties', searchArgs({ location: 'Miraflores', operation: 2, property_types: [2], currency: 'PEN', max_price: 5000 })),
    answer(),
  ], { search: async filters => { calls++; return { properties: [a, b], filters, nextOffset: 5, partialFeatureScan: false }; } });
  const result = await h.chat(session, 'SOLO PRUEBA: muéstrame opciones en Miraflores hasta 5000 soles.');
  assert.deepEqual(context(h.bodies[0]).knownProperties, []);
  const verified = context(h.bodies[1]), output = outputs(h.bodies[1])[0];
  const refs = [{ id: a.id, photoCount: 11 }, { id: b.id, photoCount: 16 }];
  assert.deepEqual(verified.lastSearch.properties, refs);
  assert.deepEqual(output.properties, refs);
  assert.equal(output.status, 'matches');
  assert.equal(verified.lastSearch.nextOffset, 5);
  assert.deepEqual(verified.lastResultIds, [a.id, b.id]);
  assert.deepEqual(verified.propertyDetails, []);
  assert.deepEqual(descriptions([verified, output]), []);
  assert.deepEqual(verified.knownProperties.map(p => p.id), [a.id, b.id]);
  for (const [index, originalProperty] of original.entries()) {
    const { description, photos, ...structuredData } = originalProperty;
    assert.deepEqual(verified.knownProperties[index], { ...structuredData, descriptionAvailable: true, photoCount: photos.length });
    const { resultIndex, ...card } = result.properties[index];
    assert.equal(resultIndex, index + 1);
    assert.deepEqual(card, originalProperty);
    assert.deepEqual(session.properties.get(originalProperty.id), originalProperty);
  }
  assert.deepEqual([a, b], original, 'No se modifican las respuestas del proveedor');
  assert.equal(calls, 1);
  assert.equal(verified.searchCriteria.max_price, 5000);
  assert.equal(verified.searchCriteria.currency, 'PEN');
  assert.equal(verified.searchCriteria.operation, 2);
  assert.equal(verified.searchCriteria.location, 'Miraflores');
  assert.deepEqual(verified.searchCriteria.property_types, [2]);
  assert.deepEqual(verified.responseCards, result.properties.map(p => ({ propertyId: p.id, resultIndex: p.resultIndex, photoCount: p.photos.length })));
  h.done();
});

test('contexto: comparación recupera detalles íntegros una vez por ID desde memoria y conserva referencias posteriores', async () => {
  const a = fixture(98101, 1700, 11), b = fixture(98102, 5000, 16), session = state();
  session.properties = new Map([[a.id, a], [b.id, b]]);
  session.lastResultIds = [a.id, b.id];
  session.lastSearch = { filters: { location: 'Miraflores', operation: 2, currency: 'PEN', max_price: 5000 }, properties: [a, b], nextOffset: null };
  session.lastViewedPropertyId = b.id;
  const initialCriteria = structuredClone(session.lastSearch.filters);
  const h = harness([
    call('get_property', { url: null, property_id: a.id }),
    call('get_property', { url: null, property_id: a.id }),
    call('get_property', { url: null, property_id: b.id }),
    answer(), answer(),
    call('show_property', { property_id: null, result_index: 2 }), answer(),
  ], {
    search: () => assert.fail('Una consulta conocida no requiere búsqueda'),
    detail: () => assert.fail('Los detalles conocidos se recuperan del servidor local'),
  });
  await h.chat(session, 'SOLO PRUEBA: compara las condiciones completas de estas dos opciones.');
  const detailed = context(h.bodies[3]);
  assert.ok(a.description.length > 5000);
  assert.deepEqual(detailed.propertyDetails, [a, b].map(p => ({ id: p.id, description: p.description })));
  const allDescriptions = descriptions([detailed, outputs(h.bodies[3])]);
  assert.deepEqual(allDescriptions, [a.description, b.description]);
  assert.equal(detailed.knownProperties[0].operations[0].prices[0].amount, 1700);
  assert.equal(detailed.knownProperties[1].operations[0].prices[0].amount, 5000);
  assert.deepEqual(detailed.responseCards, []);
  assert.deepEqual(session.lastResultIds, [a.id, b.id]);
  assert.equal(session.lastViewedPropertyId, b.id);
  assert.deepEqual(session.searchCriteria, initialCriteria);
  await h.chat(session, 'SOLO PRUEBA: gracias.');
  const next = context(h.bodies[4]);
  assert.deepEqual(next.propertyDetails, []);
  assert.deepEqual(next.responseCards, []);
  assert.deepEqual(descriptions(next), []);
  assert.deepEqual(next.lastResultIds, [a.id, b.id]);
  const shown = await h.chat(session, 'SOLO PRUEBA: muéstrame todas las fotos de la segunda.');
  assert.equal(shown.properties[0].id, b.id);
  assert.equal(shown.properties[0].resultIndex, 2);
  assert.deepEqual(shown.properties[0].photos, b.photos);
  assert.deepEqual(context(h.bodies[6]).propertyDetails, []);
  assert.deepEqual(descriptions([context(h.bodies[6]), outputs(h.bodies[6])]), []);
  assert.equal(session.properties.get(a.id).description, a.description);
  assert.equal(session.properties.get(b.id).description, b.description);
  h.done();
});

test('contexto: enlace oficial incorpora detalles una sola vez sin confundir sus IDs con el último listado', async () => {
  const previous = fixture(98201, 1700, 11), linked = fixture(98202, 5000, 16), session = state();
  linked.sourceUrl = 'https://gruporentabilizarme.com/Propiedades/Detalle?id=99988877';
  session.properties.set(previous.id, previous);
  session.lastResultIds = [previous.id];
  let resolved = 0;
  const h = harness([call('get_property', { url: linked.sourceUrl, property_id: null }), answer()], {
    fromUrl: async url => { assert.equal(url, linked.sourceUrl); resolved++; return linked; },
  });
  const result = await h.chat(session, 'SOLO PRUEBA: analiza esta publicación oficial.');
  const verified = context(h.bodies[1]);
  assert.deepEqual(descriptions([verified, outputs(h.bodies[1])]), [linked.description]);
  assert.deepEqual(verified.propertyDetails, [{ id: linked.id, description: linked.description }]);
  assert.deepEqual(verified.lastResultIds, [previous.id]);
  assert.equal(verified.lastViewedPropertyId, linked.id);
  assert.equal(verified.knownProperties[1].sourceUrl, linked.sourceUrl);
  assert.deepEqual(result.properties, [{ ...linked, resultIndex: null }]);
  assert.equal(resolved, 1);
  h.done();
});

test('contexto: ausencia de descripción y fotos se informa sin inventar atributos ni alterar la ficha', async () => {
  const empty = normalizeProperty({ id: 98301, publication_title: 'SOLO PRUEBA' }), session = state();
  session.properties.set(empty.id, empty);
  const h = harness([call('get_property', { url: null, property_id: empty.id }), answer()], {
    detail: () => assert.fail('La ficha ya es conocida'),
  });
  const result = await h.chat(session, 'SOLO PRUEBA: consulta sus condiciones publicadas.');
  const verified = context(h.bodies[1]);
  assert.equal(propertyContext(empty).descriptionAvailable, false);
  assert.deepEqual(verified.propertyDetails, [{ id: empty.id, description: '' }]);
  assert.equal(verified.knownProperties[0].photoCount, 0);
  assert.deepEqual(verified.knownProperties[0].features, []);
  assert.deepEqual(result.properties, []);
  assert.deepEqual(session.properties.get(empty.id), empty);
  h.done();
});
