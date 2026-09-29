// Sign-up rules and Row Level Security, exercised through the public Supabase API.
import { beforeAll, describe, expect, it } from 'vitest';
import { LEGAL_VERSION } from '@/lib/legal/documents';
import * as orders from '@/lib/orders';
import { accepted, admin, anon, PASSWORD, restaurantWithOffer, signUp, supabaseAvailable, uid, visa } from '../support/db';

const available = await supabaseAvailable();

describe.skipIf(!available)('sign-up', () => {
  it('does not create an account unless the current terms are accepted', async () => {
    const username = `t_${uid()}`;
    const { error } = await anon().auth.signUp({ email: `${username}@example.com`, password: PASSWORD, options: { data: { username, role: 'customer' } } });
    expect(error).toBeTruthy();
    const { data } = await admin().from('profiles').select('id').eq('username', username);
    expect(data).toHaveLength(0);
  });

  it('rejects outdated terms versions', async () => {
    const username = `t_${uid()}`;
    const { error } = await anon().auth.signUp({
      email: `${username}@example.com`, password: PASSWORD,
      options: { data: { username, role: 'customer', accepted_terms: { 'customer-terms': 'old', privacy: 'old' } } },
    });
    expect(error).toBeTruthy();
  });

  it('never creates admins, even if asked', async () => {
    const u = await signUp('customer', { role: 'admin' });
    const { data } = await admin().from('profiles').select('role').eq('id', u.id).single();
    expect(data!.role).toBe('customer');
  });

  it('records the accepted terms, and creates restaurants as pending with a payments row', async () => {
    const u = await signUp('restaurant');
    const db = admin();
    const terms = (await db.from('terms_acceptances').select('document, version').eq('user_id', u.id)).data!;
    expect(terms.map((t) => t.document).sort()).toEqual(['privacy', 'restaurant-agreement']);
    expect(terms.every((t) => t.version === LEGAL_VERSION)).toBe(true);
    const r = (await db.from('restaurants').select('*, restaurant_payment_accounts(*)').eq('owner_id', u.id).single()).data!;
    expect(r.status).toBe('pending');
    expect(r.lat).toBeCloseTo(47.6, 0); // placed at the ZIP code's center
    expect(r.restaurant_payment_accounts).toBeTruthy();
  });

  it('keeps the database and app legal versions in sync', async () => {
    const { data } = await anon().from('legal_documents').select('id, version');
    expect(data!.every((d) => d.version === LEGAL_VERSION)).toBe(true);
    expect(Object.keys(accepted('customer'))).toEqual(['customer-terms', 'privacy']);
  });
});

describe.skipIf(!available)('row level security', () => {
  let shop: Awaited<ReturnType<typeof restaurantWithOffer>>;
  let alice: Awaited<ReturnType<typeof signUp>>;
  let bob: Awaited<ReturnType<typeof signUp>>;
  let orderId: number;

  beforeAll(async () => {
    shop = await restaurantWithOffer();
    alice = await signUp('customer');
    bob = await signUp('customer');
    orderId = (await orders.checkout(alice.id, { offerId: shop.offer.id, quantity: 1, creditCents: 0, newCard: visa })).orderId;
  });

  it('lets anyone see live offers, but no private data', async () => {
    const a = anon();
    expect((await a.rpc('search_offers', { p_query: 'Test Bowl' })).data!.some((o) => o.id === shop.offer.id)).toBe(true);
    expect((await a.from('profiles').select('*')).data).toEqual([]);
    expect((await a.from('orders').select('*')).data).toEqual([]);
    expect((await a.from('restaurant_payment_accounts').select('*')).data).toEqual([]);
  });

  it('hides offers of restaurants that are not approved', async () => {
    const pending = await signUp('restaurant');
    const r = (await admin().from('restaurants').select('id').eq('owner_id', pending.id).single()).data!;
    const item = (await pending.client.from('menu_items').insert({ restaurant_id: r.id, name: 'Hidden Dish', price_cents: 900 }).select('id').single()).data!;
    const res = await pending.client.rpc('restaurant_save_offer', {
      p_offer_id: null as unknown as number, p_menu_item_id: item.id, p_reason: 'other', p_description: '', p_discount_pct: 50, p_quantity: 1, p_expires_in_minutes: 60,
    });
    expect(res.error).toBeNull();
    expect((await anon().from('offers').select('id').eq('id', res.data!.id)).data).toEqual([]);
    await expect(orders.checkout(alice.id, { offerId: res.data!.id, quantity: 1, creditCents: 0, newCard: visa })).rejects.toThrow('no longer available');
  });

  it('shows customers only their own orders and PINs', async () => {
    expect((await alice.client.from('orders').select('id').eq('id', orderId)).data).toHaveLength(1);
    expect((await alice.client.from('order_pins').select('pin').eq('order_id', orderId)).data).toHaveLength(1);
    expect((await bob.client.from('orders').select('id').eq('id', orderId)).data).toEqual([]);
    expect((await bob.client.from('order_pins').select('pin').eq('order_id', orderId)).data).toEqual([]);
  });

  it('lets restaurants see their orders but never the PINs', async () => {
    expect((await shop.owner.client.from('orders').select('id').eq('id', orderId)).data).toHaveLength(1);
    expect((await shop.owner.client.from('order_pins').select('pin').eq('order_id', orderId)).data).toEqual([]);
  });

  it('stops users from changing roles, approval status or ownership', async () => {
    const promote = await alice.client.from('profiles').update({ role: 'admin' }).eq('id', alice.id);
    expect(promote.error).toBeTruthy();
    const approve = await shop.owner.client.from('restaurants').update({ status: 'approved', admin_note: 'self' }).eq('id', shop.restaurant.id);
    expect(approve.error).toBeTruthy();
    const edit = await shop.owner.client.from('restaurants').update({ phone: '(206) 555-0000' }).eq('id', shop.restaurant.id);
    expect(edit.error).toBeNull();
    const other = await bob.client.from('restaurants').update({ phone: '1' }).eq('id', shop.restaurant.id).select('id');
    expect(other.data).toEqual([]);
  });

  it('blocks direct calls to money functions', async () => {
    const r = await alice.client.rpc('reserve_order', { p_user: alice.id, p_offer_id: shop.offer.id, p_quantity: 1, p_card_label: 'x', p_credit_cents: 0 });
    expect(r.error?.message).toMatch(/permission denied/);
    const c = await alice.client.rpc('issue_credit', { p_user: alice.id, p_amount_cents: 100000, p_note: 'free money', p_by: alice.id });
    expect(c.error?.message).toMatch(/permission denied/);
    const f = await shop.owner.client.rpc('finish_pickup', { p_order_id: orderId });
    expect(f.error?.message).toMatch(/permission denied/);
  });

  it("stops restaurants from editing other restaurants' offers", async () => {
    const other = await restaurantWithOffer();
    const res = await shop.owner.client.rpc('restaurant_extend_offer', { p_offer_id: other.offer.id, p_minutes: 30 });
    expect(res.error?.message).toBe('Offer not found.');
  });
});
