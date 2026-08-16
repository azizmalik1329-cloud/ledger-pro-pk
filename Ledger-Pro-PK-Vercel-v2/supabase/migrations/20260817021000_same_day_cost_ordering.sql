-- Same-day purchases entered after a sale must not rewrite that earlier sale's COGS.

create or replace function private.product_cost_as_of_ordered(
  p_product_id uuid,
  p_business_id uuid,
  p_date date,
  p_created_at timestamptz
)
returns numeric
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_rate numeric;
  v_fallback numeric;
begin
  select base_purchase_price into v_fallback
  from public.products
  where id=p_product_id and business_id=p_business_id;
  if not found then raise exception 'Product business se match nahi karta'; end if;

  select round((t.amount/t.quantity)::numeric,4) into v_rate
  from public.transactions t
  where t.business_id=p_business_id
    and t.product_id=p_product_id
    and t.type='purchase'
    and not t.is_void
    and t.quantity>0
    and (
      t.transaction_date<p_date
      or (t.transaction_date=p_date and t.created_at<=coalesce(p_created_at,now()))
    )
  order by t.transaction_date desc,t.created_at desc,t.id desc
  limit 1;

  return coalesce(v_rate,v_fallback,0);
end;
$$;

create or replace function private.enforce_sale_cost_snapshot_order()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare v_unit_cost numeric;
begin
  if new.type='sale' and (
    tg_op='INSERT'
    or old.type is distinct from new.type
    or old.product_id is distinct from new.product_id
    or old.quantity is distinct from new.quantity
    or old.transaction_date is distinct from new.transaction_date
  ) then
    v_unit_cost:=private.product_cost_as_of_ordered(new.product_id,new.business_id,new.transaction_date,new.created_at);
    new.unit_cost:=round(coalesce(v_unit_cost,0)::numeric,4);
    new.cost_amount:=round((new.unit_cost*new.quantity)::numeric,2);
  end if;
  return new;
end;
$$;

drop trigger if exists zz_transactions_sale_cost_order on public.transactions;
create trigger zz_transactions_sale_cost_order
before insert or update on public.transactions
for each row execute function private.enforce_sale_cost_snapshot_order();

-- Correct only sales for which an actual purchase existed before that sale in date/entry order.
alter table public.transactions disable trigger transactions_normalize;
alter table public.transactions disable trigger transactions_stock_sync;

update public.transactions s
set unit_cost=private.product_cost_as_of_ordered(s.product_id,s.business_id,s.transaction_date,s.created_at),
    cost_amount=round((private.product_cost_as_of_ordered(s.product_id,s.business_id,s.transaction_date,s.created_at)*s.quantity)::numeric,2)
where s.type='sale'
  and s.product_id is not null
  and s.quantity>0
  and exists(
    select 1 from public.transactions p
    where p.business_id=s.business_id
      and p.product_id=s.product_id
      and p.type='purchase'
      and not p.is_void
      and p.quantity>0
      and (
        p.transaction_date<s.transaction_date
        or (p.transaction_date=s.transaction_date and p.created_at<=s.created_at)
      )
  )
  and (
    abs(s.unit_cost-private.product_cost_as_of_ordered(s.product_id,s.business_id,s.transaction_date,s.created_at))>0.0001
    or abs(s.cost_amount-round((private.product_cost_as_of_ordered(s.product_id,s.business_id,s.transaction_date,s.created_at)*s.quantity)::numeric,2))>0.01
  );

alter table public.transactions enable trigger transactions_stock_sync;
alter table public.transactions enable trigger transactions_normalize;
