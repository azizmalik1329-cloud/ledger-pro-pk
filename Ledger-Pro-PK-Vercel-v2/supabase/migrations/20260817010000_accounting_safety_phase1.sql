-- Ledger Pro PK Phase 1 accounting safety
-- Preserve historical ledger links, make transaction removal reversible,
-- keep purchase cost deterministic after purchase edits/voids/deletes,
-- and block direct stock/cost mutation after product creation.

alter table public.products
  add column if not exists base_purchase_price numeric(14,2) not null default 0;

update public.products
set base_purchase_price = purchase_price
where base_purchase_price = 0 and purchase_price <> 0;

alter table public.products drop constraint if exists products_base_purchase_price_check;
alter table public.products
  add constraint products_base_purchase_price_check check (base_purchase_price >= 0);

alter table public.transactions
  add column if not exists is_void boolean not null default false,
  add column if not exists voided_at timestamptz,
  add column if not exists voided_by uuid references auth.users(id),
  add column if not exists void_reason text;

create index if not exists transactions_business_void_date_idx
  on public.transactions(business_id, is_void, transaction_date desc, created_at desc);

-- Product base cost is editable by a manager/owner. Current purchase_price remains
-- server-derived from the newest valid purchase when purchase history exists.
create or replace function private.sync_product_base_purchase_price()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if tg_op='INSERT' then
    new.base_purchase_price := coalesce(new.base_purchase_price, new.purchase_price, 0);
    new.purchase_price := new.base_purchase_price;
    return new;
  end if;

  if not exists (
    select 1
    from public.transactions t
    where t.business_id=new.business_id
      and t.product_id=new.id
      and t.type='purchase'
      and not t.is_void
  ) then
    new.purchase_price := new.base_purchase_price;
  end if;

  return new;
end;
$$;
revoke all on function private.sync_product_base_purchase_price() from public,anon,authenticated;

drop trigger if exists products_base_purchase_price_insert on public.products;
create trigger products_base_purchase_price_insert
before insert on public.products
for each row execute function private.sync_product_base_purchase_price();

drop trigger if exists products_base_purchase_price_update on public.products;
create trigger products_base_purchase_price_update
before update of base_purchase_price on public.products
for each row execute function private.sync_product_base_purchase_price();

