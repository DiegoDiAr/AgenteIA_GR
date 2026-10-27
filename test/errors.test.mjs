import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchJson } from '../lib/errors.mjs';
import { createChat } from '../lib/chat.mjs';
import { createApp } from '../server.mjs';

// Todos los fetch se sustituyen: ninguna prueba conecta con OpenAI o Tokko.
const secret = 'TEST-SECRET-DO-NOT-LOG';
const json = (status, error) => new Response(JSON.stringify({ error }), { status });
function capture(t) {
  const entries = [];
  t.mock.method(console, 'error', (...args) => entries.push(...args));
  return entries;
}
function checkDiagnostics(entries, error, httpStatus = null, phase = 'request') {
  assert.equal(entries.length, 1);
  const logged = JSON.parse(entries[0]);
  assert.equal(logged.event, 'openai_request_failed');
  assert.equal(logged.httpStatus, httpStatus);
  assert.equal(logged.phase, phase);
  assert.ok(Number.isInteger(logged.elapsedMs) && logged.elapsedMs >= 0);
  assert.deepEqual(error.diagnostics, Object.fromEntries(Object.entries(logged).filter(([key]) => !['event', 'code'].includes(key))));
  assert.ok(!JSON.stringify([entries, error]).includes(secret));
}

test('OpenAI distingue causas de transporte sin imprimir la excepción cruda', async t => {
  const cases = [
    ['TimeoutError', null, 'openai_timeout', 504],
    ['AbortError', null, 'openai_aborted', 502],
    ['TypeError', 'UND_ERR_CONNECT_TIMEOUT', 'openai_timeout', 504],
    ['TypeError', 'EACCES', 'openai_network_denied', 502],
    ['TypeError', 'EPERM', 'openai_network_denied', 502],
    ['TypeError', 'ENOTFOUND', 'openai_dns_error', 502],
    ['TypeError', 'EAI_AGAIN', 'openai_dns_error', 502],
    ['TypeError', 'CERT_HAS_EXPIRED', 'openai_tls_error', 502],
    ['TypeError', 'ECONNREFUSED', 'openai_connection_error', 502],
    ['TypeError', 'ECONNRESET', 'openai_connection_error', 502],
    ['TypeError', 'ERR_INVALID_CHAR', 'openai_request_error', 502],
    ['TypeError', null, 'openai_transport_error', 502],
  ];
  for (const [name, causeCode, expected, status] of cases) await t.test(`${name}/${causeCode || 'sin código'}`, async t => {
    const entries = capture(t);
    const cause = Object.assign(new Error(secret), { code: causeCode });
    const original = Object.assign(new Error(`${secret} Authorization: Bearer ${secret}`), { name, cause });
    let calls = 0;
    await assert.rejects(fetchJson(async (_, options) => {
      calls++; assert.equal(options.redirect, 'error'); assert.ok(options.signal instanceof AbortSignal); throw original;
    }, 'https://example.invalid', { headers: { Authorization: `Bearer ${secret}` } }, 'OpenAI'), error => {
      assert.equal(error.code, expected); assert.equal(error.status, status);
      assert.equal(error.diagnostics.exceptionType, name);
      assert.deepEqual(error.diagnostics.causeCodes, causeCode ? [causeCode] : []);
      checkDiagnostics(entries, error); return true;
    });
    assert.equal(calls, 1);
  });
});

test('OpenAI extrae códigos de causas AggregateError anidadas', async t => {
  const entries = capture(t);
  const cause = new AggregateError([Object.assign(new Error(secret), { code: 'ECONNREFUSED' }), Object.assign(new Error(secret), { code: 'ENETUNREACH' })], secret);
  const original = new TypeError(secret, { cause });
  await assert.rejects(fetchJson(async () => { throw original; }, 'https://example.invalid', {}, 'OpenAI'), error => {
    assert.equal(error.code, 'openai_connection_error');
    assert.deepEqual(error.diagnostics.causeCodes, ['ECONNREFUSED', 'ENETUNREACH']); checkDiagnostics(entries, error); return true;
  });
});

test('OpenAI distingue respuestas HTTP, modelo, formato, cuota y frecuencia', async t => {
  const cases = [
    [400, 'invalid_request_error', 'invalid_value', 'openai_invalid_request'],
    [422, 'invalid_request_error', 'invalid_type', 'openai_invalid_request'],
    [401, 'invalid_request_error', 'invalid_api_key', 'invalid_credentials'],
    [403, 'permission_error', 'insufficient_permissions', 'openai_permission_error'],
    [404, 'invalid_request_error', 'model_not_found', 'openai_model_error'],
    [404, 'invalid_request_error', null, 'not_found'],
    [429, 'insufficient_quota', 'insufficient_quota', 'openai_quota_exceeded'],
    [429, 'rate_limit_error', 'rate_limit_exceeded', 'upstream_limit'],
    [429, null, null, 'upstream_limit'],
    [500, 'server_error', null, 'upstream_error'],
    [503, 'server_error', null, 'upstream_error'],
  ];
  for (const [status, type, code, expected] of cases) await t.test(`${status}/${code || 'sin código'}`, async t => {
    const entries = capture(t);
    await assert.rejects(fetchJson(async () => json(status, { type, code, message: secret, param: secret }), 'https://example.invalid', {}, 'OpenAI'), error => {
      assert.equal(error.code, expected); assert.ok(error.message.includes(`HTTP ${status}`));
      assert.equal(error.diagnostics.providerType, type); assert.equal(error.diagnostics.providerCode, code);
      checkDiagnostics(entries, error, status, 'http'); return true;
    });
  });
});

