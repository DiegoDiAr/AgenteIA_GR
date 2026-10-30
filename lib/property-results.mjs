// Identidad de Tokko; nunca se deduplica por título, referencia comercial o fotografía.
export function mergeProperty(previous, property) {
  if (!previous) return property;
  const photos = [...new Map([...previous.photos, ...property.photos].map(photo => [photo.url, photo])).values()];
  return { ...previous, ...property, photos };
}
export function uniqueProperties(properties) {
  const byId = new Map();
  for (const property of properties) {
    const key = String(property.id);
    byId.set(key, mergeProperty(byId.get(key), property));
  }
  return [...byId.values()];
}
