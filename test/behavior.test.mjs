// Proveedores programados y datos SINTÉTICOS de prueba. No se llama a APIs reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createTokko, validateSearch } from '../lib/tokko.mjs';
import { createChat, TOOLS } from '../lib/chat.mjs';

const json = value => new Response(JSON.stringify(value));
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const answer = text => ({ status: 'completed', output: [{ type: 'message', role: 'assistant', content: [{ type: 'output_text', text }] }] });
const call = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: 'synthetic-call', arguments: JSON.stringify(args) }] });
const allFields = changes => Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) => [key, key in changes ? changes[key] : schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
const lima = { id: 600, name: 'Lima', full_location: 'Peru | Lima | Lima' };
const district = (name, id = 701) => ({ id, name, full_location: `Peru | Lima | Lima | ${name}` });
const property = (id, { type = { id: 2, name: 'Departamento' }, location = district('Lince'), price = 1700 } = {}) => ({
  id, publication_title: `SOLO PRUEBA · Inmueble sintético ${id}`, location, type,
  description: 'Descripción sintética para verificar recomendaciones con datos del proveedor.',
  suite_amount: 1, bathroom_amount: 1, total_surface: '50.00', surface_measurement: 'M2', web_price: true,
  operations: [{ operation_id: 2, operation_type: 'Alquiler', prices: [{ currency: 'PEN', price }] }],
  photos: Array.from({ length: id === 101 ? 10 : 7 }, (_, index) => ({ original: `https://photos.example.test/fixture-${id}/${index}.jpg` })),
});
function provider({ locations = [district('Lince')], properties = [property(101)], requests = [] } = {}) {
  return async url => {
    const parsed = new URL(url);
    requests.push(parsed);
    if (parsed.pathname.includes('quicksearch')) return json({ objects: locations });
    if (parsed.pathname === `/api/v1/location/${lima.id}/`) return json({ ...lima, state: '/api/v1/state/900/' });
    if (parsed.pathname.includes('/property/search/')) {
      const data = JSON.parse(parsed.searchParams.get('data'));
      // Reproduce la incompatibilidad encontrada en Tokko, no acepta boolean true.
      const found = data.only_available === 'checked' ? properties.filter(p => !data.property_types.length || data.property_types.includes(p.type.id)) : [];
      return json({ objects: found, meta: { total_count: found.length, next: null } });
    }
    const id = Number(parsed.pathname.match(/\/property\/(\d+)\//)?.[1]);
    const p = properties.find(p => p.id === id); assert.ok(p, 'Solo se consultan IDs del proveedor simulado'); return json(p);
  };
}
const searchRequest = requests => requests.find(url => url.pathname.includes('/property/search/'));

test('filtros parciales no requieren presupuesto, operación ni detalles de habitación', () => {
  const partial = validateSearch({ location: 'Lima', property_types: [3] });
  assert.equal(partial.max_price, null); assert.equal(partial.operation, null); assert.equal(partial.min_bedrooms, null);
  assert.deepEqual(validateSearch({}).property_types, []);
  assert.deepEqual(validateSearch({ property_types: [27] }).property_types, [27]);
});

test('el esquema strict permite null y [] sin convertirlos en requisitos del cliente', () => {
  const schema = TOOLS[0].parameters;
  assert.equal(schema.additionalProperties, false);
  for (const [key, field] of Object.entries(schema.properties)) {
    assert.ok(schema.required.includes(key));
    if (key !== 'offset' && field.type !== 'array') assert.ok(field.type.includes('null'));
  }
  assert.match(TOOLS[0].description, /No exige tipo, operación, presupuesto/);
  assert.match(TOOLS[0].parameters.properties.property_types.description, /12 nave industrial \(almacén\)/);
});

test('Lima sin distrito resuelve la región del proveedor y no el barrio hijo llamado Lima', async () => {
  const requests = [];
  const locations = [{ id: 10, name: 'Lima', full_location: 'Argentina | Buenos Aires | Lima' }, { id: 11, name: 'LIMA', full_location: 'Peru | Lima | Lima | San Miguel | LIMA' }, lima];
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ locations, properties: [property(101, { type: { id: 3, name: 'Casa' } })], requests }) });
  const result = await tokko.search({ property_types: [3] });
  const data = JSON.parse(searchRequest(requests).searchParams.get('data'));
  assert.equal(data.current_localization_type, 'state'); assert.deepEqual(data.current_localization_id, [900]);
  assert.equal(data.currency, 'ANY'); assert.deepEqual(data.operation_types, [1, 2, 3]); assert.deepEqual(data.filters, []);
  assert.equal(result.properties.length, 1); assert.equal(result.filters.location, 'Lima, Perú');
});

