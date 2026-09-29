import { NextResponse, type NextRequest } from 'next/server';
import type Stripe from 'stripe';
import { serverEnv } from '@/lib/env';
import * as orders from '@/lib/orders';
import { constructWebhookEvent } from '@/lib/payments/stripe';
import { supabaseAdmin } from '@/lib/supabase/admin';

// Stripe webhook (Dashboard → Developers → Webhooks → endpoint https://<site>/api/stripe/webhook).
// Listen to "Connected accounts" events: account.updated; and "Your account" events:
// payment_intent.amount_capturable_updated, payment_intent.payment_failed.
export async function POST(req: NextRequest) {
  if (!serverEnv.stripeSecretKey || !serverEnv.stripeWebhookSecret) {
    return NextResponse.json({ error: 'Stripe webhooks are not configured.' }, { status: 501 });
  }
  let event: Stripe.Event;
  try {
    event = constructWebhookEvent(serverEnv.stripeSecretKey, await req.text(), req.headers.get('stripe-signature') ?? '', serverEnv.stripeWebhookSecret);
  } catch {
    return NextResponse.json({ error: 'Invalid signature.' }, { status: 400 });
  }
  const db = supabaseAdmin();

  switch (event.type) {
    // A restaurant finished (or changed) Stripe onboarding.
    case 'account.updated': {
      const { data } = await db.from('restaurant_payment_accounts').select('restaurant_id').eq('stripe_account_id', event.data.object.id).maybeSingle();
      if (data) await orders.refreshConnectStatus(data.restaurant_id);
      break;
    }
    // Card hold confirmed after 3-D Secure (in case the browser never came back).
    case 'payment_intent.amount_capturable_updated': {
      const orderId = Number(event.data.object.metadata?.order_id);
      if (orderId) await db.rpc('mark_order_reserved', { p_order_id: orderId });
      break;
    }
    case 'payment_intent.payment_failed': {
      const orderId = Number(event.data.object.metadata?.order_id);
      if (orderId) await orders.release(orderId, 'pending_payment', 'failed', true);
      break;
    }
  }
  return NextResponse.json({ received: true });
}
