-- Apply after the Phase 1 frontend is live.
-- Prevent destructive historical edits that bypass archive/void/adjustment RPCs.

drop policy if exists contacts_delete_manager on public.contacts;
drop policy if exists transactions_delete_manager on public.transactions;
revoke delete on public.contacts from authenticated;
revoke delete on public.transactions from authenticated;

-- Protect server-derived void/COGS metadata while preserving normal transaction edits.
revoke update on public.transactions from authenticated;
grant update(contact_id,product_id,quantity,type,reference,amount,paid_amount,transaction_date,notes,status)
  on public.transactions to authenticated;

-- Protect current stock and current purchase rate after creation.
-- Managers/owners edit the base rate; stock moves via transactions or adjustment RPC.
revoke update on public.products from authenticated;
grant update(name,sku,unit,sale_price,base_purchase_price,low_stock_level,is_active)
  on public.products to authenticated;
