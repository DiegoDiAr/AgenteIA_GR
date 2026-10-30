import { AppError, fetchJson } from './errors.mjs';
import { locationKey, locationPath, resolveCandidates, missingLocationParents, canReuseLocation, propertyInLocation } from './locations.mjs';

const BASE = 'https://www.tokkobroker.com/api/v1/';
export const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().trim();
const text = value => String(value ?? '').replace(/<[^>]*>/g, '').trim();
const number = value => value == null || value === '' || !Number.isFinite(Number(value)) ? null : Number(value);
export function safeUrl(value) {
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password && ![...url.searchParams.keys()].some(k => /^(key|api_key|token)$/i.test(k)) ? url.href : null;
  } catch { return null; }
}

export function normalizeProperty(p) {
  return {
    id: Number(p.id), reference: text(p.reference_code), title: text(p.publication_title) || text(p.type?.name) || 'Propiedad',
    address: text(p.fake_address || p.address), location: text(p.location?.full_location || p.location?.name),
    description: text(p.description), type: text(p.type?.name), typeId: number(p.type?.id),
    bedrooms: number(p.suite_amount), rooms: number(p.room_amount), bathrooms: number(p.bathroom_amount), parking: number(p.parking_lot_amount),
    area: number(p.total_surface), coveredArea: number(p.roofed_surface), landArea: number(p.surface), areaUnit: text(p.surface_measurement),
    features: (p.tags || []).map(t => text(t.name)).filter(Boolean),
    operations: (p.operations || []).map(op => ({ id: number(op.operation_id), name: text(op.operation_type), prices: p.web_price === false ? [] : (op.prices || []).map(price => ({ amount: number(price.price), currency: text(price.currency), period: price.period ?? null })).filter(price => price.amount != null && price.amount > 0) })),
    photos: (p.photos || []).map((photo, i) => ({ url: safeUrl(photo.original) || safeUrl(photo.image) || safeUrl(photo.thumb), thumbnail: safeUrl(photo.thumb) || safeUrl(photo.image) || safeUrl(photo.original), caption: text(photo.description) || `Fotografía ${i + 1}` })).filter(photo => photo.url),
    publicUrl: safeUrl(p.public_url),
  };
}

export function validateSearch(args) {
  const a = { location: null, property_types: [], operation: null, currency: null, min_price: null, max_price: null, min_bedrooms: null, max_bedrooms: null, min_rooms: null, max_rooms: null, min_bathrooms: null, max_bathrooms: null, min_parking: null, max_parking: null, min_area: null, max_area: null, features: [], offset: 0, ...args };
  if (!Array.isArray(a.property_types) || a.property_types.some(id => !Number.isSafeInteger(id) || id < 1)) throw new AppError('Tipo de propiedad no válido.', 400, 'invalid_filters');
  if (a.operation !== null && ![1, 2, 3].includes(a.operation)) throw new AppError('Operación no válida.', 400, 'invalid_filters');
  for (const field of ['min_price', 'max_price', 'min_bedrooms', 'max_bedrooms', 'min_rooms', 'max_rooms', 'min_bathrooms', 'max_bathrooms', 'min_parking', 'max_parking', 'min_area', 'max_area']) {
    if (a[field] !== null && (typeof a[field] !== 'number' || !Number.isFinite(a[field]) || a[field] < 0 || a[field] > 999999999)) throw new AppError('Los filtros numéricos deben ser números positivos.', 400, 'invalid_filters');
  }
  for (const field of ['bedrooms', 'rooms', 'bathrooms', 'parking', 'area']) {
    if (a[`min_${field}`] !== null && a[`max_${field}`] !== null && a[`min_${field}`] > a[`max_${field}`]) throw new AppError('El mínimo de una característica supera al máximo.', 400, 'invalid_filters');
  }
  if (a.min_price !== null && a.max_price !== null && a.min_price > a.max_price) throw new AppError('El presupuesto mínimo supera al máximo.', 400, 'invalid_filters');
  if (a.currency !== null && !/^[A-Z]{3}$/.test(a.currency)) throw new AppError('Indica una moneda válida, como USD o PEN.', 400, 'invalid_filters');
  if ((a.min_price !== null || a.max_price !== null) && !a.currency) throw new AppError('Necesito la moneda del presupuesto antes de buscar. Pregunta si son dólares, soles u otra moneda.', 400, 'currency_required');
  if (a.location !== null && (typeof a.location !== 'string' || a.location.length > 180)) throw new AppError('Ubicación no válida.', 400, 'invalid_filters');
  if (!Number.isInteger(a.offset) || a.offset < 0 || a.offset > 100000) throw new AppError('Página no válida.', 400, 'invalid_filters');
  if (!Array.isArray(a.features) || a.features.length > 8 || a.features.some(f => typeof f !== 'string' || f.length > 80 || !f.trim())) throw new AppError('Características no válidas.', 400, 'invalid_filters');
  return a;
}

