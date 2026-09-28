// Populates the database with demo accounts and offers around greater Seattle.
// Usage: npm run seed   (adds data; safe to re-run, existing demo accounts are reused)
process.env.TZ ||= 'America/Los_Angeles';

const fs = require('node:fs');
const path = require('node:path');
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

// Real photos for demo dishes can be dropped into public/assets/demo-food/<photo>.jpg (see README).
const PHOTO_DIR = path.join(__dirname, '..', 'public', 'assets', 'demo-food');
const photoPath = (name) => (fs.existsSync(path.join(PHOTO_DIR, `${name}.jpg`)) ? `/assets/demo-food/${name}.jpg` : null);

// Menus: [restaurant user, item name, description, dietary, price, demo photo file name]
const MENU = [
  ['harborpho', 'Large Beef Pho', 'Rare steak & brisket in 12-hour beef broth with rice noodles, herbs and lime.', '', 16.95, 'beef-pho'],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'Crispy lemongrass tofu, pickled carrot, cucumber and cilantro on a toasted baguette.', 'vegetarian,dairy-free', 11.5, 'tofu-banh-mi'],
  ['harborpho', 'Fresh Spring Rolls (3)', 'Shrimp, vermicelli and herbs with peanut sauce.', 'gluten-free', 8.5, 'spring-rolls'],
  ['ballardbread', 'Bakery Surprise Bag', 'Assorted croissants, scones and a loaf from today.', 'vegetarian', 24, 'surprise-bag'],
  ['ballardbread', 'Seeded Sourdough Loaf', 'Naturally leavened, baked this morning.', 'vegan', 9, 'sourdough'],
  ['ballardbread', 'Chocolate Croissant', 'All-butter croissant with dark chocolate.', 'vegetarian', 5, 'choc-croissant'],
  ['caphilltacos', 'Carnitas Burrito Plate', 'Slow-cooked pork, rice, beans and salsa verde.', 'gluten-free', 15.25, 'burrito-plate'],
  ['caphilltacos', 'Veggie Taco Trio', 'Roasted sweet potato, black bean and poblano tacos.', 'vegetarian', 12, 'veggie-tacos'],
  ['caphilltacos', 'Chips & Guacamole', 'House-made tortilla chips and fresh guacamole.', 'vegan,gluten-free', 7, 'chips-guac'],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'San Marzano tomato, fresh mozzarella and basil.', 'vegetarian', 24, 'margherita'],
  ['fremontpizza', 'Pepperoni Slices (2)', 'Two big New York-style slices.', '', 8, 'pepperoni'],
  ['fremontpizza', 'Caesar Salad', 'Romaine, parmesan, croutons and lemon Caesar dressing.', 'vegetarian', 10, 'caesar-salad'],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'Tandoori chicken in creamy tomato masala with basmati rice.', 'gluten-free', 17.5, 'tikka-masala'],
  ['bellevuecurry', 'Chana Masala Bowl', 'Chickpeas simmered with tomato, ginger and spices.', 'vegan,gluten-free', 13, 'chana-masala'],
  ['bellevuecurry', 'Garlic Naan', 'Fresh from the tandoor.', 'vegetarian', 4.5, 'garlic-naan'],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'Ahi tuna, avocado, cucumber and seaweed salad over rice.', 'dairy-free', 16, 'poke-bowl'],
  ['kirklandsushi', "Chef's Nigiri Set (8 pc)", "Chef's selection of seasonal nigiri.", 'gluten-free', 32, 'nigiri'],
  ['kirklandsushi', 'Veggie Roll Combo', 'Avocado, cucumber and sweet potato rolls.', 'vegan', 14, 'veggie-rolls'],
  ['kirklandsushi', 'Miso Soup', 'Tofu, wakame and scallion.', 'vegan', 4, 'miso-soup'],
];

// Offers: [restaurant user, menu item name, reason, note (optional), discount %, qty, starts in (h), window (h)]
const OFFERS = [
  ['harborpho', 'Large Beef Pho', 'wrong_order', 'Customer ordered chicken instead. Broth and noodles packed separately.', 50, 2, 0, 3],
  ['harborpho', 'Lemongrass Tofu Banh Mi', 'delayed_order', 'Freshly made, delivery driver never arrived.', 40, 3, 0, 2],
  ['ballardbread', 'Bakery Surprise Bag', 'end_of_day', '', 65, 6, 1, 3],
  ['ballardbread', 'Seeded Sourdough Loaf', 'overproduction', '', 45, 4, 0, 5],
  ['caphilltacos', 'Carnitas Burrito Plate', 'wrong_order', 'Order was placed twice by mistake.', 55, 1, 0, 2],
  ['caphilltacos', 'Veggie Taco Trio', 'unclaimed_order', '', 40, 2, 0, 4],
  ['fremontpizza', 'Whole Margherita Pizza (16")', 'unclaimed_order', 'Pickup order never collected. Still warm!', 60, 1, 0, 2],
  ['fremontpizza', 'Pepperoni Slices (2)', 'end_of_day', '', 50, 8, 0, 3],
  ['bellevuecurry', 'Chicken Tikka Masala + Rice', 'overproduction', 'Catering overage from a corporate lunch.', 50, 10, 0, 4],
  ['bellevuecurry', 'Chana Masala Bowl', 'delayed_order', '', 45, 2, 0, 3],
  ['redmondpoke', 'Ahi Poke Bowl (Regular)', 'wrong_order', 'Wrong base (white rice instead of brown).', 45, 1, 0, 2],
  ['kirklandsushi', "Chef's Nigiri Set (8 pc)", 'unclaimed_order', 'Prepared for a reservation that did not show.', 40, 2, 0, 3],
  ['kirklandsushi', 'Veggie Roll Combo', 'end_of_day', '', 50, 5, 1, 3],
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
    const menuIds = {};
    for (const [user, name, desc, dietary, price, photo] of MENU) {
      const existing = db.prepare('SELECT id FROM menu_items WHERE restaurant_id = ? AND name = ? AND active = 1').get(ids[user], name);
      menuIds[`${user}|${name}`] = existing ? existing.id : Number(db.prepare(`
        INSERT INTO menu_items (restaurant_id, name, description, price_cents, dietary, image_path) VALUES (?, ?, ?, ?, ?, ?)`)
        .run(ids[user], name, desc, Math.round(price * 100), dietary, photoPath(photo)).lastInsertRowid);
    }
    const now = Date.now();
    const hour = 3600 * 1000;
    for (const [user, itemName, reason, note, pct, qty, startIn, windowH] of OFFERS) {
      const item = db.prepare('SELECT * FROM menu_items WHERE id = ?').get(menuIds[`${user}|${itemName}`]);
      const start = new Date(now + startIn * hour - 10 * 60 * 1000);
      const end = new Date(start.getTime() + windowH * hour);
      db.prepare(`INSERT INTO offers (restaurant_id, menu_item_id, image_path, title, description, reason, dietary, original_price_cents,
                  discount_pct, quantity_total, quantity_available, pickup_start, pickup_end) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(ids[user], item.id, item.image_path, item.name, note || item.description, reason, item.dietary, item.price_cents,
          pct, qty, qty, start.toISOString(), end.toISOString());
    }
  });

  console.log('Seeded demo data.');
  console.log(`  Customer login:   demo / ${DEMO_PASSWORD}`);
  console.log(`  Restaurant login: ${RESTAURANTS.map((r) => r.user).join(', ')} / ${DEMO_PASSWORD}`);
}

main();
