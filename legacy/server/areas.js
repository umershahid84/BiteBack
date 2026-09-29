// Puget Sound service area: ZIP codes and cities with approximate center points.
// Data: server/data/puget-sound-zips.json (USPS ZIP list via the MIT-licensed `zipcodes`
// package; coordinates from GeoNames, CC BY 4.0).
const DATA = require('./data/puget-sound-zips.json');

const byZip = new Map(DATA.zips.map((z) => [z.zip, z]));
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// City name -> center (average of its ZIP centers). Primary city names win over alternates.
const cities = new Map();
for (const pass of ['primary', 'alternate']) {
  for (const z of DATA.zips) {
    const names = pass === 'primary' ? [z.city] : z.cities.slice(1);
    for (const name of names) {
      const key = norm(name);
      if (pass === 'alternate' && cities.has(key) && cities.get(key).primary) continue;
      const c = cities.get(key) || { name, county: z.county, primary: pass === 'primary', points: [] };
      c.points.push([z.lat, z.lng]);
      cities.set(key, c);
    }
  }
}
for (const c of cities.values()) {
  c.lat = +(c.points.reduce((n, p) => n + p[0], 0) / c.points.length).toFixed(4);
  c.lng = +(c.points.reduce((n, p) => n + p[1], 0) / c.points.length).toFixed(4);
  c.zips = c.points.length;
}

function lookupZip(zip) {
  return byZip.get(String(zip || '').slice(0, 5)) || null;
}

// Resolves "98198", "Des Moines" or "Des Moines, WA" to a center point, or null.
function resolveArea(query) {
  const q = norm(query).replace(/,?\s*(wa|washington)$/, '');
  if (!q) return null;
  if (/^\d{5}$/.test(q)) {
    const z = lookupZip(q);
    return z ? { label: `${z.zip} (${z.cities.slice(0, 2).join(' / ')})`, lat: z.lat, lng: z.lng, kind: 'zip' } : null;
  }
  const c = cities.get(q);
  return c ? { label: `${c.name}, WA`, lat: c.lat, lng: c.lng, kind: 'city' } : null;
}

function listAreas() {
  return {
    cities: [...cities.values()].filter((c) => c.primary || c.zips > 0)
      .map((c) => ({ name: c.name, county: c.county, lat: c.lat, lng: c.lng }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    zips: DATA.zips.map((z) => ({ zip: z.zip, city: z.city, lat: z.lat, lng: z.lng })),
    attribution: DATA.source,
  };
}

module.exports = { lookupZip, resolveArea, listAreas };