// null/[] significan «sin cambio» al refinar. Quitar un criterio es una
// decisión explícita del modelo, no una consecuencia de omitirlo en el JSON.
export function mergeSearch(previous, args) {
  if (!args || typeof args !== 'object' || Array.isArray(args)) throw new AppError('Filtros no válidos.', 400, 'invalid_filters');
  const { reset_fields = [], ...changes } = args;
  const defaults = validateSearch({});
  if (!Array.isArray(reset_fields) || reset_fields.some(key => !(key in defaults) || key === 'offset')) throw new AppError('Criterios a quitar no válidos.', 400, 'invalid_filters');
  const merged = { ...previous, ...changes };
  for (const key of Object.keys(defaults)) {
    if (key === 'offset') continue;
    if (reset_fields.includes(key)) merged[key] = defaults[key];
    else if (previous && key in previous && (changes[key] == null || (Array.isArray(changes[key]) && !changes[key].length))) merged[key] = previous[key];
  }
  const changed = previous && Object.keys(defaults).some(key => key !== 'offset' && JSON.stringify(merged[key] ?? defaults[key]) !== JSON.stringify(previous[key] ?? defaults[key]));
  if (changed && (previous.offset || changes.offset)) merged.offset = 0;
  validateSearch(merged);
  return merged;
}

export function officialPropertyUrl(value) {
  let url;
  try { url = new URL(value); } catch { /* Error seguro abajo. */ }
  if (!url || !['http:', 'https:'].includes(url.protocol) || !['gruporentabilizarme.com', 'www.gruporentabilizarme.com'].includes(url.hostname) || url.port || url.username || url.password || !/^\/Propiedades\/Detalle\/?$/i.test(url.pathname) || url.searchParams.getAll('id').length !== 1 || !/^[1-9]\d*$/.test(url.searchParams.get('id')) || !Number.isSafeInteger(Number(url.searchParams.get('id')))) {
    throw new AppError('Usa un enlace público de detalle de gruporentabilizarme.com o un ID de Tokko.', 400, 'invalid_property_url');
  }
  return `https://gruporentabilizarme.com/Propiedades/Detalle?id=${url.searchParams.get('id')}`;
}

function photoIdentity(value) {
  try {
    const url = new URL(value);
    if (url.hostname !== 'static.tokkobroker.com' || !['https:', 'http:'].includes(url.protocol)) return null;
    const match = url.pathname.match(/^\/(?:original_)?pictures\/([1-9]\d*)_([a-zA-Z0-9]{16,})\.[a-zA-Z]+$/);
    return match && Number.isSafeInteger(Number(match[1])) ? { id: Number(match[1]), fingerprint: match[2].slice(0, 16) } : null;
  } catch { return null; }
}

function attribute(tag, name) {
  const value = tag.match(new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, 'i'));
  return (value?.[1] ?? value?.[2] ?? '').replace(/&amp;/gi, '&').replace(/&#(?:x([a-f0-9]+)|(\d+));/gi, (entity, hex, dec) => {
    const code = parseInt(hex || dec, hex ? 16 : 10);
    return code <= 0x10ffff ? String.fromCodePoint(code) : entity;
  });
}

