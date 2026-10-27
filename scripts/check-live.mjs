import { loadEnvFile } from 'node:process';
import { createChat } from '../lib/chat.mjs';
import { createTokko } from '../lib/tokko.mjs';
import { fileURLToPath } from 'node:url';

try { loadEnvFile(fileURLToPath(new URL('../.env', import.meta.url))); } catch (error) { if (error.code !== 'ENOENT') throw error; }
if (!process.env.OPENAI_API_KEY || !process.env.TOKKO_API_KEY) {
  console.error('Verificación real pendiente: completa OPENAI_API_KEY y TOKKO_API_KEY en .env. No se hicieron solicitudes ni se mostraron datos de prueba.');
  process.exitCode = 1;
} else {
  let searches = 0;
  const original = createTokko({ apiKey: process.env.TOKKO_API_KEY });
  const tokko = { ...original, search: async args => { searches++; return original.search(args); } };
  const chat = createChat({ apiKey: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL || 'gpt-4.1-mini', tokko });
  const s = { history: [], properties: new Map(), lastResultIds: [], lastSearch: null, turns: 0 };
  try {
    await chat(s, 'Hola'); if (searches !== 0) throw new Error('El saludo disparó una búsqueda.');
    console.log('OK: conversación real con OpenAI; saludo sin búsqueda.');
    const result = await chat(s, process.env.LIVE_SEARCH_MESSAGE || 'Muéstrame algunas propiedades disponibles de su catálogo. Cualquier ubicación, operación o tipo, sin presupuesto máximo ni características adicionales.');
    if (!searches) throw new Error('La solicitud de propiedades no consultó Tokko.');
    console.log(`OK: consulta real a Tokko. ${result.properties.length} propiedades recibidas.`);
    if (result.properties.length) {
      console.log(`Fotos disponibles por ficha: ${result.properties.map(p => p.photos.length).join(', ')}.`);
      const before = searches;
      const detail = await chat(s, `Muéstrame todas las fotos de la ${result.properties.length > 1 ? 'segunda' : 'primera'} opción.`);
      const chosen = result.properties[result.properties.length > 1 ? 1 : 0];
      if (searches !== before || !detail.properties.some(p => p.id === chosen.id && p.photos.length === chosen.photos.length)) throw new Error('No se conservó la referencia o la galería completa.');
      console.log('OK: referencia contextual y galería completa sin repetir búsqueda.');
    } else console.log('El catálogo no devolvió resultados; verifica publicación web y permisos de la clave de Grupo Rentabilizarme.');
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
