// Servidor AISLADO para comprobar la interfaz con datos sintéticos identificados.
// No forma parte de npm start ni se habilita mediante variables del servidor real.
import http from 'node:http';
import { createApp } from '../server.mjs';
import { normalizeProperty } from '../lib/tokko.mjs';
const port = 8788;
const property = normalizeProperty({ id: 999, publication_title: 'SOLO PRUEBA · Ficha sintética para comprobar la galería', description: 'Datos sintéticos de prueba. No es una propiedad real ni está disponible.', suite_amount: 2, bathroom_amount: 1, location: { name: 'Entorno de prueba' }, photos: Array.from({ length: 17 }, (_, i) => ({ image: `http://127.0.0.1:${port}/__test-image/${i + 1}`, description: `IMAGEN DE PRUEBA ${i + 1} · No es una foto de un inmueble` })) });
const app = createApp({ env: { OPENAI_API_KEY: 'not-a-real-key', TOKKO_API_KEY: 'not-a-real-key' }, chatImpl: async () => ({ message: 'ENTORNO DE PRUEBA: datos e imágenes sintéticos, exclusivamente para verificar los controles. No son resultados de Tokko.', properties: [{ ...property, resultIndex: 1 }], searches: [] }) });
const listener = app.listeners('request')[0];
http.createServer((req, res) => {
  const match = req.url.match(/^\/__test-image\/(\d+)$/);
  if (match) { res.writeHead(200, { 'Content-Type': 'image/svg+xml' }); return res.end(`<svg xmlns="http://www.w3.org/2000/svg" width="800" height="500"><rect width="800" height="500" fill="#e5ede0"/><text x="400" y="240" text-anchor="middle" font-family="sans-serif" font-size="34" fill="#123e32">IMAGEN DE PRUEBA ${match[1]}</text><text x="400" y="290" text-anchor="middle" font-family="sans-serif" font-size="20" fill="#123e32">No es una fotografía de un inmueble</text></svg>`); }
  listener(req, res);
}).listen(port, '127.0.0.1', () => console.log(`SOLO PRUEBAS DE UI: http://127.0.0.1:${port}`));
