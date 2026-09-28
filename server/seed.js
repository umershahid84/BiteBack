// Populates the database with demo accounts and offers around greater Seattle.
// Usage: npm run seed   (adds data; safe to re-run, existing demo accounts are reused)
process.env.TZ ||= 'America/Los_Angeles';

const config = require('./config');
const { openDatabase, transaction } = require('./db');
const { hashPassword } = require('./auth');

const DEMO_PASSWORD = 'BiteBack123';

const RESTAURANTS = [
  { user: 'harborpho', name: 'Harbor Pho House', cuisine: 'Vietnamese', address: '1410 2nd Ave', city: 'Seattle', zip: '98101', lat: 47.6087, lng: -122.3385, tax: 1035 },
  { user: 'ballardbread', name: 'Ballard Bread Co.', cuisine: 'Bakery', address: '5320 Ballard Ave NW', city: 'Seattle', zip: '98107', lat: 47.6665, lng: -122.3829, tax: 1035 },
  { user: 'caphilltacos', name: 'Capitol Hill Taqueria', cuisine: 'Mexican', address: '401 Broadway E', city: 'Seattle', zip: '98102', lat: 47.6224, lng: -122.3210, tax: 1035 },
  { user: 'fremontpizza', name: 'Fremont Pizza Works', cuisine: 'Pizza', address: '3510 Fremont Ave N', city: 'Seattle', zip: '98103', lat: 47.6510, lng: -122.3502, tax: 1035 },
  { user: 'bellevuecurry', name: 'Bellevue Curry Kitchen', cuisine: 'Indian', address: '10500 NE 8th St', city: 'Bellevue', zip: '98004', lat: 47.6170, lng: -122.2015, tax: 1030 },
  { user: 'redmondpoke', name: 'Redmond Poke Shack', cuisine: 'Hawaiian', address: '16500 NE 74th St', city: 'Redmond', zip: '98052', lat: 47.6710, lng: -122.1180, tax: 1030 },
  { user: 'kirklandsushi', name: 'Kirkland Sushi Bar', cuisine: 'Japanese', address: '120 Park Ln', city: 'Kirkland', zip: '98033', lat: 47.6760, lng: -122.2060, tax: 1030 },
];

// [restaurant user, title, description, reason, dietary, price, discount %, qty, starts in (h), window (h)]
const OFFERS = [
  ['harborpho', 'Large Beef Pho', 'Rare steak & brisket pho. Customer ordered chicken instead — broth and noodles packed separately.', 'wrong_order', '', 16.95, 50, 2, 0, 3],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'Freshly made, delivery driver never arrived.', 'delayed_order', 'vegetarian,dairy-free', 11.5, 40, 3, 0, 2],
  ['ballardbread', 'Bakery Surprise Bag', 'Assorted croissants, scones and a sourdough loaf from today.', 'end_of_day', 'vegetarian', 24, 65, 6, 1, 3],
  ['ballardbread', 'Seeded Sourdough Loaf', 'Baked this morning.', 'overproduction', 'vegan', 9, 45, 4, 0, 5],
  ['caphilltacos', 'Carnitas Burrito Plate', 'Order was placed twice by mistake. Rice, beans & salsa verde.', 'wrong_order', 'gluten-free', 15.25, 55, 1, 0, 2],
  ['caphilltacos', 'Taco Trio (Veggie)', 'Roasted sweet potato, black bean & poblano tacos.', 'unclaimed_order', 'vegetarian', 12, 40, 2, 0, 4],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'Pickup order never collected. Still warm!', 'unclaimed_order', 'vegetarian', 24, 60, 1, 0, 2],
  ['fremontpizza', 'Pepperoni Slices (2)', 'End of lunch service slices.', 'end_of_day', '', 8, 50, 8, 0, 3],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'Catering overage from a corporate lunch.', 'overproduction', 'gluten-free', 17.5, 50, 10, 0, 4],
  ['bellevuecurry', 'Chana Masala Bowl', 'Delivery was delayed and cancelled by customer.', 'delayed_order', 'vegan,gluten-free', 13, 45, 2, 0, 3],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'Wrong base (white rice instead of brown).', 'wrong_order', 'dairy-free', 16, 45, 1, 0, 2],
  ['kirklandsushi', 'Chef\'s Nigiri Set (8 pc)', 'Prepared for a reservation that did not show.', 'unclaimed_order', 'gluten-free', 32, 40, 2, 0, 3],
  ['kirklandsushi', 'Veggie Roll Combo', 'End-of-day rolls, made fresh this afternoon.', 'end_of_day', 'vegan', 14, 50, 5, 1, 3],
];

function main() {
  const db = openDatabase(config.databasePath);
  const hash = hashPassword(DEMO_PASSWORD);
  const userId = (email, username, role) => {
    const existing = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
    if (existing) return existing.id;
    return Number(db.prepare('INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)').run(email, username, hash, role).lastInsertRowid);
  };

  transaction(db, () => {
    userId('demo@biteback.test', 'demo', 'customer');
    const ids = {};
    for (const r of RESTAURANTS) {
      const uid = userId(`${r.user}@biteback.test`, r.user, 'restaurant');
      const existing = db.prepare('SELECT id FROM restaurants WHERE owner_user_id = ?').get(uid);
      ids[r.user] = existing ? existing.id : Number(db.prepare(`
        INSERT INTO restaurants (owner_user_id, name, cuisine, description, address, city, zip, phone, lat, lng, tax_rate_bps)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(uid, r.name, r.cuisine, `Neighborhood ${r.cuisine.toLowerCase()} spot in ${r.city}.`, r.address, r.city, r.zip,
          '(206) 555-01' + String(Object.keys(ids).length).padStart(2, '0'), r.lat, r.lng, r.tax).lastInsertRowid);
    }
    const now = Date.now();
    const hour = 3600 * 1000;
    for (const [user, title, desc, reason, dietary, price, pct, qty, startIn, windowH] of OFFERS) {
      const start = new Date(now + startIn * hour - 10 * 60 * 1000);
      const end = new Date(start.getTime() + windowH * hour);
      db.prepare(`INSERT INTO offers (restaurant_id, title, description, reason, dietary, original_price_cents, discount_pct,
                  quantity_total, quantity_available, pickup_start, pickup_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ids[user], title, desc, reason, dietary, Math.round(price * 100), pct, qty, qty, start.toISOString(), end.toISOString());
    }
  });

  console.log('Seeded demo data.');
  console.log(`  Customer login:   demo / ${DEMO_PASSWORD}`);
  console.log(`  Restaurant login: ${RESTAURANTS.map((r) => r.user).join(', ')} / ${DEMO_PASSWORD}`);
}

main();