create or replace function private.recalculate_product_purchase_price(p_product_id uuid,p_business_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  latest_rate numeric;
  fallback_rate numeric;
begin
  select p.base_purchase_price into fallback_rate
  from public.products p
  where p.id=p_product_id and p.business_id=p_business_id;

  if not found then return; end if;

  select round((t.amount/t.quantity)::numeric,2)
  into latest_rate
  from public.transactions t
  where t.business_id=p_business_id
    and t.product_id=p_product_id
    and t.type='purchase'
    and not t.is_void
    and t.quantity > 0
  order by t.transaction_date desc,t.created_at desc,t.id desc
  limit 1;

  update public.products
  set purchase_price=coalesce(latest_rate,fallback_rate,0)
  where id=p_product_id and business_id=p_business_id;
end;
$$;
revoke all on function private.recalculate_product_purchase_price(uuid,uuid) from public,anon,authenticated;

-- Preserve sale COGS on metadata-only updates (including voiding). Re-snapshot
-- only when a sale is created or its inventory identity/quantity changes.
create or replace function private.normalize_transaction()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  tx_limit integer;
  tx_count bigint;
  unit_cost numeric;
begin
  if new.amount <= 0 then
    raise exception 'Amount zero se zyada hona chahiye';
  end if;

  if new.contact_id is not null and not exists (
    select 1 from public.contacts c where c.id=new.contact_id and c.business_id=new.business_id
  ) then
    raise exception 'Contact business se match nahi karta';
  end if;

  if tg_op='INSERT' then
    new.is_void := false;
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;

    select b.max_monthly_transactions into tx_limit
    from public.businesses b where b.id=new.business_id and b.status='active';
    if tx_limit is null then raise exception 'Active business required'; end if;

    select count(*) into tx_count
    from public.transactions t
    where t.business_id=new.business_id
      and not t.is_void
      and t.created_at >= date_trunc('month', now())
      and t.created_at < date_trunc('month', now()) + interval '1 month';
    if tx_count >= tx_limit then
      raise exception 'Monthly transaction limit reached (%). Plan upgrade karein.', tx_limit;
    end if;
  end if;

  if new.type in ('sale','purchase') then
    if new.product_id is null or new.quantity is null or new.quantity <= 0 then
      raise exception 'Product aur positive quantity zaroori hai';
    end if;
    if not exists (
      select 1 from public.products p where p.id=new.product_id and p.business_id=new.business_id
    ) then
      raise exception 'Product business se match nahi karta';
    end if;
    if new.paid_amount < 0 or new.paid_amount > new.amount then
      raise exception 'Paid amount 0 aur total amount ke darmiyan hona chahiye';
    end if;
    new.status := case when new.paid_amount >= new.amount then 'paid' when new.paid_amount > 0 then 'partial' else 'unpaid' end;

    if new.type='sale' then
      if tg_op='INSERT'
        or old.type is distinct from new.type
        or old.product_id is distinct from new.product_id
        or old.quantity is distinct from new.quantity then
        select p.purchase_price into unit_cost
        from public.products p
        where p.id=new.product_id and p.business_id=new.business_id;
        new.cost_amount := round((coalesce(unit_cost,0) * new.quantity)::numeric,2);
      else
        new.cost_amount := old.cost_amount;
      end if;
    else
      new.cost_amount := 0;
    end if;
  else
    new.product_id := null;
    new.quantity := null;
    new.paid_amount := new.amount;
    new.status := 'paid';
    new.cost_amount := 0;
  end if;

  return new;
end;
$$;
revoke all on function private.normalize_transaction() from public,anon,authenticated;

-- Correctly undo/reapply inventory for edits and voids. Purchase-price refresh
-- runs for both the old and new product so editing an older purchase cannot leave
-- a stale cost behind.
create or replace function private.sync_transaction_stock()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  target_business uuid;
begin
  target_business := case when tg_op='DELETE' then old.business_id else new.business_id end;
  if auth.uid() is not null and not private.is_business_member(target_business) then
    raise exception 'Business access denied';
  end if;

  if tg_op in ('UPDATE','DELETE')
     and not old.is_void
     and old.type in ('sale','purchase') then
    perform private.apply_stock_delta(
      old.product_id,
      old.business_id,
      case when old.type='sale' then old.quantity else -old.quantity end
    );
  end if;

  if tg_op in ('INSERT','UPDATE')
     and not new.is_void
     and new.type in ('sale','purchase') then
    perform private.apply_stock_delta(
      new.product_id,
      new.business_id,
      case when new.type='sale' then -new.quantity else new.quantity end
    );
  end if;

  if tg_op in ('UPDATE','DELETE') and old.type='purchase' and old.product_id is not null then
    perform private.recalculate_product_purchase_price(old.product_id,old.business_id);
  end if;
  if tg_op in ('INSERT','UPDATE') and new.type='purchase' and new.product_id is not null then
    perform private.recalculate_product_purchase_price(new.product_id,new.business_id);
  end if;

  return case when tg_op='DELETE' then old else new end;
end;
$$;
revoke all on function private.sync_transaction_stock() from public,anon,authenticated;

-- Archive contacts rather than deleting ledger identity.
create or replace function private.archive_contact_impl(p_business_id uuid,p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_role text;
begin
  caller_role := private.business_role(p_business_id);
  if caller_role not in ('owner','manager') or not private.is_business_active(p_business_id) then
    raise exception 'Manager access required';
  end if;

  update public.contacts
  set is_active=false
  where id=p_contact_id and business_id=p_business_id and is_active=true;

  if not found then raise exception 'Active contact not found'; end if;

  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id)
  values(p_business_id,auth.uid(),'contact_archived','contacts',p_contact_id::text);
end;
$$;
revoke all on function private.archive_contact_impl(uuid,uuid) from public,anon;
grant execute on function private.archive_contact_impl(uuid,uuid) to authenticated;

create or replace function public.archive_contact(p_business_id uuid,p_contact_id uuid)
returns void
language sql
security invoker
set search_path=''
as $$ select private.archive_contact_impl(p_business_id,p_contact_id) $$;
revoke all on function public.archive_contact(uuid,uuid) from public,anon;
grant execute on function public.archive_contact(uuid,uuid) to authenticated;

-- Void financial transactions instead of hard-deleting them.
create or replace function private.void_transaction_impl(p_business_id uuid,p_transaction_id uuid,p_reason text default '')
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_role text;
  clean_reason text;
begin
  caller_role := private.business_role(p_business_id);
  if caller_role not in ('owner','manager') or not private.is_business_active(p_business_id) then
    raise exception 'Manager access required';
  end if;

  clean_reason := trim(coalesce(p_reason,''));
  if char_length(clean_reason) < 3 then
    raise exception 'Void reason kam az kam 3 characters ka ho';
  end if;

  update public.transactions
  set is_void=true,
      voided_at=now(),
      voided_by=auth.uid(),
      void_reason=clean_reason
  where id=p_transaction_id and business_id=p_business_id and not is_void;

  if not found then raise exception 'Active transaction not found'; end if;

  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id,details)
  values(
    p_business_id,
    auth.uid(),
    'transaction_voided',
    'transactions',
    p_transaction_id::text,
    jsonb_build_object('reason',clean_reason)
  );
