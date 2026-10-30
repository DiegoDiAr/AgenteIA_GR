// SOLO PRUEBAS: proveedores y respuestas simulados. No hay llamadas a APIs reales.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createChat, TOOLS } from '../lib/chat.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
import { AppError } from '../lib/errors.mjs';
import { createApp } from '../server.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const answer = () => ({ status: 'completed', output: [{ type: 'message', content: [{ type: 'output_text', text: 'SOLO PRUEBA · respuesta simulada.' }] }] });
const call = (name = 'search_properties', args = {}) => ({ status: 'completed', output: [{ type: 'function_call', name, arguments: JSON.stringify(args), call_id: 'synthetic-call' }] });
const state = () => ({ history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 });
const property = normalizeProperty({ id: 97001, publication_title: 'SOLO PRUEBA', description: 'Dato sintético.', photos: [{ original: 'https://photos.example.test/1.jpg' }] });
const capture = t => {
  const entries = [];
  t.mock.method(console, 'info', value => entries.push(JSON.parse(value)));
  return entries;
};
function scripted(sequence, tokko, diagnostics) {
  let modelCalls = 0;
  const chat = createChat({ apiKey: 'synthetic-key', tokko, diagnostics, fetchImpl: async (url, options) => {
    assert.equal(url, 'https://api.openai.com/v1/responses');
    const body = JSON.parse(options.body);
    assert.equal(body.tool_choice, 'auto'); assert.equal(body.model, 'gpt-4.1-mini');
    assert.equal(body.max_output_tokens, 2200); assert.deepEqual(body.tools, TOOLS);
    assert.ok(modelCalls < sequence.length, 'No hay llamadas extra de diagnóstico');
    return json(sequence[modelCalls++]);
  } });
  return { chat, done() { assert.equal(modelCalls, sequence.length); } };
}

test('diagnóstico: apagado por defecto no registra eventos ni cambia las respuestas', async t => {
  const entries = capture(t); let searches = 0;
  const h = scripted([call(), answer()], { search: async filters => { searches++; return { properties: [property], filters, nextOffset: null }; } });
  const result = await h.chat(state(), 'SOLO PRUEBA · búsqueda.');
  assert.equal(searches, 1); assert.deepEqual(entries, []);
  assert.deepEqual(Object.keys(result).sort(), ['message', 'properties', 'searches']);
  assert.equal(result.properties[0].photos.length, 1); h.done();
});

test('diagnóstico: diferencia saludo, búsqueda Tokko y ficha de memoria con tiempos y correlación local', async t => {
  const entries = capture(t); let searches = 0;
  const h = scripted([answer(), call(), answer(), call('show_property', { property_id: property.id, result_index: null }), answer()], {
    search: async filters => { searches++; return { properties: [property], filters, nextOffset: null }; },
  }, true);
  const s = state();
  await h.chat(s, 'Hola');
  assert.equal(entries.length, 1);
  assert.equal(entries[0].event, 'agent_model_result'); assert.equal(entries[0].status, 'no_tool_calls');
  await h.chat(s, 'SOLO PRUEBA · buscar');
  await h.chat(s, 'SOLO PRUEBA · mostrar ficha');
  assert.equal(searches, 1);
  assert.deepEqual(entries.filter(e => e.event === 'agent_model_result' && e.status === 'tool_calls').map(e => e.tools), [['search_properties'], ['show_property']]);
  const provider = entries.filter(e => e.event === 'agent_tokko');
  assert.equal(provider.length, 2); assert.equal(provider[0].phase, 'start');
  assert.equal(provider[1].status, 'matches'); assert.equal(provider[1].resultCount, 1);
  assert.equal(new Set(entries.map(e => e.traceId)).size, 3);
  for (const e of entries) {
    assert.match(e.traceId, /^[a-f0-9-]{36}$/);
    if (e.phase !== 'start') assert.ok(Number.isInteger(e.elapsedMs) && e.elapsedMs >= 0);
  }
  h.done();
});

test('diagnóstico: distingue cero coincidencias de error y no registra mensajes ni códigos privados', async t => {
  const entries = capture(t), privateMarker = 'PRIVATE_ERROR_NEVER_LOG';
  for (const failure of [false, true]) {
    entries.length = 0;
    const h = scripted([call(), answer()], { search: async filters => {
      if (failure) throw new AppError(privateMarker, 502, privateMarker);
      return { properties: [], filters, nextOffset: null };
    } }, true);
    await h.chat(state(), 'PRIVATE_CLIENT_MESSAGE');
    const end = entries.find(e => e.event === 'agent_tokko' && e.phase === 'end');
    assert.equal(end.status, failure ? 'error' : 'no_matches');
    assert.equal(entries.find(e => e.event === 'agent_tool_result').status, failure ? 'error' : 'completed');
    assert.equal(JSON.stringify(entries).includes(privateMarker), false);
    assert.equal(JSON.stringify(entries).includes('PRIVATE_CLIENT_MESSAGE'), false);
    h.done();
  }
});

