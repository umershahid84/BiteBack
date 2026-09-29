// Payment processing. Cards are authorized (a hold is placed) when the customer orders,
// and captured (actually charged) when the restaurant confirms pickup with the PIN.
//
// Provider interface:
//   mode                                     'stripe' | 'mock'
//   ensureCustomer({ email, username, existingId }) -> customer id
//   createSetupIntent(customerId)            -> { clientSecret }   (stripe only)
//   resolvePaymentMethod({ customerId, token, save }) -> { ref, brand, last4, expMonth, expYear }
//   detach(ref)
//   authorize({ amountCents, customerId, paymentRef, description, metadata })
//        -> { ref, status: 'authorized' | 'requires_action', clientSecret? }   throws PaymentError
//   authorizationStatus(ref)                 -> 'authorized' | 'requires_action' | 'failed'
//   capture(ref)
//   refund(ref, amountCents)                 -> { id }   (captured payments only)
//   void(ref)

class PaymentError extends Error {
  constructor(message) {
    super(message);
    this.status = 402;
  }
}

function createPaymentProvider(config) {
  if (config.stripeSecretKey) return require('./stripe')(config, PaymentError);
  return require('./mock')(config, PaymentError);
}

module.exports = { createPaymentProvider, PaymentError };
