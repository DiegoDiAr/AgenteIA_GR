import http from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { loadEnvFile } from 'node:process';
import { createTokko } from './lib/tokko.mjs';
import { createChat } from './lib/chat.mjs';
import { AppError } from './lib/errors.mjs';

try { loadEnvFile(fileURLToPath(new URL('.env', import.meta.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }

const TTL = 2 * 60 * 60 * 1000;
const files = new Map([['/', ['index.html', 'text/html; charset=utf-8']], ['/app.js', ['app.js', 'text/javascript; charset=utf-8']], ['/styles.css', ['styles.css', 'text/css; charset=utf-8']]]);
export function createApp({ env = process.env, fetchImpl = fetch, chatImpl } = {}) {
  const sessions = new Map();
  const tokko = createTokko({ apiKey: env.TOKKO_API_KEY, fetchImpl });
  const chat = chatImpl || createChat({ apiKey: env.OPENAI_API_KEY, model: env.OPENAI_MODEL || 'gpt-4.1-mini', tokko, fetchImpl });
  function getSession(req, res) {
    for (const [id, s] of sessions) if (Date.now() - s.touched > TTL && !s.busy) sessions.delete(id);
    const id = req.headers.cookie?.match(/(?:^|;\s*)gr_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
    if (id && sessions.has(id)) return sessions.get(id);
    if (id) throw new AppError('La sesión expiró o el servidor se reinició. Inicia una nueva conversación.', 409, 'session_expired');
    if (sessions.size >= 1000) throw new AppError('El servidor está ocupado. Intenta más tarde.', 503, 'session_capacity');
    const nextId = randomUUID();
    const session = { history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0, touched: Date.now(), requests: [], busy: false };
    sessions.set(nextId, session);
    res.setHeader('Set-Cookie', `gr_session=${nextId}; Path=/; HttpOnly; SameSite=Strict; Max-Age=7200${req.socket.encrypted ? '; Secure' : ''}`);
    return session;
  }
  const server = http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https: http:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    function json(status, body) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(body)); }
    try {
      const path = new URL(req.url, 'http://localhost').pathname;
      if (req.method === 'GET' && path === '/api/health') return json(200, { ok: true, openaiConfigured: Boolean(env.OPENAI_API_KEY), tokkoConfigured: Boolean(env.TOKKO_API_KEY) });
      if (req.method === 'GET' && files.has(path)) {
        const [name, type] = files.get(path);
        const body = await readFile(new URL(`public/${name}`, import.meta.url));
        res.writeHead(200, { 'Content-Type': type }); return res.end(body);
      }
      if (req.method === 'POST' && ['/api/chat', '/api/session/reset'].includes(path)) {
        if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) throw new AppError('Origen no permitido.', 403, 'invalid_origin');
        if (path === '/api/session/reset') {
          const id = req.headers.cookie?.match(/(?:^|;\s*)gr_session=([a-f0-9-]{36})(?:;|$)/)?.[1];
          if (id && sessions.get(id)?.busy) throw new AppError('Espera a que termine la respuesta.', 409, 'session_busy');
          if (id) sessions.delete(id);
          res.setHeader('Set-Cookie', 'gr_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0');
          return json(200, { ok: true });
        }
        if (!req.headers['content-type']?.startsWith('application/json')) throw new AppError('Se requiere JSON.', 415, 'invalid_content_type');
        let bytes = 0; const chunks = [];
        for await (const chunk of req) { bytes += chunk.length; if (bytes > 24000) throw new AppError('El mensaje es demasiado largo.', 413, 'message_too_large'); chunks.push(chunk); }
        let data;
        try { data = JSON.parse(Buffer.concat(chunks).toString()); } catch { throw new AppError('JSON no válido.', 400, 'invalid_json'); }
        if (typeof data.message !== 'string' || !data.message.trim() || data.message.length > 4000) throw new AppError('Escribe un mensaje de entre 1 y 4000 caracteres.', 400, 'invalid_message');
        const session = getSession(req, res);
        if (session.busy) throw new AppError('Espera a que termine la respuesta anterior.', 409, 'session_busy');
        session.requests = session.requests.filter(time => Date.now() - time < 60000);
        if (session.requests.length >= 15) throw new AppError('Espera un minuto antes de enviar más mensajes.', 429, 'rate_limit');
        session.requests.push(Date.now()); session.busy = true; session.touched = Date.now();
        try { return json(200, await chat(session, data.message.trim())); }
        finally { session.busy = false; session.touched = Date.now(); }
      }
      json(404, { error: 'not_found', message: 'Ruta no encontrada.' });
    } catch (error) {
      // Nunca registrar URLs de Tokko, cuerpos upstream ni credenciales.
      if (!(error instanceof AppError)) console.error('Error interno del servidor (detalle privado omitido).');
      json(error instanceof AppError ? error.status : 500, { error: error instanceof AppError ? error.code : 'internal_error', message: error instanceof AppError ? error.message : 'No se pudo completar la solicitud. Intenta nuevamente.' });
    }
  });
  server.requestTimeout = 180000;
  return server;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  const port = Number(process.env.PORT || 8787), host = process.env.HOST || '127.0.0.1';
  const app = createApp();
  app.on('error', error => {
    console.error(['EACCES', 'EADDRINUSE'].includes(error.code) ? 'No se puede usar el puerto configurado. Cambia PORT en .env e inicia nuevamente.' : 'No se pudo iniciar el servidor. Revisa HOST y PORT en .env.');
    process.exitCode = 1;
  });
  app.listen(port, host, () => console.log(`Grupo Rentabilizarme: http://${host}:${port}`));
}