export function createTokko({ apiKey, fetchImpl = fetch }) {
  async function request(path, params = {}) {
    if (!apiKey) throw new AppError('Falta TOKKO_API_KEY en el archivo .env del backend.', 503, 'missing_tokko_key');
    const url = new URL(path, BASE);
    url.search = new URLSearchParams({ format: 'json', lang: 'es_ar', key: apiKey, ...params });
    const data = await fetchJson(fetchImpl, url, {}, 'Tokko');
    if (!data || typeof data !== 'object') throw new AppError('Tokko devolvió una respuesta no válida.', 502, 'invalid_response');
    if (data.error || data.error_message) throw new AppError('Tokko no pudo completar la consulta. Revisa los permisos de la cuenta.', 502, 'tokko_error');
    return data;
  }
  async function detail(id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Identificador de propiedad no válido.', 400, 'invalid_property');
    const data = await request(`property/${id}/`);
    if (Number(data.id) !== id) throw new AppError('Tokko devolvió una ficha no válida.', 502, 'invalid_response');
    return normalizeProperty(data);
  }
  async function fromUrl(value) {
    const url = officialPropertyUrl(value);
    let response, html;
    try {
      response = await fetchImpl(url, { signal: AbortSignal.timeout(20000), redirect: 'error' });
      if (response.ok) html = await response.text();
    } catch { throw new AppError('No se pudo consultar la publicación oficial. Intenta nuevamente.', 502, 'publication_unavailable'); }
    if (response.status === 404) throw new AppError('La publicación oficial ya no está disponible.', 404, 'publication_not_found');
    if (!response.ok) throw new AppError('El sitio oficial no pudo completar la consulta.', 502, 'publication_unavailable');
    // El ID de la URL pertenece al sitio, no necesariamente a Tokko. La página
    // actual publica og:image con el ID de Tokko en el nombre de la imagen.
    const cover = (html.match(/<meta\b[^>]*>/gi) || []).filter(tag => attribute(tag, 'property').toLowerCase() === 'og:image').map(tag => photoIdentity(attribute(tag, 'content'))).filter(Boolean);
    const photos = cover.length ? cover : (html.match(/<img\b[^>]*>/gi) || []).map(tag => photoIdentity(attribute(tag, 'src'))).filter(Boolean);
    const ids = [...new Set(photos.map(photo => photo.id))];
    if (ids.length !== 1) throw new AppError('No se pudo vincular esta publicación de forma confiable con una ficha de Tokko.', 404, 'property_unresolved');
    const property = await detail(ids[0]);
    const verified = property.photos.some(photo => [photo.url, photo.thumbnail].some(value => {
      const identity = photoIdentity(value);
      return identity && photos.some(source => source.id === identity.id && source.fingerprint === identity.fingerprint);
    }));
    if (!verified) throw new AppError('La ficha de Tokko no coincide con las imágenes de la publicación oficial.', 404, 'property_unresolved');
    return { ...property, publicUrl: url, sourceUrl: url };
  }
  async function search(args, { resolvedLocation: previousLocation, onResolvedLocation } = {}) {
    const a = validateSearch(args);
    a.location = a.location?.trim() || 'Lima, Perú';
    let resolvedLocation;
    if (canReuseLocation(previousLocation,a.location)) resolvedLocation=previousLocation;
    else {
      async function lookup(q, scope) {
        const locations=[];
        let offset=0, more=true, capped=false;
        while(more) {
          const result=await request('location/quicksearch/',{q,scope,limit:'100',offset:String(offset)});
          const page=Array.isArray(result) ? result : result.objects;
          if(!Array.isArray(page)) throw new AppError('Tokko devolvió ubicaciones no válidas.',502,'invalid_response');
          if(page.some(l=>!l || typeof l.name!=='string' || typeof l.full_location!=='string' || !Number.isSafeInteger(Number(l.id)) || Number(l.id)<=0))
            throw new AppError('Tokko devolvió identificadores o jerarquías no válidos.',502,'invalid_response');
          const before=new Set(locations.map(l=>l.id+'|'+l.full_location));
          locations.push(...page);
          offset+=page.length;
          const total=Number(result.meta?.total_count);
          more=Boolean(result.meta?.next) || Number.isSafeInteger(total) && offset<total;
          capped ||= !more && page.length>=100;
          if(more && (!page.length || page.every(l=>before.has(l.id+'|'+l.full_location))))
            throw new AppError('Tokko no permitió completar la resolución de ubicaciones.',502,'invalid_response');
        }
        return {locations,capped};
      }
      const broad=await lookup(locationKey(a.location)||'lima','full');
      const locations=[...broad.locations], parents=missingLocationParents(locations,a.location);
      // quicksearch puede declarar total_count=100 y next=null aun sin incluir el padre.
      // Refinar por el nombre de ese padre observado evita confundir esa muestra con un catálogo completo.
      for(const name of new Set(parents.map(parent=>parent.name))) {
        const precise=await lookup(name,'minimal');
        locations.push(...precise.locations.filter(l=>parents.some(parent=>locationPath(l.full_location).join('|')===locationPath(parent.path).join('|'))));
      }
      const selected=resolveCandidates(locations,a.location);
      if(selected.needsLocation && (parents.length || broad.capped)) return {
        locationUnavailable:true,properties:[],filters:a,locations:selected.locations || [],
        message:'La ubicación solicitada ya está clara, pero Tokko no permitió verificar su ámbito seleccionable con estas consultas. No es una búsqueda sin inmuebles ni se resuelve repitiendo la misma confirmación. Hace falta revisar el catálogo de ubicaciones del proveedor.',
      };
      if(!selected.ids) return {...selected,filters:a};
      resolvedLocation=selected;
      if(!locationKey(a.location)) {
        const root=await request('location/'+selected.ids[0]+'/');
        const stateId=typeof root.state==='string' ? Number(root.state.match(/\/state\/(\d+)\//)?.[1]) : Number(root.state?.id);
        if(Number.isSafeInteger(stateId) && stateId>0) resolvedLocation={...selected,ids:[stateId],type:'state'};
      }
    }
    if (typeof onResolvedLocation === 'function') onResolvedLocation(resolvedLocation);
    const locationId=resolvedLocation.ids, locationType=resolvedLocation.type;
    const filters = [];
    for (const [key, field] of [['bedrooms', 'suite_amount'], ['rooms', 'room_amount'], ['bathrooms', 'bathroom_amount'], ['parking', 'parking_lot_amount'], ['area', 'total_surface']]) {
      if (a[`min_${key}`] !== null) filters.push([field, '>=', a[`min_${key}`]]);
      if (a[`max_${key}`] !== null) filters.push([field, '<=', a[`max_${key}`]]);
    }
    const data = { current_localization_id: locationId, current_localization_type: locationType, price_from: a.min_price ?? 0, price_to: a.max_price ?? 999999999, currency: a.currency || 'ANY', operation_types: a.operation ? [a.operation] : [1, 2, 3], property_types: a.property_types, filters, only_available: 'checked' };
    // Verificación conservadora: solo etiquetas positivas explícitas de Tokko.
    // La mera mención en descripción puede decir «sin piscina» o «piscina cercana».
    const scanLimit = a.features.length ? 100 : 5;
    const result = await request('property/search/', { data: JSON.stringify(data), limit: String(scanLimit), offset: String(a.offset), order_by: 'price', order: 'asc' });
    if (!Array.isArray(result.objects) || result.meta?.total_count == null || !Number.isSafeInteger(Number(result.meta.total_count)) || Number(result.meta.total_count) < 0) throw new AppError('Tokko devolvió una búsqueda no válida.', 502, 'invalid_response');
    const aliases = [['piscina', 'pileta', 'swimming pool'], ['gimnasio', 'gym'], ['ascensor', 'elevador'], ['balcon', 'balcony'], ['terraza', 'terrace']];
    const matches = p => a.features.every(term => {
      const terms = aliases.find(group => group.includes(fold(term))) || [fold(term)];
      const tags = (p.tags || []).map(t => fold(t.name));
      return terms.some(t => tags.includes(t));
    });
    const selected = result.objects.filter(matches);
    const page = selected.slice(0, 5);
    // Fichas completas: nunca reducir las fotos a la portada de la búsqueda.
    if(page.some(p=>propertyInLocation(p.location?.full_location,resolvedLocation)===false))
      throw new AppError('Tokko devolvió propiedades de otra ubicación. La consulta es inconsistente; no significa que no haya coincidencias.',502,'inconsistent_results');
    const properties = await Promise.all(page.map(p => detail(Number(p.id))));
    if(properties.some(p=>propertyInLocation(p.location,resolvedLocation)===false))
      throw new AppError('El detalle de Tokko no coincide con la ubicación buscada. Intenta nuevamente.',502,'inconsistent_results');
    const consumed = selected.length > 5 ? result.objects.indexOf(selected[5]) : scanLimit;
    const nextOffset = result.meta.next || a.offset + consumed < Number(result.meta.total_count) || selected.length > 5 ? a.offset + consumed : null;
    return { status: properties.length ? 'matches' : 'no_matches', properties, filters: a, resolvedLocation, totalCandidates: Number(result.meta.total_count) || 0, nextOffset, partialFeatureScan: Boolean(a.features.length && nextOffset !== null), message: a.features.length ? 'Características verificadas exclusivamente contra etiquetas explícitas de Tokko. Una mención en descripción no basta. El total corresponde a candidatos antes de este filtro. Si hay más páginas, no afirmes que se agotó el inventario; sin coincidencias, explica que faltan etiquetas verificables, no que sea imposible que exista esa característica.' : null };
  }
  return { search, detail, fromUrl };
}
