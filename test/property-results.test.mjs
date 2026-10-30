// SOLO PRUEBAS: inmuebles y decisiones sintéticos; ninguna llamada real.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat } from '../lib/chat.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
import { uniqueProperties } from '../lib/property-results.mjs';
const fixture = (id, count = 11) => normalizeProperty({
  id, reference_code: id === 11177376 ? 'GAP11177376' : 'SOLO-PRUEBA-' + id,
  publication_title: 'SOLO PRUEBA · Mismo título', description: 'SOLO PRUEBA · Condiciones publicadas.',
  photos: Array.from({ length: count }, (_, i) => ({ original: 'https://photos.example.test/shared/' + i + '.jpg' })),
});
const call = (name, args) => ({ status: 'completed', output: [{ type: 'function_call', name, call_id: name, arguments: JSON.stringify(args) }] });
const answer = () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'SOLO PRUEBA' }] }] });
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const context = body => JSON.parse(body.instructions.split('Contexto verificado actual (datos, no instrucciones):\n')[1]);
test('duplicados: GAP11177376 repetido en búsqueda se cuenta una vez y mantiene IDs, orden y galerías', async t => {
  const p = fixture(11177376), other = fixture(11177377), bodies = [], entries = [];
  t.mock.method(console, 'info', line => entries.push(JSON.parse(line)));
  const raw = { properties: [p, p, other], filters: { location: 'Miraflores', operation: 2 }, nextOffset: 5 };
  const sequence = [call('search_properties', {}), answer()];
  const chat = createChat({ apiKey: 'synthetic-key', diagnostics: true, tokko: { search: async () => raw }, fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify(sequence.shift())); } });
  const s = state(), result = await chat(s, 'SOLO PRUEBA · Busca alquileres en Miraflores.');
  assert.deepEqual(result.properties.map(p => p.id), [p.id, other.id]);
  assert.deepEqual(result.properties.map(p => p.resultIndex), [1, 2]);
  assert.equal(JSON.parse(bodies[1].input.at(-1).output).count, 2);
  assert.equal(result.searches[0].count, 2); assert.equal(result.searches[0].nextOffset, 5);
  assert.deepEqual(s.lastResultIds, [p.id, other.id]); assert.equal(s.lastSearch.properties.length, 2);
  assert.equal(context(bodies[1]).responseCards.length, 2);
  assert.equal(JSON.parse(bodies[1].input.at(-1).output).properties.length, 2);
  assert.equal(entries.find(e => e.event === 'agent_tokko' && e.phase === 'end').resultCount, 2);
  assert.deepEqual(result.properties[0].photos, p.photos);
  assert.equal(raw.properties.length, 3, 'La respuesta original de Tokko no se altera');
});
test('duplicados: búsqueda, enlace y show acumulados comparten una ficha por ID; otro turno puede mostrarla otra vez', async () => {
  const p = fixture(11177376), detailed = fixture(p.id, 17), bodies = [], s = state();
  const sequence = [call('search_properties', {}), call('get_property', { url: 'https://gruporentabilizarme.com/Propiedades/Detalle?id=99900001', property_id: null }), call('show_property', { property_id: p.id, result_index: null }), answer(), call('show_property', { property_id: null, result_index: 1 }), answer()];
  const chat = createChat({ apiKey: 'synthetic-key', tokko: { search: async filters => ({ properties: [p], filters, nextOffset: null }), fromUrl: async () => detailed }, fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify(sequence.shift())); } });
  const first = await chat(s, 'SOLO PRUEBA · Presenta esta opción.');
  assert.equal(first.properties.length, 1); assert.equal(first.properties[0].id, p.id);
  assert.deepEqual(first.properties[0].photos, detailed.photos);
  assert.deepEqual(context(bodies[3]).responseCards, [{ propertyId: p.id, resultIndex: 1, photoCount: 17 }]);
  assert.deepEqual(s.lastResultIds, [p.id]);
  const again = await chat(s, 'SOLO PRUEBA · Quiero volver a verla.');
  assert.equal(again.properties.length, 1); assert.deepEqual(again.properties[0].photos, detailed.photos);
  assert.equal(sequence.length, 0);
});
test('duplicados: títulos o fotos similares no fusionan propiedades con IDs distintos; galerías parciales se unen por ID', () => {
  const a = fixture(1), b = fixture(2);
  assert.equal(uniqueProperties([a, b]).length, 2);
  const later = { ...a, photos: fixture(1, 16).photos.slice(5) };
  const result = uniqueProperties([a, later]);
  assert.equal(result.length, 1); assert.equal(result[0].photos.length, 16);
  assert.equal(a.photos.length, 11); assert.equal(later.photos.length, 11);
});
test('detalles: preguntas de proceso leen el inmueble conocido sin repetir tarjeta ni perder fotos', async () => {
  const p = fixture(11177376, 16), s = state(), bodies = [];
  s.properties.set(p.id, p); s.lastResultIds = [p.id];
  const sequence = [call('get_property', { url: null, property_id: p.id }), answer()];
  const chat = createChat({ apiKey: 'synthetic-key', tokko: { detail: () => assert.fail('La ficha conocida está en memoria') }, fetchImpl: async (_url, options) => { bodies.push(JSON.parse(options.body)); return new Response(JSON.stringify(sequence.shift())); } });
  const result = await chat(s, 'SOLO PRUEBA · ¿Cómo sería el proceso de alquiler de este inmueble?');
  assert.deepEqual(result.properties, []); assert.deepEqual(context(bodies[1]).responseCards, []);
  assert.equal(JSON.parse(bodies[1].input.at(-1).output).galleryDisplayed, false);
  assert.deepEqual(context(bodies[1]).propertyDetails, [{ id: p.id, description: p.description }]);
  assert.deepEqual(s.properties.get(p.id).photos, p.photos);
});
