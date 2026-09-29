// Encryption for sensitive values at rest (restaurant bank account numbers). AES-256-GCM.
// Key: DATA_ENCRYPTION_KEY (64 hex chars) in production; otherwise a key file is created next to
// the database on first run. Losing the key means stored bank numbers can't be read.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

function loadKey(config) {
  if (config.dataEncryptionKey) {
    const key = Buffer.from(config.dataEncryptionKey, 'hex');
    if (key.length !== 32) throw new Error('DATA_ENCRYPTION_KEY must be 64 hex characters (32 bytes).');
    return key;
  }
  const file = config.databasePath && config.databasePath !== ':memory:'
    ? path.join(path.dirname(config.databasePath), 'encryption.key')
    : null;
  if (file && fs.existsSync(file)) return Buffer.from(fs.readFileSync(file, 'utf8').trim(), 'hex');
  const key = crypto.randomBytes(32);
  if (file) {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, key.toString('hex'), { mode: 0o600 });
    console.warn(`Created ${file}. Back it up, or set DATA_ENCRYPTION_KEY in production.`);
  }
  return key;
}

function createCipher(config) {
  const key = loadKey(config);
  return {
    encrypt(text) {
      const iv = crypto.randomBytes(12);
      const c = crypto.createCipheriv('aes-256-gcm', key, iv);
      const data = Buffer.concat([c.update(String(text), 'utf8'), c.final()]);
      return `v1:${iv.toString('base64')}:${c.getAuthTag().toString('base64')}:${data.toString('base64')}`;
    },
    decrypt(blob) {
      const [v, iv, tag, data] = String(blob).split(':');
      if (v !== 'v1') throw new Error('Unknown encryption format.');
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64'));
      d.setAuthTag(Buffer.from(tag, 'base64'));
      return Buffer.concat([d.update(Buffer.from(data, 'base64')), d.final()]).toString('utf8');
    },
  };
}

// ABA routing number checksum.
function validRouting(r) {
  if (!/^\d{9}$/.test(r)) return false;
  const d = r.split('').map(Number);
  return (3 * (d[0] + d[3] + d[6]) + 7 * (d[1] + d[4] + d[7]) + (d[2] + d[5] + d[8])) % 10 === 0;
}

module.exports = { createCipher, validRouting };
