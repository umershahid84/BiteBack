// Stores restaurant-uploaded food photos. The browser resizes images before upload;
// here we only accept JPEG, PNG or WebP (checked by file signature) up to 3 MB.
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const { bad } = require('./errors');

const MAX_BYTES = 3 * 1024 * 1024;

function detectType(buf) {
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'jpg';
  if (buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'webp';
  return null;
}

function createImageStore(dir) {
  fs.mkdirSync(dir, { recursive: true });
  return {
    dir,
    // Saves a data URL and returns its public path (/uploads/<file>).
    saveDataUrl(dataUrl) {
      const m = /^data:image\/(?:jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) throw bad('Please choose a JPEG, PNG or WebP photo.');
      const buf = Buffer.from(m[1], 'base64');
      if (buf.length > MAX_BYTES) throw bad('Photo is too large (max 3 MB).');
      const ext = detectType(buf);
      if (!ext) throw bad('Please choose a JPEG, PNG or WebP photo.');
      const name = `${crypto.randomBytes(12).toString('hex')}.${ext}`;
      fs.writeFileSync(path.join(dir, name), buf);
      return `/uploads/${name}`;
    },
  };
}

module.exports = { createImageStore };
