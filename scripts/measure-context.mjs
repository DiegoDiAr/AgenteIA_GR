// SOLO PRUEBA: datos y decisiones sintéticos; ninguna conexión externa.
import assert from 'node:assert/strict';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';

const description = 'SOLO PRUEBA · Condiciones publicadas sintéticas. '.repeat(100).slice(0, 2100);
const property = normalizeProperty({
  id: 99001, publication_title: 'SOLO PRUEBA · Departamento sintético',
  reference_code: 'SOLO-PRUEBA', fake_address: 'Dirección sintética',
  location: { full_location: 'Peru | Lima | Lima | Miraflores' },
  type: { id: 2, name: 'Departamento' }, description,
  suite_amount: 3, room_amount: 4, bathroom_amount: 2, parking_lot_amount: 1,
  total_surface: 130, surface_measurement: 'M2', tags: [{ name: 'Terraza' }],
  operations: [{ operation_id: 2, operation_type: 'Alquiler', prices: [{ price: 4200, currency: 'PEN' }] }],
  photos: Array.from({ length: 11 }, (_, i) => ({ original: 'https://photos.example.test/' + i + '.jpg' })),
});
const search = Object.fromEntries(Object.entries(TOOLS[0].parameters.properties).map(([key, schema]) =>
  [key, schema.type === 'array' ? [] : key === 'offset' ? 0 : null]));
Object.assign(search, { location: 'Miraflores', property_types: [2], operation: 2 });
const tool = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: name, arguments: JSON.stringify(args) }] });
const answer = { status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'SOLO PRUEBA · Respuesta simulada.' }] }] };
const responses = [tool('search_properties', search), answer, tool('get_property', { url: null, property_id: property.id }), answer];
const bodies = [];
let searches = 0, details = 0;
const chat = createChat({
  apiKey: 'synthetic-key',
  tokko: {
    search: async filters => { searches++; return { properties: [property], filters, nextOffset: null }; },
    detail: async () => { details++; return property; },
  },
  fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    bodies.push(JSON.parse(options.body));
    assert.ok(responses.length, 'No se permiten llamadas adicionales');
    return new Response(JSON.stringify(responses.shift()));
  },
});
const session = { history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 };
await chat(session, 'SOLO PRUEBA: busco un departamento de alquiler en Miraflores.');
await chat(session, 'SOLO PRUEBA: explica las condiciones publicadas de esa propiedad.');
function countDescriptions(value) {
  if (!value || typeof value !== 'object') return 0;
  return Object.entries(value).reduce((sum, [key, item]) =>
    sum + (key === 'description' && item === property.description ? 1 : countDescriptions(item)), 0);
}
function measure(body) {
  const context = JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
  const outputs = body.input.filter(i => i.type === 'function_call_output').map(i => JSON.parse(i.output));
  const bytes = value => Buffer.byteLength(JSON.stringify(value), 'utf8');
  return { requestBytes: bytes(body), contextAndToolBytes: bytes(context) + outputs.reduce((sum, item) => sum + bytes(item), 0), descriptionCopies: countDescriptions(context) + countDescriptions(outputs) };
}
console.log(JSON.stringify({
  synthetic: true, descriptionCharacters: property.description.length,
  beforeSearch: measure(bodies[0]), afterSearch: measure(bodies[1]),
  beforeDetails: measure(bodies[2]), afterDetails: measure(bodies[3]),
  providerCalls: { search: searches, detail: details },
}, null, 2));
