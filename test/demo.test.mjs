// Verificación HTTP de la nueva vista. Todos los proveedores son simulados.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createApp } from '../server.mjs';
import { createDemoTestServer } from '../scripts/demo-test-server.mjs';

async function start(t, app) {
  await new Promise(resolve => app.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.close(resolve)));
  return `http://127.0.0.1:${app.address().port}`;
}
test('demo y vista original se sirven sin consultar proveedores ni exponer archivos privados', async t => {
  let upstream = 0;
  const base = await start(t, createApp({ env: {}, fetchImpl: async () => { upstream++; assert.fail('GET de interfaz no consulta APIs'); } }));
  for (const [path, type] of [['/', 'text/html'], ['/demo', 'text/html'], ['/demo/', 'text/html'], ['/demo.css', 'text/css'], ['/demo.js', 'text/javascript'], ['/app.js', 'text/javascript'], ['/styles.css', 'text/css']]) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200); assert.ok(response.headers.get('content-type').startsWith(type));
    assert.ok(response.headers.get('content-security-policy').includes("connect-src 'self'"));
    if (path === '/demo') {
      const html = await response.text();
      assert.match(html, /SIMULACIÓN WHATSAPP/); assert.match(html, /Sin conexión con WhatsApp Business/);
      assert.match(html, /src="\/demo.js"/); assert.match(html, /id="gallery"/);
      assert.match(html, /id="chat-form"/); assert.match(html, /aria-label="Iniciar nueva conversación"/);
      assert.doesNotMatch(html, /SOLO PRUEBAS/);
    }
    if (path === '/demo.js') assert.match(await response.text(), /import '\/app.js'/);
  }
  for (const path of ['/.env', '/lib/chat.mjs', '/test/demo.test.mjs', '/scripts/demo-test-server.mjs', '/docs/DEMO-CARLOS.md', '/__test-image/1/1', '/demo/../../.env']) assert.equal((await fetch(base + path)).status, 404);
  assert.equal(upstream, 0);
});
test('ambas vistas utilizan la misma sesión y endpoint; nueva conversación reinicia el contexto', async t => {
  const base = await start(t, createApp({ env: {}, fetchImpl: async () => assert.fail('No hay APIs reales'), chatImpl: async (session, message) => {
    session.history.push(message);
    return { message: `SOLO PRUEBA: turno ${session.history.length}`, properties: [], searches: [] };
  } }));
  const post = async (message, cookie, referer = '/demo') => fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', Origin: base, Referer: base + referer, ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ message }) });
  const first = await post('Busco en Lima'); assert.equal(first.status, 200);
  const cookie = first.headers.get('set-cookie').split(';')[0];
  assert.equal((await first.json()).message, 'SOLO PRUEBA: turno 1');
  const second = await post('Ahora en Miraflores', cookie, '/');
  assert.equal((await second.json()).message, 'SOLO PRUEBA: turno 2');
  assert.equal((await fetch(base + '/api/session/reset', { method: 'POST', headers: { Cookie: cookie } })).status, 200);
  const expired = await post('La segunda', cookie); assert.equal(expired.status, 409); assert.equal((await expired.json()).error, 'session_expired');
  assert.equal((await (await post('Nueva búsqueda')).json()).message, 'SOLO PRUEBA: turno 1');
});
test('demo sin claves muestra la interfaz, pero no sustituye el agente por respuestas ficticias', async t => {
  const base = await start(t, createApp({ env: {}, fetchImpl: async () => assert.fail('No hay claves ni llamadas externas') }));
  const health = await (await fetch(base + '/api/health')).json();
  assert.equal(health.openaiConfigured, false); assert.equal(health.tokkoConfigured, false);
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Hola' }) });
  assert.equal(response.status, 503); assert.equal((await response.json()).error, 'missing_openai_key');
});
test('servidor aislado identifica datos sintéticos y conserva 17 fotos por ficha', async t => {
  const base = await start(t, createDemoTestServer({ latency: 0 }));
  const html = await (await fetch(base + '/demo')).text();
  assert.match(html, /SOLO PRUEBAS: datos e imágenes sintéticos/);
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: 'Probar presentación' }) });
  const data = await response.json(); assert.equal(response.status, 200); assert.equal(data.properties.length, 3);
  for (const property of data.properties) {
    assert.match(property.title, /SOLO PRUEBA/); assert.equal(property.photos.length, 17);
    assert.equal(property.operations[0].prices[0].currency, 'PEN');
    assert.equal(property.photos.at(-1).url.startsWith(base), true);
    const photo = await fetch(property.photos.at(-1).url);
    assert.equal(photo.status, 200); assert.match(await photo.text(), /No es un inmueble real/);
  }
});
test('estados de error, vacío y ausencia de fotos son reproducibles solo en el servidor de pruebas', async t => {
  const base = await start(t, createDemoTestServer({ latency: 0 }));
  const post = message => fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) });
  const failure = await post('__error__'); assert.equal(failure.status, 503); assert.equal((await failure.json()).error, 'synthetic_error');
  const empty = await (await post('__empty__')).json(); assert.deepEqual(empty.properties, []); assert.equal(empty.searches[0].count, 0);
  const noPhoto = await (await post('__no-photo__')).json(); assert.deepEqual(noPhoto.properties[0].photos, []); assert.match(noPhoto.properties[0].title, /SOLO PRUEBA/);
});