test('OpenAI conserva el HTTP cuando el cuerpo de error no es JSON', async t => {
  const entries = capture(t);
  await assert.rejects(fetchJson(async () => new Response(`<html>${secret}</html>`, { status: 502 }), 'https://example.invalid', {}, 'OpenAI'), error => {
    assert.equal(error.diagnostics.exceptionType, 'SyntaxError'); assert.equal(error.code, 'upstream_error');
    checkDiagnostics(entries, error, 502, 'http'); return true;
  });
});

test('OpenAI diferencia JSON inválido de timeout al recibir el cuerpo', async t => {
  await t.test('JSON inválido', async t => {
    const entries = capture(t);
    await assert.rejects(fetchJson(async () => new Response(secret, { status: 200 }), 'https://example.invalid', {}, 'OpenAI'), error => {
      assert.equal(error.code, 'invalid_response'); checkDiagnostics(entries, error, 200, 'response_body'); return true;
    });
  });
  await t.test('timeout de cuerpo', async t => {
    const entries = capture(t);
    await assert.rejects(fetchJson(async () => ({ ok: true, status: 200, json: async () => { throw new DOMException(secret, 'TimeoutError'); } }), 'https://example.invalid', {}, 'OpenAI'), error => {
      assert.equal(error.code, 'openai_timeout'); assert.equal(error.status, 504); checkDiagnostics(entries, error, 200, 'response_body'); return true;
    });
  });
});

test('diagnósticos descartan nombres y códigos arbitrarios con datos sensibles', async t => {
  await t.test('excepción', async t => {
    const entries = capture(t);
    await assert.rejects(fetchJson(async () => { throw { name: secret, code: secret, message: secret, cause: { code: secret } }; }, 'https://example.invalid', {}, 'OpenAI'), error => {
      assert.equal(error.diagnostics.exceptionType, 'unknown'); assert.deepEqual(error.diagnostics.causeCodes, []); checkDiagnostics(entries, error); return true;
    });
  });
  await t.test('proveedor', async t => {
    const entries = capture(t);
    await assert.rejects(fetchJson(async () => json(400, { type: secret, code: secret, message: secret }), 'https://example.invalid', {}, 'OpenAI'), error => {
      assert.equal(error.diagnostics.providerType, null); assert.equal(error.diagnostics.providerCode, null); checkDiagnostics(entries, error, 400, 'http'); return true;
    });
  });
});

test('la respuesta de chat preserva diagnóstico seguro sin cambiar petición ni contexto', async t => {
  capture(t);
  const state = { history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 };
  let calls = 0;
  const chat = createChat({ apiKey: secret, tokko: { search: () => assert.fail('Un saludo no debe consultar Tokko') }, fetchImpl: async (url, options) => {
    calls++; assert.equal(url, 'https://api.openai.com/v1/responses'); assert.equal(options.method, 'POST');
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    const body = JSON.parse(options.body);
    assert.equal(body.model, 'gpt-4.1-mini'); assert.equal(body.tool_choice, 'auto'); assert.equal(body.store, false);
    assert.equal(body.input[0].content, 'Hola, ¿qué tal? ¿Cómo estás?');
    throw new TypeError(secret, { cause: Object.assign(new Error(secret), { code: 'EACCES' }) });
  } });
  await assert.rejects(chat(state, 'Hola, ¿qué tal? ¿Cómo estás?'), error => error.code === 'openai_network_denied');
  assert.equal(calls, 1); assert.equal(state.turns, 0); assert.deepEqual(state.history, []);
});

test('HTTP expone solo el error seguro; los detalles técnicos quedan en el servidor', async t => {
  const entries = capture(t);
  const app = createApp({ env: { OPENAI_API_KEY: secret, TOKKO_API_KEY: secret }, fetchImpl: async () => {
    throw new TypeError(secret, { cause: Object.assign(new Error(secret), { code: 'ENOTFOUND' }) });
  } });
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  const response = await fetch(`http://127.0.0.1:${app.address().port}/api/chat`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hola' }) });
  const result = await response.json(); assert.equal(response.status, 502); assert.equal(result.error, 'openai_dns_error');
  assert.deepEqual(Object.keys(result).sort(), ['error', 'message']); assert.ok(!JSON.stringify(result).includes(secret));
  assert.equal(JSON.parse(entries[0]).httpStatus, null);
});

test('Tokko mantiene el manejo de errores existente y no registra diagnósticos de OpenAI', async t => {
  const entries = capture(t);
  await assert.rejects(fetchJson(async () => { throw new Error(secret); }, 'https://example.invalid', {}, 'Tokko'), error => error.code === 'service_unavailable');
  await assert.rejects(fetchJson(async () => json(429, { message: secret }), 'https://example.invalid', {}, 'Tokko'), error => error.code === 'upstream_limit');
  assert.deepEqual(entries, []);
});
