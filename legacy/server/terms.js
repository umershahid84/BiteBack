// Records which legal documents each user accepted, and checks whether they are up to date.
const { HttpError } = require('./errors');

function createTermsService({ db, legal }) {
  const insert = db.prepare('INSERT INTO terms_acceptances (user_id, document, version, ip, user_agent) VALUES (?, ?, ?, ?, ?)');
  const has = db.prepare('SELECT 1 FROM terms_acceptances WHERE user_id = ? AND document = ? AND version = ?');

  // Throws unless `accepted` ({ docId: version }) covers every current document for the role.
  function assertAccepted(role, accepted) {
    const missing = legal.required(role).filter((d) => !accepted || accepted[d.id] !== d.version);
    if (missing.length) {
      throw new HttpError(400, `To create an account you must accept the ${missing.map((d) => d.title).join(' and ')}.`, { code: 'terms_required' });
    }
  }

  function record(userId, role, req) {
    for (const d of legal.required(role)) {
      insert.run(userId, d.id, d.version, String(req.ip || '').slice(0, 64), String(req.get('user-agent') || '').slice(0, 300));
    }
  }

  const pending = (user) => legal.required(user.role).filter((d) => !has.get(user.id, d.id, d.version));

  // Middleware: signed-in users must accept updated terms before using the service.
  function gate(req, _res, next) {
    if (req.user && pending(req.user).length) {
      return next(new HttpError(403, 'Please review and accept our updated terms to continue.', { code: 'terms_required' }));
    }
    next();
  }

  return { assertAccepted, record, pending, gate };
}

module.exports = { createTermsService };
