// SERVIDOR DE PRUEBAS AISLADO. Nunca se usa desde npm start ni por /demo real.
import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { createApp } from '../server.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
import { AppError } from '../lib/errors.mjs';

export function createDemoTestServer({ latency = 450 } = {}) {
  const app = createApp({
    env: { OPENAI_API_KEY: 'synthetic-key', TOKKO_API_KEY: 'synthetic-key' },
    fetchImpl: async () => { throw new Error('El servidor de pruebas no permite solicitudes externas.'); },
    chatImpl: async (_session, message) => {
      await delay(message === '__slow__' ? 6000 : latency);
      if (message === '__error__') throw new AppError('SOLO PRUEBAS: fallo de conexión simulado. El mensaje se conserva para reintentar.', 503, 'synthetic_error');
      if (message === '__empty__') return { message: 'SOLO PRUEBAS: resultado vacío simulado. No representa el catálogo real de Tokko.', properties: [], searches: [{ count: 0, nextOffset: null, filters: {} }] };
      const properties = Array.from({ length: message === '__no-photo__' ? 1 : 3 }, (_, index) => ({
        ...normalizeProperty({
          id: 900001 + index, reference_code: `SOLO-PRUEBA-${index + 1}`,
          publication_title: `SOLO PRUEBA · Departamento sintético ${String.fromCharCode(65 + index)}`,
          fake_address: 'Dirección sintética de prueba',
          location: { full_location: 'Peru | Lima | Lima | Distrito sintético' },
          type: { id: 2, name: 'Departamento de prueba' },
          description: 'SOLO PRUEBA: esta ficha no es un inmueble real.\n' + 'Descripción sintética completa para comprobar la lectura y el desplazamiento. '.repeat(12),
          suite_amount: 2 + index, bathroom_amount: 2, parking_lot_amount: 1, room_amount: 4,
          total_surface: 90 + index * 15, surface_measurement: 'M2',
          tags: [{ name: 'Etiqueta sintética A' }, { name: 'Etiqueta sintética B' }],
          operations: [{ operation_id: 2, operation_type: 'Alquiler · prueba', prices: [{ currency: 'PEN', price: 4200 + index * 200 }] }],
          photos: message === '__no-photo__' ? [] : Array.from({ length: 17 }, (_, photo) => ({
            original: `http://127.0.0.1:${server.address().port}/__test-image/${index + 1}/${photo + 1}`,
            description: `IMAGEN DE PRUEBA ${photo + 1} · No es una foto de un inmueble`,
          })),
          public_url: `https://example.test/propiedad-sintetica/${index + 1}`,
        }), resultIndex: index + 1,
      }));
      return { message: 'SOLO PRUEBAS: estas fichas son sintéticas. Permiten revisar la presentación, los controles y las 17 imágenes de cada galería. No son recomendaciones ni resultados de Tokko.', properties, searches: [{ count: properties.length, nextOffset: null, filters: {} }] };
    },
  });
  const listener = app.listeners('request')[0];
  const server = http.createServer(async (req, res) => {
    const pathname = new URL(req.url, 'http://localhost').pathname;
    const match = pathname.match(/^\/__test-image\/(\d+)\/(\d+)$/);
    if (req.method === 'GET' && match) {
      res.writeHead(200, { 'Content-Type': 'image/svg+xml', 'Cache-Control': 'no-store' });
      return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="900" height="600"><rect width="900" height="600" fill="#e4ecdc"/><path d="M140 390V240l130-75 130 75v150M220 390V275h100v115M105 390h330" fill="none" stroke="#9aae87" stroke-width="4"/><text x="550" y="250" text-anchor="middle" font-family="sans-serif" font-size="25" fill="#34543b">SOLO PRUEBAS</text><text x="550" y="295" text-anchor="middle" font-family="sans-serif" font-size="19" fill="#34543b">Ficha ${match[1]} · Imagen ${match[2]} / 17</text><text x="450" y="515" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#34543b">Imagen sintética · No es un inmueble real</text></svg>`);
    }
    if (req.method === 'GET' && ['/demo', '/demo/'].includes(pathname)) {
      try {
        const html = await readFile(new URL('../public/demo.html', import.meta.url), 'utf8');
        res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
        return res.end(html.replace('<title>', '<title>SOLO PRUEBAS · ').replace('Simulación de la experiencia WhatsApp. Sin conexión con WhatsApp Business.', 'SOLO PRUEBAS: datos e imágenes sintéticos. Sin llamadas a OpenAI o Tokko. Sin conexión con WhatsApp Business.'));
      } catch { res.writeHead(500); return res.end('No se pudo abrir la vista de pruebas.'); }
    }
    listener(req, res);
  });
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  createDemoTestServer().listen(8789, '127.0.0.1', () => console.log('SOLO PRUEBAS: http://127.0.0.1:8789/demo · Sin llamadas a OpenAI o Tokko.'));
}
