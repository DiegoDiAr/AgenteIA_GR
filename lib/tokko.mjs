import { AppError, fetchJson } from './errors.mjs';

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

export function createTokko({ apiKey, fetchImpl = fetch }) {
  async function request(path, params = {}) {
    if (!apiKey) throw new AppError('Falta TOKKO_API_KEY en el archivo .env del backend.', 503, 'missing_tokko_key');
    const url = new URL(path, BASE);
    url.search = new URLSearchParams({ format: 'json', lang: 'es_ar', key: apiKey, ...params });
    const data = await fetchJson(fetchImpl, url, {}, 'Tokko');
    if (data.error || data.error_message) throw new AppError('Tokko no pudo completar la consulta. Revisa los permisos de la cuenta.', 502, 'tokko_error');
    return data;
  }
  async function detail(id) {
    if (!Number.isSafeInteger(id) || id <= 0) throw new AppError('Identificador de propiedad no válido.', 400, 'invalid_property');
    const data = await request(`property/${id}/`);
    if (Number(data.id) !== id) throw new AppError('Tokko devolvió una ficha no válida.', 502, 'invalid_response');
    return normalizeProperty(data);
  }
  async function search(args) {
    const a = validateSearch(args);
    a.location = a.location?.trim() || 'Lima, Perú';
    let locationId, locationType = 'division';
    {
      const query = fold(a.location).replace(/[,;|()]/g, ' ').replace(/\s+/g, ' ').trim();
      const result = await request('location/quicksearch/', { q: query, scope: 'full', limit: '100' });
      const locations = Array.isArray(result) ? result : result.objects;
      if (!Array.isArray(locations)) throw new AppError('Tokko devolvió ubicaciones no válidas.', 502, 'invalid_response');
      const parts = l => fold(l.full_location).split('|').map(p => p.trim()).filter(Boolean);
      // La cobertura comercial resuelve homónimos internacionales, sin lista de distritos.
      const inLima = locations.filter(l => { const path = parts(l); return path[0] === 'peru' && path[1] === 'lima'; });
      if (!inLima.length) return { needsLocation: !locations.length, outsideCoverage: Boolean(locations.length), message: locations.length ? 'La ubicación está fuera de la cobertura actual de Grupo Rentabilizarme: Lima, Perú. No ofrezcas propiedades de otras ciudades como parte de su catálogo.' : 'No se pudo resolver la ubicación en Tokko. Conserva los filtros y pide únicamente precisar la ciudad o distrito en Lima; no exijas calle ni características adicionales.', locations: [], properties: [], filters: a };
      const place = value => fold(value).replace(/[,;|()]/g, ' ').replace(/\b(?:lima|peru)\b/g, '').replace(/\s+/g, ' ').trim();
      const exact = inLima.filter(l => place(l.name) === place(a.location));
      const candidates = exact.length ? exact : inLima;
      // Elegir el ámbito solicitado (ciudad/distrito), no una urbanización hija.
      const depth = Math.min(...candidates.map(l => parts(l).length));
      const preferred = candidates.filter(l => parts(l).length === depth);
      const paths = new Set(preferred.map(l => parts(l).join('|')));
      if (paths.size > 1) return { needsLocation: true, message: 'Hay lugares distintos con ese nombre dentro de Lima. Pregunta solo cuál de estas ubicaciones desea; no solicites una calle ni repitas los demás filtros.', locations: preferred.slice(0, 12).map(l => ({ id: l.id, name: l.full_location || l.name })), properties: [], filters: a };
      locationId = [...new Set(preferred.map(l => Number(l.id)))];
      if (preferred.some(l => !Number.isSafeInteger(Number(l.id)) || Number(l.id) <= 0)) throw new AppError('Tokko devolvió identificadores de ubicación no válidos.', 502, 'invalid_response');
      if (!place(a.location)) {
        // Lima completa: el ID de región se obtiene del proveedor, sin fijarlo en código.
        const root = await request(`location/${locationId[0]}/`);
        const stateId = typeof root.state === 'string' ? Number(root.state.match(/\/state\/(\d+)\//)?.[1]) : Number(root.state?.id);
        if (Number.isSafeInteger(stateId) && stateId > 0) { locationId = [stateId]; locationType = 'state'; }
      }
    }
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
    if (!Array.isArray(result.objects) || !result.meta) throw new AppError('Tokko devolvió una búsqueda no válida.', 502, 'invalid_response');
    const aliases = [['piscina', 'pileta', 'swimming pool'], ['gimnasio', 'gym'], ['ascensor', 'elevador'], ['balcon', 'balcony'], ['terraza', 'terrace']];
    const matches = p => a.features.every(term => {
      const terms = aliases.find(group => group.includes(fold(term))) || [fold(term)];
      const tags = (p.tags || []).map(t => fold(t.name));
      return terms.some(t => tags.includes(t));
    });
    const selected = result.objects.filter(matches);
    const page = selected.slice(0, 5);
    // Fichas completas: nunca reducir las fotos a la portada de la búsqueda.
    const properties = await Promise.all(page.map(p => detail(Number(p.id))));
    const consumed = selected.length > 5 ? result.objects.indexOf(selected[5]) : scanLimit;
    const nextOffset = result.meta.next || a.offset + consumed < Number(result.meta.total_count) || selected.length > 5 ? a.offset + consumed : null;
    return { properties, filters: a, totalCandidates: Number(result.meta.total_count) || 0, nextOffset, partialFeatureScan: Boolean(a.features.length && nextOffset !== null), message: a.features.length ? 'Características verificadas exclusivamente contra etiquetas explícitas de Tokko. Una mención en descripción no basta. El total corresponde a candidatos antes de este filtro. Si hay más páginas, no afirmes que se agotó el inventario; sin coincidencias, explica que faltan etiquetas verificables, no que sea imposible que exista esa característica.' : null };
  }
  return { search, detail };
}
