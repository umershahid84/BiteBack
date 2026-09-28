const express = require('express');
const v = require('../validate');
const { hashPassword, verifyPassword, createLimiter } = require('../auth');
const { HttpError } = require('../errors');
const { transaction } = require('../db');
const { lookupZip, listAreas } = require('../areas');

module.exports = function authRoutes({ db, config, sessions, payments, terms }) {
  const router = express.Router();
  const loginLimiter = createLimiter({ max: 10, windowMs: 15 * 60 * 1000 });

  const findByLogin = db.prepare('SELECT * FROM users WHERE email = ? OR username = ?');
  const findRestaurant = db.prepare('SELECT * FROM restaurants WHERE owner_user_id = ?');

  function publicUser(user) {
    const out = { id: user.id, email: user.email, username: user.username, role: user.role, pendingTerms: terms.pending(user) };
    if (user.role === 'restaurant') out.restaurant = findRestaurant.get(user.id) || null;
    if (user.role === 'customer') out.creditCents = db.prepare('SELECT COALESCE(SUM(amount_cents), 0) AS b FROM credit_ledger WHERE user_id = ?').get(user.id).b;
    return out;
  }

  router.post('/signup', (req, res) => {
    const body = req.body || {};
    const role = body.role === 'restaurant' ? 'restaurant' : 'customer';
    const email = v.email(body.email);
    const username = v.username(body.username);
    const password = v.password(body.password);

    let restaurant = null;
    if (role === 'restaurant') {
      const r = body.restaurant || {};
      restaurant = {
        name: v.str(r.name, 'Restaurant name', { min: 2, max: 80 }),
        address: v.str(r.address, 'Street address', { min: 3, max: 120 }),
        city: v.str(r.city, 'City', { min: 2, max: 60 }),
        zip: v.zip(r.zip),
        phone: v.str(r.phone, 'Phone', { max: 30, optional: true }),
        cuisine: v.str(r.cuisine, 'Cuisine', { max: 40, optional: true }),
        lat: v.coord(r.lat, 'Latitude', 90),
        lng: v.coord(r.lng, 'Longitude', 180),
      };
      // Until the owner pins the exact spot, place the restaurant at its ZIP code's center.
      const z = lookupZip(restaurant.zip);
      if ((restaurant.lat == null || restaurant.lng == null) && z) Object.assign(restaurant, { lat: z.lat, lng: z.lng });
    }

    if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) throw new HttpError(409, 'An account with this email already exists.');
    if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(username)) throw new HttpError(409, 'That user name is taken.');

    // dryRun: validate the form before showing the agreement, without creating anything.
    if (body.dryRun) return res.json({ ok: true });

    // Admin accounts are created with `npm run create-admin`, never through public sign-up.
    // No account is created unless the current terms for this role were accepted.
    terms.assertAccepted(role, body.acceptedTerms);

    const userId = transaction(db, () => {
      const { lastInsertRowid } = db
        .prepare('INSERT INTO users (email, username, password_hash, role) VALUES (?, ?, ?, ?)')
        .run(email, username, hashPassword(password), role);
      if (restaurant) {
        db.prepare(`INSERT INTO restaurants (owner_user_id, name, address, city, zip, phone, cuisine, lat, lng, tax_rate_bps, status)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
          .run(lastInsertRowid, restaurant.name, restaurant.address, restaurant.city, restaurant.zip, restaurant.phone,
            restaurant.cuisine, restaurant.lat, restaurant.lng, config.defaultTaxRateBps,
            config.requireRestaurantApproval ? 'pending' : 'approved');
      }
      terms.record(Number(lastInsertRowid), role, req);
      return Number(lastInsertRowid);
    });

    sessions.start(res, userId);
    res.status(201).json({ user: publicUser(db.prepare('SELECT * FROM users WHERE id = ?').get(userId)) });
  });

  router.post('/login', (req, res) => {
    const login = String(req.body?.login || '').trim();
    const password = String(req.body?.password || '');
    const key = `${req.ip}|${login.toLowerCase()}`;
    if (!loginLimiter.check(key)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes and try again.');

    const user = login ? findByLogin.get(login, login) : null;
    if (!user || !verifyPassword(password, user.password_hash)) {
      loginLimiter.fail(key);
      throw new HttpError(401, 'Email/user name or password is incorrect.');
    }
    if (user.status !== 'active') throw new HttpError(403, `This account has been suspended. Contact ${config.supportEmail} for help.`);
    loginLimiter.reset(key);
    sessions.start(res, user.id);
    res.json({ user: publicUser(user) });
  });

  // Accepting updated terms (existing users, after a new version is published).
  router.post('/accept-terms', (req, res) => {
    if (!req.user) throw new HttpError(401, 'Please log in.');
    terms.assertAccepted(req.user.role, req.body?.acceptedTerms);
    const pending = terms.pending(req.user);
    if (pending.length) {
      transaction(db, () => terms.record(req.user.id, req.user.role, req));
    }
    res.json({ user: publicUser(req.user) });
  });

  router.post('/logout', (req, res) => {
    sessions.end(req, res);
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? publicUser(req.user) : null });
  });

  router.get('/config', (_req, res) => {
    res.json({
      paymentMode: payments.mode,
      stripePublishableKey: payments.mode === 'stripe' ? config.stripePublishableKey : null,
      serviceFeeBps: config.serviceFeeBps,
      reasons: v.OFFER_REASONS,
      supportEmail: config.supportEmail,
      map: { tileUrl: config.mapTileUrl, attribution: config.mapAttribution, darkFilter: config.mapDarkFilter },
      dietaryTags: v.DIETARY_TAGS,
    });
  });

  router.get('/areas', (_req, res) => {
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.json(listAreas());
  });

  return router;
};
