-- Repair sale COGS only when a dated purchase exists on/before that sale.
-- This avoids rewriting sales that relied only on a historical opening/base cost.

alter table public.transactions disable trigger transactions_normalize;
alter table public.transactions disable trigger transactions_stock_sync;

update public.transactions t
set unit_cost=private.product_cost_as_of(t.product_id,t.business_id,t.transaction_date),
    cost_amount=round((private.product_cost_as_of(t.product_id,t.business_id,t.transaction_date)*t.quantity)::numeric,2)
where t.type='sale'
  and t.product_id is not null
  and t.quantity>0
  and exists(
    select 1 from public.transactions p
    where p.business_id=t.business_id
      and p.product_id=t.product_id
      and p.type='purchase'
      and not p.is_void
      and p.quantity>0
      and p.transaction_date<=t.transaction_date
  )
  and (
    abs(t.unit_cost-private.product_cost_as_of(t.product_id,t.business_id,t.transaction_date))>0.0001
    or abs(t.cost_amount-round((private.product_cost_as_of(t.product_id,t.business_id,t.transaction_date)*t.quantity)::numeric,2))>0.01
  );

alter table public.transactions enable trigger transactions_stock_sync;
alter table public.transactions enable trigger transactions_normalize;