end;
$$;
revoke all on function private.void_transaction_impl(uuid,uuid,text) from public,anon;
grant execute on function private.void_transaction_impl(uuid,uuid,text) to authenticated;

create or replace function public.void_transaction(p_business_id uuid,p_transaction_id uuid,p_reason text default '')
returns void
language sql
security invoker
set search_path=''
as $$ select private.void_transaction_impl(p_business_id,p_transaction_id,p_reason) $$;
revoke all on function public.void_transaction(uuid,uuid,text) from public,anon;
grant execute on function public.void_transaction(uuid,uuid,text) to authenticated;

-- Explicit stock adjustment. Direct stock edits are removed below.
create or replace function private.adjust_product_stock_impl(p_business_id uuid,p_product_id uuid,p_delta numeric,p_reason text)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_role text;
  clean_reason text;
begin
  caller_role := private.business_role(p_business_id);
  if caller_role not in ('owner','manager') or not private.is_business_active(p_business_id) then
    raise exception 'Manager access required';
  end if;
  if p_delta = 0 then raise exception 'Adjustment zero nahi ho sakta'; end if;

  clean_reason := trim(coalesce(p_reason,''));
  if char_length(clean_reason) < 3 then
    raise exception 'Adjustment reason kam az kam 3 characters ka ho';
  end if;

  perform private.apply_stock_delta(p_product_id,p_business_id,p_delta);

  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id,details)
  values(
    p_business_id,
    auth.uid(),
    'stock_adjusted',
    'products',
    p_product_id::text,
    jsonb_build_object('quantity_delta',p_delta,'reason',clean_reason)
  );
end;
$$;
revoke all on function private.adjust_product_stock_impl(uuid,uuid,numeric,text) from public,anon;
grant execute on function private.adjust_product_stock_impl(uuid,uuid,numeric,text) to authenticated;

create or replace function public.adjust_product_stock(p_business_id uuid,p_product_id uuid,p_delta numeric,p_reason text)
returns void
language sql
security invoker
set search_path=''
as $$ select private.adjust_product_stock_impl(p_business_id,p_product_id,p_delta,p_reason) $$;
revoke all on function public.adjust_product_stock(uuid,uuid,numeric,text) from public,anon;
grant execute on function public.adjust_product_stock(uuid,uuid,numeric,text) to authenticated;

-- Historical safety: contacts/transactions can no longer be hard deleted by app users.
drop policy if exists contacts_delete_manager on public.contacts;
drop policy if exists transactions_delete_manager on public.transactions;
revoke delete on public.contacts from authenticated;
revoke delete on public.transactions from authenticated;

-- Protect server-derived transaction fields while preserving normal edit fields.
revoke update on public.transactions from authenticated;
grant update(contact_id,product_id,quantity,type,reference,amount,paid_amount,transaction_date,notes,status)
  on public.transactions to authenticated;

-- Protect stock_quantity and current purchase_price after product creation.
revoke update on public.products from authenticated;
grant update(name,sku,unit,sale_price,base_purchase_price,low_stock_level,is_active)
  on public.products to authenticated;
