-- NutriCart product catalogue. Safe to run more than once (Supabase Dashboard → SQL Editor).
-- The app reads this table first on every scan and falls back to Open Food Facts on a miss.

create table if not exists public.products (
  id           bigint generated always as identity primary key,
  barcode      text not null,
  name         text not null,
  brand        text,
  category     text not null default 'Grocery',
  serving_size text,                       -- what the nutrient values describe, e.g. "400 g" (whole pack)
  calories     numeric not null default 0 check (calories  >= 0),
  protein_g    numeric not null default 0 check (protein_g >= 0),
  carbs_g      numeric not null default 0 check (carbs_g   >= 0),
  fat_g        numeric not null default 0 check (fat_g     >= 0),
  fiber_g      numeric not null default 0 check (fiber_g   >= 0),
  image_url    text,
  created_at   timestamptz not null default now()
);

-- One row per barcode; also the index every scan lookup uses. The API treats a duplicate insert (23505) as "already cached".
create unique index if not exists products_barcode_key on public.products (barcode);

-- Shared, public catalogue: anyone may read, nobody may write with the publishable key.
-- Writes (caching Open Food Facts results) happen server-side with the secret key, which bypasses RLS.
alter table public.products enable row level security;

drop policy if exists "Products are readable by everyone" on public.products;
create policy "Products are readable by everyone" on public.products
  for select to anon, authenticated
  using (true);

revoke insert, update, delete, truncate, references, trigger on public.products from anon, authenticated;
grant select on public.products to anon, authenticated;
grant all on public.products to service_role;

-- Make the table visible to the Data API immediately (fixes PGRST205 "not in the schema cache").
notify pgrst, 'reload schema';

-- Optional sample row so a manual lookup of 3017624010701 is served from your own catalogue.
insert into public.products (barcode, name, brand, category, serving_size, calories, protein_g, carbs_g, fat_g, fiber_g, image_url)
values ('3017624010701', 'Nutella', 'Ferrero', 'Spreads', '400 g', 2156, 25.2, 230, 123.6, 0,
        'https://images.openfoodfacts.org/images/products/301/762/401/0701/front_en.100.200.jpg')
on conflict (barcode) do nothing;

-- Staff registration fields (one row per barcode/SKU; stock counts the units on the shelf).
alter table public.products
  add column if not exists stock       integer not null default 0 check (stock >= 0),
  add column if not exists aisle       text,
  add column if not exists is_active   boolean not null default true,     -- hidden products are refused at scan time
  add column if not exists updated_at  timestamptz not null default now();

create or replace function public.set_updated_at()
returns trigger language plpgsql security invoker set search_path = ''
as $$ begin new.updated_at := now(); return new; end; $$;

drop trigger if exists products_set_updated_at on public.products;
create trigger products_set_updated_at before update on public.products
  for each row execute function public.set_updated_at();

-- Atomic stock change for the admin +/- buttons. Server-only (service role).
create or replace function public.adjust_product_stock(p_id bigint, p_delta integer)
returns integer language sql security invoker set search_path = ''
as $$ update public.products set stock = greatest(stock + p_delta, 0) where id = p_id returning stock; $$;

revoke execute on function public.set_updated_at() from public, anon, authenticated;
revoke execute on function public.adjust_product_stock(bigint, integer) from public, anon, authenticated;
grant execute on function public.adjust_product_stock(bigint, integer) to service_role;

notify pgrst, 'reload schema';

-- Product images copied by the admin (CSV import / product form). Public read via public URLs;
-- no storage policies for anon/authenticated, so only the service role can upload and nobody can list.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('product-images', 'product-images', true, 2097152, '{image/jpeg,image/png,image/webp,image/gif,image/avif}')
on conflict (id) do update set file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
