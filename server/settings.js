// Business settings the owner can change in the admin console. Stored in the `settings` table and
// applied on top of config (so the rest of the app keeps reading config.serviceFeeBps etc.).
const KEYS = {
  serviceFeeBps: { type: 'int', min: 0, max: 3000 },
  defaultTaxRateBps: { type: 'int', min: 0, max: 2000 },
  requireRestaurantApproval: { type: 'bool' },
};

function createSettings(db, config, { onChange } = {}) {
  const load = () => {
    for (const { key, value } of db.prepare('SELECT key, value FROM settings').all()) {
      if (KEYS[key]) config[key] = KEYS[key].type === 'bool' ? value === 'true' : Number(value);
    }
  };
  load();
  return {
    get: () => Object.fromEntries(Object.keys(KEYS).map((k) => [k, config[k]])),
    // Validates and saves; returns the list of keys that changed.
    set(values) {
      const changed = [];
      for (const [key, raw] of Object.entries(values)) {
        const def = KEYS[key];
        if (!def || raw === undefined) continue;
        const value = def.type === 'bool' ? Boolean(raw) : Math.round(Number(raw));
        if (def.type === 'int' && !(Number.isFinite(value) && value >= def.min && value <= def.max)) {
          const e = new Error(`Invalid value for ${key}.`);
          e.status = 400;
          throw e;
        }
        if (config[key] !== value) changed.push(key);
        db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(value));
        config[key] = value;
      }
      if (changed.length) onChange?.(changed);
      return changed;
    },
  };
}

module.exports = { createSettings };
