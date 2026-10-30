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

test('recursos del rediseño se sirven localmente sin abrir archivos fuera de la lista pública', async t => {
  const base = await start(t, createApp({ env: {}, fetchImpl: async () => assert.fail('No hay solicitudes externas') }));
  for (const path of ['/demo-state.js', '/demo-icons/bed-double.svg', '/demo-icons/bath.svg', '/demo-icons/car-front.svg', '/demo-icons/ruler.svg']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type'), path.endsWith('.svg') ? /image\/svg\+xml/ : /text\/javascript/);
  }
  assert.equal((await fetch(base + '/demo-icons/../../.env')).status, 404);
});
test('galerías mixtas conservan las 11, 16 y 17 fotos y los datos publicados sin reinterpretarlos', async t => {
  const base = await start(t, createDemoTestServer({ latency: 0 }));
  const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message: '__mixed__' }) });
  const data = await response.json();
  assert.deepEqual(data.properties.map(p => p.photos.length), [11, 16, 17]);
  for (const p of data.properties) {
    assert.equal(p.photos.length, new Set(p.photos.map(photo => photo.url)).size);
    for (const photo of p.photos) {
      assert.equal(new URL(photo.url).origin, base);
      const image = await fetch(photo.url); assert.equal(image.status, 200);
      assert.match(await image.text(), new RegExp('/ ' + p.photos.length + '<'));
    }
  }
  assert.equal(data.properties[0].bedrooms, 4);
  assert.match(data.properties[0].description, /Tres dormitorios principales y un cuarto de servicio/);
  assert.equal(data.properties[0].bathrooms, 2);
  assert.equal(data.properties[0].parking, 1); assert.equal(data.properties[0].area, 90);
});
test('respuestas cortas y largas de prueba se identifican y no se truncan', async t => {
  const base = await start(t, createDemoTestServer({ latency: 0 }));
  const post = async message => (await (await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ message }) })).json());
  const short = await post('__short__'), long = await post('__long__');
  assert.match(short.message, /^SOLO PRUEBAS/); assert.ok(short.message.length < 100);
  assert.match(long.message, /^SOLO PRUEBAS/); assert.match(long.message, /FIN DEL TEXTO DE PRUEBA\.$/);
  assert.ok(long.message.length > 2000); assert.deepEqual(long.properties, []);
});

// SOLO PRUEBAS visuales: escenarios identificados del servidor aislado.
test('resúmenes visuales sintéticos: visita progresiva, edición y asesor reutilizan datos sin enviar solicitudes', async t => {
  const base = await start(t, createDemoTestServer({ latency: 0 }));
  let cookie;
  const post = async message => {
    const response = await fetch(base + '/api/chat', { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie ? { Cookie: cookie } : {}) }, body: JSON.stringify({ message, mode: 'demo' }) });
    if (!cookie) cookie = response.headers.get('set-cookie').split(';')[0];
    assert.equal(response.status, 200); return response.json();
  };
  const draft = await post('__visit_draft__'); assert.equal(draft.demoRequests[0].status, 'draft');
  const full = await post('__visit_complete__'); assert.equal(full.demoRequests[0].status, 'prepared');
  assert.deepEqual(full.properties, []);
  const edit = await post('__visit_edit__'); assert.equal(edit.demoRequests[0].property_id, 900002); assert.equal(edit.demoRequests[0].preferred_time, '10:00');
  const advisor = await post('__advisor__'); assert.equal(advisor.demoRequests[0].name, full.demoRequests[0].name); assert.equal(advisor.demoRequests[0].contact, full.demoRequests[0].contact);
  for (const result of [draft, full, edit, advisor]) { assert.match(result.message, /SOLO PRUEBAS/); assert.equal(result.demoRequests[0].notified, false); assert.equal(result.demoRequests[0].confirmed, false); }
  const markdown = await post('__markdown__'); assert.match(markdown.message, /\*\*2 meses/); assert.match(markdown.message, /SOLO PRUEBAS/);
});
