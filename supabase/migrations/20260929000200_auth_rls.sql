-- Sign-up trigger, helper functions and Row Level Security.
--
-- Access model:
--   * Reads go through RLS: customers see their own orders/credit/cards, restaurant owners see
--     their restaurant's data, admins see everything, and anyone can see live offers.
--   * Simple owner edits (restaurant profile, menu) are direct writes limited by RLS and column grants.
--   * Money and order state changes go through SECURITY DEFINER functions (next migration).

-- ---------------------------------------------------------------- helpers

create function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.profiles where id = auth.uid() and role = 'admin' and status = 'active');
$$;

create function public.my_restaurant_id() returns bigint
language sql stable security definer set search_path = public as $$
  select id from public.restaurants where owner_id = auth.uid();
$$;

create function public.setting_int(p_key text) returns integer
language sql stable security definer set search_path = public as $$
  select (value #>> '{}')::integer from public.settings where key = p_key;
$$;

create function public.setting_bool(p_key text) returns boolean
language sql stable security definer set search_path = public as $$
  select coalesce((value #>> '{}')::boolean, false) from public.settings where key = p_key;
$$;

-- Center point of a ZIP code (null if it's outside the service area).
create function public.zip_location(p_zip text) returns extensions.geography
language sql stable set search_path = public, extensions as $$
  select location from public.zips where zip = left(p_zip, 5);
$$;

-- ---------------------------------------------------------------- sign-up

-- Creates the profile (and restaurant) for every new Supabase Auth user. An account is only created
-- when the current version of every legal document for the role was accepted; otherwise sign-up fails.
-- Sign-up only ever creates customers and restaurants. Admins are promoted by scripts/create-admin.ts
-- with the service-role key (API users can't change profiles.role).
create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = public, extensions as $$
declare
  meta jsonb := coalesce(new.raw_user_meta_data, '{}'::jsonb);
  accepted jsonb := coalesce(meta -> 'accepted_terms', '{}'::jsonb);
  r jsonb := coalesce(meta -> 'restaurant', '{}'::jsonb);
  v_role public.user_role;
  v_username text := btrim(coalesce(meta ->> 'username', ''));
  v_restaurant bigint;
  v_loc geography;
  doc record;
begin
  if meta ->> 'role' = 'restaurant' then
    v_role := 'restaurant';
  else
    v_role := 'customer';
  end if;

  if v_username !~ '^[A-Za-z0-9_.]{3,24}$' then
    raise exception 'User name must be 3-24 characters: letters, numbers, dots or underscores.' using errcode = '22023';
  end if;

  for doc in select * from public.legal_documents d where v_role = any (d.roles) loop
    if accepted ->> doc.id is distinct from doc.version then
      raise exception 'To create an account you must accept the %.', doc.title using errcode = '22023';
    end if;
  end loop;

  insert into public.profiles (id, email, username, role) values (new.id, new.email, v_username, v_role);

  insert into public.terms_acceptances (user_id, document, version, ip, user_agent)
  select new.id, d.id, d.version, left(coalesce(meta ->> 'ip', ''), 64), left(coalesce(meta ->> 'user_agent', ''), 300)
  from public.legal_documents d where v_role = any (d.roles);

  if v_role = 'restaurant' then
    -- Exact pin if given, otherwise the ZIP code's center until the owner drags the pin in the portal.
    if (r ->> 'lat') ~ '^-?\d+(\.\d+)?$' and (r ->> 'lng') ~ '^-?\d+(\.\d+)?$' then
      v_loc := st_setsrid(st_makepoint((r ->> 'lng')::double precision, (r ->> 'lat')::double precision), 4326)::geography;
    else
      v_loc := public.zip_location(r ->> 'zip');
    end if;
    insert into public.restaurants (owner_id, name, address, city, zip, phone, cuisine, location, tax_rate_bps, status)
    values (
      new.id, btrim(r ->> 'name'), btrim(r ->> 'address'), btrim(r ->> 'city'), btrim(r ->> 'zip'),
      btrim(coalesce(r ->> 'phone', '')), btrim(coalesce(r ->> 'cuisine', '')), v_loc,
      public.setting_int('default_tax_rate_bps'),
      case when public.setting_bool('require_restaurant_approval') then 'pending' else 'approved' end::public.restaurant_status
    )
    returning id into v_restaurant;
    insert into public.restaurant_payment_accounts (restaurant_id) values (v_restaurant);
  end if;

  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.handle_user_email_change() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  update public.profiles set email = new.email where id = new.id;
  return new;
end;
$$;

create trigger on_auth_user_email_changed
  after update of email on auth.users
  for each row when (old.email is distinct from new.email)
  execute function public.handle_user_email_change();

-- Legal documents the signed-in user still has to accept (after a new version is published).
create function public.pending_terms() returns setof public.legal_documents
language sql stable security definer set search_path = public as $$
  select d.* from public.legal_documents d
  join public.profiles p on p.id = auth.uid() and p.role = any (d.roles)
  where not exists (
    select 1 from public.terms_acceptances t
    where t.user_id = p.id and t.document = d.id and t.version = d.version
  );
$$;

-- Records acceptance of updated documents. p_accepted: {"customer-terms": "<version>", ...}
create function public.accept_terms(p_accepted jsonb, p_ip text default '', p_user_agent text default '')
returns void
language plpgsql security definer set search_path = public as $$
declare
  doc record;
begin
  if auth.uid() is null then
    raise exception 'Please log in.' using errcode = '28000';
  end if;
  for doc in select * from public.pending_terms() loop
    if p_accepted ->> doc.id is distinct from doc.version then
      raise exception 'Please accept the %.', doc.title using errcode = '22023';
    end if;
    insert into public.terms_acceptances (user_id, document, version, ip, user_agent)
    values (auth.uid(), doc.id, doc.version, left(p_ip, 64), left(p_user_agent, 300));
  end loop;
end;
$$;

-- ---------------------------------------------------------------- privileges

-- Start from "read only" for API roles; writes are granted table by table below.
revoke insert, update, delete, truncate on all tables in schema public from anon, authenticated;

alter table public.profiles enable row level security;
alter table public.settings enable row level security;
alter table public.legal_documents enable row level security;
alter table public.terms_acceptances enable row level security;
alter table public.zips enable row level security;
alter table public.restaurants enable row level security;
alter table public.restaurant_payment_accounts enable row level security;
alter table public.menu_items enable row level security;
alter table public.offers enable row level security;
alter table public.payment_methods enable row level security;
alter table public.orders enable row level security;
alter table public.order_pins enable row level security;
alter table public.pin_failures enable row level security;
alter table public.refunds enable row level security;
alter table public.credit_ledger enable row level security;
alter table public.payouts enable row level security;
alter table public.audit_log enable row level security;

-- Public reference data.
create policy "settings are public" on public.settings for select using (true);
create policy "legal documents are public" on public.legal_documents for select using (true);
create policy "zips are public" on public.zips for select using (true);

-- Profiles: yourself, or admins.
create policy "read own profile" on public.profiles for select to authenticated
  using (id = (select auth.uid()) or (select public.is_admin()));

create policy "read own terms acceptances" on public.terms_acceptances for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

-- Restaurants: approved ones are public; owners see their own; customers see restaurants they ordered from.
create policy "read restaurants" on public.restaurants for select
  using (
    status = 'approved'
    or owner_id = (select auth.uid())
    or (select public.is_admin())
    or exists (select 1 from public.orders o where o.restaurant_id = restaurants.id and o.user_id = (select auth.uid()))
  );
create policy "owners update their restaurant" on public.restaurants for update to authenticated
  using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));
-- Owners may edit their profile, but not status, admin notes or ownership.
grant update (name, description, cuisine, address, city, zip, phone, location, tax_rate_bps) on public.restaurants to authenticated;

create policy "owners and admins read payment accounts" on public.restaurant_payment_accounts for select to authenticated
  using (restaurant_id = (select public.my_restaurant_id()) or (select public.is_admin()));

-- Menu: owners manage their own; admins can read.
create policy "owners read menu" on public.menu_items for select to authenticated
  using (restaurant_id = (select public.my_restaurant_id()) or (select public.is_admin()));
create policy "owners add menu items" on public.menu_items for insert to authenticated
  with check (restaurant_id = (select public.my_restaurant_id()));
create policy "owners edit menu items" on public.menu_items for update to authenticated
  using (restaurant_id = (select public.my_restaurant_id()))
  with check (restaurant_id = (select public.my_restaurant_id()));
grant insert (restaurant_id, name, description, price_cents, dietary, image_url) on public.menu_items to authenticated;
grant update (name, description, price_cents, dietary, image_url, active) on public.menu_items to authenticated;

-- Offers: live offers of approved restaurants are public. Owners and admins see all of theirs/all.
-- Offers are created and changed through restaurant_* functions.
create policy "read offers" on public.offers for select
  using (
    (status = 'active' and pickup_end > now()
      and exists (select 1 from public.restaurants r where r.id = offers.restaurant_id and r.status = 'approved'))
    or restaurant_id = (select public.my_restaurant_id())
    or (select public.is_admin())
  );

create policy "read own cards" on public.payment_methods for select to authenticated
  using (user_id = (select auth.uid()));

-- Orders: the customer, the restaurant that received it, and admins.
create policy "read orders" on public.orders for select to authenticated
  using (
    user_id = (select auth.uid())
    or restaurant_id = (select public.my_restaurant_id())
    or (select public.is_admin())
  );

-- Only the customer can see their PIN.
create policy "customers read their pins" on public.order_pins for select to authenticated
  using (exists (select 1 from public.orders o where o.id = order_pins.order_id and o.user_id = (select auth.uid())));

create policy "read refunds" on public.refunds for select to authenticated
  using (
    (select public.is_admin())
    or exists (select 1 from public.orders o where o.id = refunds.order_id
               and (o.user_id = (select auth.uid()) or o.restaurant_id = (select public.my_restaurant_id())))
  );

create policy "read own credit" on public.credit_ledger for select to authenticated
  using (user_id = (select auth.uid()) or (select public.is_admin()));

create policy "read payouts" on public.payouts for select to authenticated
  using (restaurant_id = (select public.my_restaurant_id()) or (select public.is_admin()));

create policy "admins read audit log" on public.audit_log for select to authenticated
  using ((select public.is_admin()));

-- Trigger functions are never called directly.
revoke execute on function public.handle_new_user() from public, anon, authenticated;
revoke execute on function public.handle_user_email_change() from public, anon, authenticated;
