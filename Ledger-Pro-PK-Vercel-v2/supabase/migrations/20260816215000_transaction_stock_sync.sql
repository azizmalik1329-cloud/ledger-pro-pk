alter table public.transactions
  add column if not exists product_id uuid references public.products(id) on delete restrict,
  add column if not exists quantity numeric(14,3);

alter table public.transactions drop constraint if exists transactions_inventory_fields_check;
alter table public.transactions add constraint transactions_inventory_fields_check
check (
  (type in ('sale','purchase') and product_id is not null and quantity is not null and quantity > 0)
  or
  (type not in ('sale','purchase') and product_id is null and quantity is null)
);

create index if not exists transactions_product_idx on public.transactions(product_id);

create or replace function private.apply_stock_delta(
  p_product_id uuid,
  p_business_id uuid,
  p_delta numeric
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  current_stock numeric;
begin
  select stock_quantity into current_stock
  from public.products
  where id = p_product_id and business_id = p_business_id
  for update;

  if not found then
    raise exception 'Product business se match nahi karta';
  end if;

  if current_stock + p_delta < 0 then
    raise exception 'Stock kam hai. Available: %, required: %', current_stock, abs(p_delta);
  end if;

  update public.products
  set stock_quantity = stock_quantity + p_delta
  where id = p_product_id and business_id = p_business_id;
end;
$$;

revoke all on function private.apply_stock_delta(uuid,uuid,numeric) from public, anon, authenticated;

create or replace function private.sync_transaction_stock()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_business uuid;
begin
  target_business := case when tg_op = 'DELETE' then old.business_id else new.business_id end;
  if auth.uid() is not null and not private.is_business_member(target_business) then
    raise exception 'Business access denied';
  end if;

  if tg_op in ('UPDATE','DELETE') and old.type in ('sale','purchase') then
    perform private.apply_stock_delta(old.product_id, old.business_id,
      case when old.type = 'sale' then old.quantity else -old.quantity end);
  end if;

  if tg_op in ('INSERT','UPDATE') and new.type in ('sale','purchase') then
    perform private.apply_stock_delta(new.product_id, new.business_id,
      case when new.type = 'sale' then -new.quantity else new.quantity end);
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$$;

revoke all on function private.sync_transaction_stock() from public, anon, authenticated;

drop trigger if exists transactions_stock_sync on public.transactions;
create trigger transactions_stock_sync
after insert or update or delete on public.transactions
for each row execute function private.sync_transaction_stock();
