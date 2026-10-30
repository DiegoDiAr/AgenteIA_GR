// Jerarquías e IDs proceden exclusivamente de Tokko; no hay catálogo local de distritos.
const fold = value => String(value ?? '').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().trim();
const part = value => fold(value).replace(/^(?:provincia|region|departamento|distrito)\s+de\s+/,'').replace(/\s+/g,' ');
export const locationPath = value => String(value ?? '').split('|').map(part).filter(Boolean);
export const locationKey = value => fold(value).replace(/[,;|()]/g,' ').replace(/\b(?:lima|peru)\b/g,'').replace(/\s+/g,' ').trim();
const typeName = location => fold(typeof location.type === 'string' ? location.type : location.type?.name);
const isDistrict = location => /^(?:distrito|district)$/.test(typeName(location));
const isSector = location => /^(?:barrio|sector|urbanizacion|neighborhood|neighbourhood)$/.test(typeName(location));
const metro = location => locationPath(location.full_location).slice(2,-1).includes('lima');
const only = (items, predicate) => { const selected=items.filter(predicate); return selected.length ? selected : items; };
export function resolveCandidates(locations, query) {
  const inLima = locations.filter(l => {
    const path=locationPath(l.full_location);
    return path[0]==='peru' && path[1]==='lima';
  });
  if (!inLima.length) return {needsLocation:!locations.length,outsideCoverage:Boolean(locations.length),locations:[],properties:[],
    message:locations.length ? 'La ubicación está fuera de la cobertura actual: Lima, Perú.' : 'No se pudo resolver la ubicación en Tokko. Conserva los filtros y pide precisar la ciudad o distrito.'};
  const key=locationKey(query), words=(key || 'lima').split(' ');
  let candidates=inLima.filter(l => words.every(word=>fold(l.full_location).split(/[\s|,;()]+/).includes(word)));
  if (!candidates.length) return {needsLocation:true,locations:[],properties:[],message:'No se pudo identificar la ubicación solicitada. No equivale a una búsqueda sin propiedades.'};
  // El tipo de Tokko no equivale al nivel administrativo peruano: los distritos reales
  // de Miraflores y San Miguel también son «Barrio». La jerarquía precede al tipo.
  const direct=candidates.filter(l=>locationPath(l.full_location).length<=3 && locationKey(l.name)===key);
  if(direct.length) candidates=direct;
  else {
    candidates=only(candidates,metro);
    candidates=only(candidates,l=>locationKey(l.name)===key);
  }
  const depth=Math.min(...candidates.map(l=>locationPath(l.full_location).length));
  candidates=candidates.filter(l=>locationPath(l.full_location).length===depth);
  candidates=only(candidates,isDistrict); // Solo desempata el mismo nivel y contexto.
  const directMetro=l=>locationPath(l.full_location).at(-2)==='lima';
  if(candidates.every(l=>isSector(l) && locationKey(l.name)===key && !directMetro(l))) return {needsLocation:true,properties:[],
    locations:candidates.slice(0,12).map(l=>({id:l.id,name:l.full_location,type:l.type})),
    message:'Las opciones publicadas están dentro de otros ámbitos. Aclara su jerarquía completa, no vuelvas a pedir confirmar únicamente el mismo nombre.'};
  const paths=new Set(candidates.map(l=>locationPath(l.full_location).join('|')));
  if(paths.size>1) return {needsLocation:true,properties:[],locations:candidates.slice(0,12).map(l=>({id:l.id,name:l.full_location,type:l.type ?? null})),
    message:'Hay ubicaciones distintas equivalentes. Aclara únicamente cuál de estas jerarquías desea; conserva los demás filtros.'};
  const ids=[...new Set(candidates.map(l=>Number(l.id)))];
  return {ids,type:'division',paths:[...new Set(candidates.map(l=>l.full_location))],queryKey:key,
    candidates:candidates.map(l=>({id:Number(l.id),name:l.name,type:l.type ?? null,full_location:l.full_location}))};
}
// Un padre observado en full_location se consulta por su nombre publicado, nunca por un ID adivinado.
export function missingLocationParents(locations, query) {
  const key=locationKey(query), missing=new Map();
  if(!key) return [];
  const available=new Set(locations.map(l=>locationPath(l.full_location).join('|')));
  for(const location of locations) {
    const raw=location.full_location.split('|').map(p=>p.trim()), path=locationPath(location.full_location);
    if(path[0]!=='peru' || path[1]!=='lima') continue;
    for(let i=2;i<raw.length-1;i++) {
      const parent=raw.slice(0,i+1).join(' | '), canonical=locationPath(parent).join('|');
      if(locationKey(raw[i])===key && !available.has(canonical)) missing.set(canonical,{name:raw[i],path:parent});
    }
  }
  return [...missing.values()];
}

export function canReuseLocation(resolved, query) {
  return resolved && resolved.queryKey===locationKey(query) && ['division','state'].includes(resolved.type)
    && Array.isArray(resolved.ids) && resolved.ids.length>0 && resolved.ids.every(id=>Number.isSafeInteger(id) && id>0)
    && Array.isArray(resolved.paths) && resolved.paths.length>0;
}
function compact(path) { return path.filter((p,i)=>!i || p!==path[i-1]); }
export function propertyInLocation(value, resolved) {
  // Sin jerarquía completa no se inventa una ubicación ni una inconsistencia.
  const actual=compact(locationPath(value));
  if(actual.length<3) return null;
  return resolved.paths.some(value=>{
    const expected=compact(locationPath(value));
    const root=resolved.type==='state' ? expected.slice(0,2) : expected;
    return root.length>0 && root.every((part,i)=>actual[i]===part);
  });
}
