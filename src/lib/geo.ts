// Great-circle distance (haversine formula) in miles. Used in the browser for "you are X mi away";
// the database uses PostGIS for searching and sorting.
export function distanceMiles(lat1: number, lng1: number, lat2: number, lng2: number) {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(a));
}

// Puget Sound, for the default map view.
export const REGION_CENTER: [number, number] = [47.45, -122.3];
