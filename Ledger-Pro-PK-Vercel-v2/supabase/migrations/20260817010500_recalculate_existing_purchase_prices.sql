-- One-time normalization for existing products after deterministic purchase
-- costing is installed. Products with purchase history use the latest valid
-- purchase rate; products without purchase history retain base_purchase_price.
do $$
declare r record;
begin
  for r in select id,business_id from public.products loop
    perform private.recalculate_product_purchase_price(r.id,r.business_id);
  end loop;
end;
$$;