test('resuelve Lince en Lima frente a homónimos y busca con el presupuesto sin exigir otros filtros', async () => {
  const requests = [];
  const locations = [district('Lince'), { id: 99, name: 'Lince', full_location: 'México | Chihuahua | Juárez | Lince' }, { id: 98, name: 'Lince', full_location: 'Argentina | San Luis | Capital | Lince' }];
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ locations, requests }) });
  const result = await tokko.search({ location: 'Lince, Lima, Perú', operation: 2, max_price: 1700, currency: 'PEN' });
  assert.equal(result.needsLocation, undefined); assert.equal(result.properties.length, 1);
  const data = JSON.parse(searchRequest(requests).searchParams.get('data'));
  assert.deepEqual(data.current_localization_id, [701]); assert.deepEqual(data.operation_types, [2]); assert.deepEqual(data.property_types, []);
  assert.equal(data.price_to, 1700); assert.equal(data.price_from, 0); assert.equal(data.currency, 'PEN'); assert.deepEqual(data.filters, []);
  assert.equal(data.only_available, 'checked'); assert.equal(result.properties[0].photos.length, 10);
});

test('cualquier distrito publicado por Tokko se puede consultar sin lista cerrada', async t => {
  for (const name of ['Lince', 'Villa el Salvador', 'Pachacamac', 'Distrito sintético fuera de cualquier lista']) await t.test(name, async () => {
    const requests = [], location = district(name, 314159);
    const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ locations: [location], properties: [property(101, { location })], requests }) });
    const result = await tokko.search({ location: name });
    assert.equal(result.properties.length, 1); assert.deepEqual(JSON.parse(searchRequest(requests).searchParams.get('data')).current_localization_id, [314159]);
  });
});

test('ubicaciones duplicadas de Tokko con la misma jerarquía no piden una calle', async () => {
  const requests = [];
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ locations: [district('Cieneguilla', 10), district('Cieneguilla', 20)], properties: [property(101, {location:district('Cieneguilla',10)})], requests }) });
  const result = await tokko.search({ location: 'Cieneguilla' });
  assert.equal(result.properties.length, 1); assert.deepEqual(JSON.parse(searchRequest(requests).searchParams.get('data')).current_localization_id, [10, 20]);
});

test('almacenes usan Nave Industrial y todos los tipos incluye IDs actuales mayores que 25', async () => {
  const requests = [], warehouse = property(101, { type: { id: 12, name: 'Nave Industrial' } }), industrialLand = property(202, { type: { id: 27, name: 'Terreno industrial' } });
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ locations: [lima], properties: [warehouse, industrialLand], requests }) });
  const warehouses = await tokko.search({ location: 'Lima', property_types: [12] });
  assert.equal(warehouses.properties.length, 1); assert.equal(warehouses.properties[0].typeId, 12);
  assert.deepEqual(JSON.parse(searchRequest(requests).searchParams.get('data')).property_types, [12]);
  requests.length = 0;
  const all = await tokko.search({ location: 'Lima' });
  assert.deepEqual(JSON.parse(searchRequest(requests).searchParams.get('data')).property_types, []); assert.deepEqual(all.properties.map(p => p.typeId), [12, 27]);
});

test('una ubicación fuera de Lima no se ofrece como catálogo comercial actual', async () => {
  const requests = [];
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ locations: [{ id: 123, name: 'Trujillo', full_location: 'Peru | La Libertad | Trujillo' }], requests }) });
  const result = await tokko.search({ location: 'Trujillo' });
  assert.equal(result.outsideCoverage, true); assert.deepEqual(result.properties, []); assert.equal(searchRequest(requests), undefined);
});

