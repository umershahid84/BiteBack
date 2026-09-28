const fs = require('node:fs');
const path = require('node:path');

const envFile = path.join(__dirname, '..', '.env');
if (fs.existsSync(envFile)) process.loadEnvFile(envFile);

const int = (v, d) => (v === undefined || v === '' ? d : Number.parseInt(v, 10));

module.exports = {
  port: int(process.env.PORT, 3000),
  databasePath: process.env.DATABASE_PATH || path.join(__dirname, '..', 'data', 'biteback.db'),
  serviceFeeBps: int(process.env.SERVICE_FEE_BPS, 500),
  defaultTaxRateBps: int(process.env.DEFAULT_TAX_RATE_BPS, 1035),
  taxServiceFee: process.env.TAX_SERVICE_FEE === 'true',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY || '',
  stripePublishableKey: process.env.STRIPE_PUBLISHABLE_KEY || '',
  cookieSecure: process.env.COOKIE_SECURE === 'true',
  sessionDays: 30,
  // Unpaid checkouts (e.g. waiting on 3-D Secure) are released after this many minutes.
  pendingPaymentMinutes: 15,
  // Reserved orders not picked up this many minutes after the pickup window closes are released.
  pickupGraceMinutes: 30,
};