test('diagnóstico: nombres de herramienta y argumentos no confiables no se filtran al registro', async t => {
  const entries = capture(t), secret = 'PRIVATE_CUSTOMER_PHONE_TOKEN';
  const h = scripted([call(secret, { name: secret, key: secret, location: secret }), answer()], {}, true);
  await h.chat(state(), secret);
  assert.equal(JSON.stringify(entries).includes(secret), false);
  assert.deepEqual(entries[0].tools, ['unknown']);
  assert.equal(entries.find(e => e.event === 'agent_tool_result').tool, 'unknown');
  h.done();
});

test('diagnóstico: no altera el manejo de un error de OpenAI ni agrega solicitudes', async t => {
  const entries = capture(t); t.mock.method(console, 'error', () => {});
  let requests = 0;
  const chat = createChat({ apiKey: 'synthetic-key', diagnostics: true, tokko: {}, fetchImpl: async () => {
    requests++; return json({ error: { message: 'PRIVATE_PROVIDER_BODY' } }, 500);
  } });
  await assert.rejects(chat(state(), 'PRIVATE_MESSAGE'), e => e.code === 'upstream_error');
  assert.equal(requests, 1); assert.equal(entries.length, 1); assert.equal(entries[0].status, 'error');
  assert.equal(JSON.stringify(entries).includes('PRIVATE'), false);
});

test('diagnóstico: un fallo del logger no rompe la conversación', async t => {
  t.mock.method(console, 'info', () => { throw new Error('SOLO PRUEBA · logger no disponible'); });
  const h = scripted([answer()], {}, true);
  const result = await h.chat(state(), 'Hola');
  assert.equal(result.message, 'SOLO PRUEBA · respuesta simulada.'); h.done();
});

test('diagnóstico HTTP: requiere activación explícita y configuración de host local', async t => {
  const entries = capture(t);
  for (const [flag, host, expected] of [[undefined, '127.0.0.1', false], ['0', '127.0.0.1', false], ['1', '0.0.0.0', false], ['1', 'localhost', true]]) {
    entries.length = 0;
    const app = createApp({ env: { OPENAI_API_KEY: 'synthetic-key', TOKKO_API_KEY: 'synthetic-key', AGENT_DIAGNOSTICS: flag, HOST: host }, fetchImpl: async url => {
      assert.equal(url, 'https://api.openai.com/v1/responses'); return json(answer());
    } });
    await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
    try {
      const base = 'http://127.0.0.1:' + app.address().port;
      const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hola' }) });
      assert.equal(response.status, 200); assert.equal((await response.json()).message, 'SOLO PRUEBA · respuesta simulada.');
      assert.equal(entries.length > 0, expected);
      assert.equal((await fetch(base + '/api/diagnostics')).status, 404);
    } finally { await new Promise(resolve => app.close(resolve)); }
  }
});

test('diagnóstico: get_property identifica la operación de enlace o detalle sin registrar su argumento', async t => {
  const entries = capture(t), privateUrl = 'https://gruporentabilizarme.com/Propiedades/Detalle?id=999999999999901';
  for (const [method, args] of [['fromUrl', { url: privateUrl, property_id: null }], ['detail', { url: null, property_id: 999999999999901 }]]) {
    entries.length = 0; let executions = 0;
    const h = scripted([call('get_property', args), answer()], { [method]: async arg => {
      executions++; assert.equal(arg, method === 'fromUrl' ? privateUrl : args.property_id); return property;
    } }, true);
    const result = await h.chat(state(), 'PRIVATE_PROPERTY_REQUEST');
    assert.equal(result.properties[0].id, property.id); assert.equal(executions, 1);
    assert.equal(entries.find(e => e.event === 'agent_tokko').operation, method);
    assert.equal(entries.find(e => e.event === 'agent_tokko' && e.phase === 'end').status, 'property');
    const logs = JSON.stringify(entries);
    assert.equal(logs.includes(privateUrl), false); assert.equal(logs.includes('999999999999901'), false);
    assert.equal(logs.includes('PRIVATE_PROPERTY_REQUEST'), false); h.done();
  }
});