test('contexto, recomendaciones y fotos mantienen propiedades del proveedor sin nuevas preguntas obligatorias', async () => {
  const s = state(), requests = [], p = [property(101), property(202, { price: 1600 })];
  // Conversación previa realista; se comprueba que el backend no pierde esa información.
  s.history = [{ role: 'user', content: 'Estoy buscando una propiedad en Lima.' }, { role: 'assistant', content: 'Puedo ayudarte a explorar el catálogo.' }];
  const criteria = allFields({ location: 'Lince, Lima, Perú', operation: 2, currency: 'PEN', max_price: 1700 });
  const sequence = [call('search_properties', criteria), answer('Dos opciones sintéticas dentro del presupuesto.'), answer('La opción 1 se ajusta por precio y ubicación; la opción 2 cuesta menos.'), call('show_property', { property_id: null, result_index: 2 }), answer('Estas son las fotografías de la segunda opción sintética.')];
  let index = 0;
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ properties: p, requests }) });
  const chat = createChat({ apiKey: 'synthetic-key', tokko, fetchImpl: async (_, options) => {
    const body = JSON.parse(options.body);
    assert.equal(body.tool_choice, 'auto');
    assert.ok(body.input.some(item => item.content === 'Estoy buscando una propiedad en Lima.'));
    assert.match(body.instructions, /No exijas calle, microzona, dormitorios, baños, estacionamiento ni superficie/);
    assert.match(body.instructions, /No vuelvas a preguntar información conocida/);
    assert.match(body.instructions, /No ofrece propiedades en Trujillo actualmente/);
    assert.match(body.instructions, /analiza los resultados reales/);
    if (index === 2) {
      assert.match(body.instructions, /1700/); assert.match(body.instructions, /Lince/); assert.match(body.instructions, /PEN/);
      assert.match(body.instructions, /1600/); assert.match(body.instructions, /SOLO PRUEBA/);
    }
    return json(sequence[index++]);
  } });
  const found = await chat(s, 'Me gustaría alquilar en Lince de 1700 soles.');
  assert.equal(found.properties.length, 2); assert.equal(s.lastSearch.filters.max_price, 1700); assert.equal(s.lastSearch.filters.operation, 2);
  await chat(s, 'No sé, recomiéndame porfa.');
  assert.equal(requests.filter(url => url.pathname.includes('/property/search/')).length, 1);
  const photos = await chat(s, 'Muéstrame las fotos de la segunda propiedad.');
  assert.equal(photos.properties[0].id, 202); assert.equal(photos.properties[0].photos.length, 7);
  assert.ok(photos.properties[0].photos.every(photo => photo.url.includes('/fixture-202/')));
  assert.deepEqual(s.lastResultIds, [101, 202]); assert.equal(index, sequence.length);
});

test('consulta sin coincidencias conserva criterios y no fabrica recomendaciones ni fotos', async () => {
  const tokko = createTokko({ apiKey: 'synthetic-key', fetchImpl: provider({ properties: [] }) });
  const result = await tokko.search({ location: 'Lince', max_price: 1700, currency: 'PEN', operation: 2 });
  assert.deepEqual(result.properties, []); assert.equal(result.nextOffset, null); assert.equal(result.filters.max_price, 1700);
});

test('una búsqueda vacía permite explorar una alternativa en el mismo turno', async () => {
  const s = state(); let searches = 0, step = 0;
  const sequence = [call('search_properties', allFields({ location: 'Lince', operation: 2, currency: 'PEN', max_price: 1500 })), call('search_properties', allFields({ location: 'Lince', operation: 2, currency: 'PEN', max_price: 1700 })), answer('No hay opciones sintéticas hasta 1500; esta alternativa sintética cuesta 1700 y supera ese presupuesto.')];
  const data = property(101);
  const { normalizeProperty } = await import('../lib/tokko.mjs');
  const chat = createChat({ apiKey: 'synthetic-key', tokko: { search: async args => ({ properties: ++searches === 1 ? [] : [normalizeProperty(data)], filters: args, nextOffset: null }) }, fetchImpl: async () => json(sequence[step++]) });
  const result = await chat(s, 'Busca hasta 1500 soles en Lince; si no hay, enséñame opciones cercanas a ese monto e indica la diferencia.');
  assert.equal(searches, 2); assert.equal(result.properties.length, 1); assert.equal(result.properties[0].operations[0].prices[0].amount, 1700);
});
