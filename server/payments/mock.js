// Development-only processor. It never sees a full card number: the browser sends only
// brand, last 4 digits and expiry. Cards ending in 0002 are declined, like Stripe's test card.
const crypto = require('node:crypto');

module.exports = function createMockProvider(_config, PaymentError) {
  const intents = new Map();

  return {
    mode: 'mock',

    ensureCustomer({ existingId }) {
      return existingId || `cus_mock_${crypto.randomBytes(8).toString('hex')}`;
    },

    createSetupIntent() {
      return { clientSecret: null };
    },

    resolvePaymentMethod({ token }) {
      const brand = String(token?.brand || '').slice(0, 20);
      const last4 = String(token?.last4 || '');
      const expMonth = Number(token?.expMonth);
      const expYear = Number(token?.expYear);
      if (!/^\d{4}$/.test(last4) || !brand || !(expMonth >= 1 && expMonth <= 12) || !(expYear >= 2000)) {
        throw new PaymentError('Card details are incomplete.');
      }
      const now = new Date();
      if (expYear < now.getFullYear() || (expYear === now.getFullYear() && expMonth < now.getMonth() + 1)) {
        throw new PaymentError('This card has expired.');
      }
      return { ref: `pm_mock_${crypto.randomBytes(8).toString('hex')}_${last4}`, brand, last4, expMonth, expYear };
    },

    detach() {},

    authorize({ amountCents, paymentRef }) {
      if (String(paymentRef).endsWith('_0002')) throw new PaymentError('Your card was declined.');
      const ref = `pi_mock_${crypto.randomBytes(10).toString('hex')}`;
      intents.set(ref, { amountCents, status: 'authorized' });
      return { ref, status: 'authorized' };
    },

    authorizationStatus(ref) {
      return intents.get(ref)?.status === 'authorized' ? 'authorized' : 'failed';
    },

    capture(ref) {
      const intent = intents.get(ref);
      if (intent) intent.status = 'captured';
    },

    void(ref) {
      const intent = intents.get(ref);
      if (intent) intent.status = 'canceled';
    },
  };
};
