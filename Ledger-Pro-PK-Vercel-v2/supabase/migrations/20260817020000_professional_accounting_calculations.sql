-- Professional inventory pricing, discounts, historical costing and safety guards.

alter table public.transactions add column if not exists unit_price numeric(18,4) not null default 0;
alter table public.transactions add column if not exists gross_amount numeric(18,2) not null default 0;
alter table public.transactions add column if not exists discount_type text not null default 'none';
alter table public.transactions add column if not exists discount_value numeric(18,4) not null default 0;
alter table public.transactions add column if not exists discount_amount numeric(18,2) not null default 0;
alter table public.transactions add column if not exists unit_cost numeric(18,4) not null default 0;

update public.transactions
set unit_price = case when type in ('sale','purchase') and quantity > 0 then round((amount/quantity)::numeric,4) else 0 end,
    gross_amount = amount,
    discount_type = 'none',
    discount_value = 0,
    discount_amount = 0,
    unit_cost = case when type='sale' and quantity > 0 then round((cost_amount/quantity)::numeric,4)
                     when type='purchase' and quantity > 0 then round((amount/quantity)::numeric,4)
                     else 0 end
where gross_amount=0 and discount_amount=0;

do $$ begin
  if not exists(select 1 from pg_constraint where conname='transactions_unit_price_nonnegative') then
    alter table public.transactions add constraint transactions_unit_price_nonnegative check(unit_price>=0);
  end if;
  if not exists(select 1 from pg_constraint where conname='transactions_gross_nonnegative') then
    alter table public.transactions add constraint transactions_gross_nonnegative check(gross_amount>=0);
  end if;
  if not exists(select 1 from pg_constraint where conname='transactions_discount_type_valid') then
    alter table public.transactions add constraint transactions_discount_type_valid check(discount_type in ('none','amount','percent'));
  end if;
  if not exists(select 1 from pg_constraint where conname='transactions_discount_values_nonnegative') then
    alter table public.transactions add constraint transactions_discount_values_nonnegative check(discount_value>=0 and discount_amount>=0);
  end if;
  if not exists(select 1 from pg_constraint where conname='transactions_unit_cost_nonnegative') then
    alter table public.transactions add constraint transactions_unit_cost_nonnegative check(unit_cost>=0);
  end if;
end $$;

create table if not exists public.business_reference_sequences(
  business_id uuid not null references public.businesses(id) on delete cascade,
  entry_type text not null check(entry_type in ('sale','purchase','payment_in','payment_out','expense')),
  next_number bigint not null default 1 check(next_number>0),
  primary key(business_id,entry_type)
);
alter table public.business_reference_sequences enable row level security;
revoke all on public.business_reference_sequences from anon,authenticated;

create or replace function private.next_business_reference(p_business_id uuid,p_type text)
returns text
language plpgsql
security definer
set search_path=''
as $$
declare
  n bigint;
  prefix text;
  candidate text;
begin
  if p_type='sale' then
    select coalesce(nullif(upper(trim(invoice_prefix)),''),'INV') into prefix from public.businesses where id=p_business_id;
  else
    prefix := case p_type when 'purchase' then 'PUR' when 'payment_in' then 'RCV' when 'payment_out' then 'PAY' when 'expense' then 'EXP' else 'TX' end;
  end if;
  if prefix is null then raise exception 'Business not found'; end if;

  loop
    insert into public.business_reference_sequences(business_id,entry_type,next_number)
    values(p_business_id,p_type,2)
    on conflict(business_id,entry_type) do update
      set next_number=public.business_reference_sequences.next_number+1
    returning next_number-1 into n;

    candidate:=prefix||'-'||lpad(n::text,6,'0');
    exit when not exists(select 1 from public.transactions where business_id=p_business_id and reference=candidate);
  end loop;
  return candidate;
end;
$$;

create unique index if not exists transactions_business_reference_unique
on public.transactions(business_id,reference)
where reference is not null;

create or replace function private.product_cost_as_of(p_product_id uuid,p_business_id uuid,p_date date)
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
    and t.transaction_date<=p_date
  order by t.transaction_date desc,t.created_at desc,t.id desc
  limit 1;

  return coalesce(v_rate,v_fallback,0);
end;
$$;

create or replace function private.is_business_active(p_business_id uuid)
returns boolean
language sql
stable
security definer
set search_path=''
as $$
  select exists(
    select 1 from public.businesses
    where id=p_business_id
      and status='active'
      and (plan_expires_at is null or plan_expires_at>=now())
  )
$$;

create or replace function private.contact_balance(p_business_id uuid,p_contact_id uuid)
returns numeric
language plpgsql
stable
security definer
set search_path=''
as $$
declare
  v_type text;
  v_opening numeric;
  v_balance numeric;
begin
  select type,opening_balance into v_type,v_opening
  from public.contacts where id=p_contact_id and business_id=p_business_id;
  if not found then raise exception 'Contact not found'; end if;

  if v_type='customer' then
    select coalesce(v_opening,0)
      + coalesce(sum(case when type='sale' then greatest(amount-paid_amount,0) else 0 end),0)
      - coalesce(sum(case when type='payment_in' then amount else 0 end),0)
    into v_balance
    from public.transactions
    where business_id=p_business_id and contact_id=p_contact_id and not is_void;
  else
    select coalesce(v_opening,0)
      + coalesce(sum(case when type='purchase' then greatest(amount-paid_amount,0) else 0 end),0)
      - coalesce(sum(case when type='payment_out' then amount else 0 end),0)
    into v_balance
    from public.transactions
    where business_id=p_business_id and contact_id=p_contact_id and not is_void;
  end if;
  return coalesce(v_balance,v_opening,0);
end;
$$;

create or replace function private.guard_contact_financial_fields()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
begin
  if (new.type is distinct from old.type or new.opening_balance is distinct from old.opening_balance)
     and exists(select 1 from public.transactions t where t.contact_id=old.id and t.business_id=old.business_id) then
    raise exception 'Transaction history ke baad contact type/opening balance direct change nahi ho sakta';
  end if;
  return new;
end;
$$;

drop trigger if exists contacts_financial_fields_guard on public.contacts;
create trigger contacts_financial_fields_guard
before update of type,opening_balance on public.contacts
for each row execute function private.guard_contact_financial_fields();

create or replace function private.normalize_transaction()
returns trigger
language plpgsql
security definer
set search_path=''
as $$
declare
  tx_limit integer;
  tx_count bigint;
  business_status text;
  business_expiry timestamptz;
  contact_type text;
  contact_active boolean;
  v_gross numeric;
  v_discount numeric;
  v_unit_cost numeric;
  legacy_input boolean := false;
begin
  new.discount_type:=coalesce(new.discount_type,'none');
  new.discount_value:=coalesce(new.discount_value,0);
  new.discount_amount:=coalesce(new.discount_amount,0);
  new.unit_price:=coalesce(new.unit_price,0);
  new.gross_amount:=coalesce(new.gross_amount,0);
  new.unit_cost:=coalesce(new.unit_cost,0);
  new.paid_amount:=coalesce(new.paid_amount,0);

  if tg_op='INSERT' then
    new.is_void := false;
    new.voided_at := null;
    new.voided_by := null;
    new.void_reason := null;

    select status,plan_expires_at,max_monthly_transactions
      into business_status,business_expiry,tx_limit
    from public.businesses where id=new.business_id for update;
    if not found or business_status<>'active' or (business_expiry is not null and business_expiry<now()) then
      raise exception 'Active plan required';
    end if;

    select count(*) into tx_count
    from public.transactions t
    where t.business_id=new.business_id
      and t.created_at>=date_trunc('month',now())
      and t.created_at<date_trunc('month',now())+interval '1 month';
    if tx_count>=tx_limit then
      raise exception 'Monthly transaction limit reached (%). Plan upgrade karein.',tx_limit;
    end if;

    if new.reference is null or trim(new.reference)='' then
      new.reference := private.next_business_reference(new.business_id,new.type);
    end if;
  elsif new.reference is null or trim(new.reference)='' then
    new.reference:=old.reference;
  end if;

  if new.reference is not null and trim(new.reference)<>'' then new.reference:=upper(trim(new.reference)); end if;

  if new.contact_id is not null then
    select c.type,c.is_active into contact_type,contact_active
    from public.contacts c where c.id=new.contact_id and c.business_id=new.business_id;
    if not found then raise exception 'Contact business se match nahi karta'; end if;
    if not contact_active and not (tg_op='UPDATE' and old.contact_id is not distinct from new.contact_id) then
      raise exception 'Archived contact new transaction ke liye use nahi ho sakta';
    end if;
    if new.type in ('sale','payment_in') and contact_type<>'customer' then raise exception 'Sale/wasooli sirf customer ke sath link ho sakti hai'; end if;
    if new.type in ('purchase','payment_out') and contact_type<>'supplier' then raise exception 'Purchase/adayegi sirf supplier ke sath link ho sakti hai'; end if;
  end if;

  if new.type in ('sale','purchase') then
    if new.product_id is null or new.quantity is null or new.quantity<=0 then raise exception 'Product aur positive quantity zaroori hai'; end if;
    if not exists(select 1 from public.products p where p.id=new.product_id and p.business_id=new.business_id and (p.is_active or (tg_op='UPDATE' and old.product_id is not distinct from new.product_id))) then
      raise exception 'Active product business se match nahi karta';
    end if;

    if tg_op='INSERT' then
      legacy_input := new.unit_price<=0;
    else
      legacy_input := new.unit_price<=0
        or (new.unit_price is not distinct from old.unit_price
            and new.gross_amount is not distinct from old.gross_amount
            and new.discount_type='none'
            and (new.amount is distinct from old.amount or new.quantity is distinct from old.quantity or new.product_id is distinct from old.product_id));
    end if;

    if legacy_input then
      if new.amount<=0 then raise exception 'Amount zero se zyada hona chahiye'; end if;
      new.unit_price:=round((new.amount/new.quantity)::numeric,4);
      new.gross_amount:=round(new.amount::numeric,2);
      new.discount_type:='none';new.discount_value:=0;new.discount_amount:=0;
    else
      if new.unit_price<=0 then raise exception 'Rate per unit zero se zyada hona chahiye'; end if;
      v_gross:=round((new.unit_price*new.quantity)::numeric,2);
      if new.discount_type not in ('none','amount','percent') then raise exception 'Invalid discount type'; end if;
      if new.discount_type='none' then
        new.discount_value:=0;v_discount:=0;
      elsif new.discount_type='amount' then
        if new.discount_value<0 or new.discount_value>v_gross then raise exception 'Discount gross amount se zyada nahi ho sakta'; end if;
        v_discount:=round(new.discount_value::numeric,2);
      else
        if new.discount_value<0 or new.discount_value>100 then raise exception 'Discount percent 0 se 100 ke darmiyan hona chahiye'; end if;
        v_discount:=round((v_gross*new.discount_value/100)::numeric,2);
      end if;
      new.gross_amount:=v_gross;
      new.discount_amount:=v_discount;
      new.amount:=round((v_gross-v_discount)::numeric,2);
      if new.amount<=0 then raise exception 'Net amount zero se zyada hona chahiye'; end if;
    end if;

    if new.paid_amount<0 or new.paid_amount>new.amount then raise exception 'Paid amount 0 aur net total ke darmiyan hona chahiye'; end if;
    if new.paid_amount<new.amount and new.contact_id is null then
      if new.type='sale' then raise exception 'Credit sale ke liye customer lazmi hai';
      else raise exception 'Credit purchase ke liye supplier lazmi hai'; end if;
    end if;
    new.status:=case when new.paid_amount>=new.amount then 'paid' when new.paid_amount>0 then 'partial' else 'unpaid' end;

    if new.type='sale' then
      if tg_op='INSERT' or old.type is distinct from new.type or old.product_id is distinct from new.product_id or old.quantity is distinct from new.quantity or old.transaction_date is distinct from new.transaction_date then
        v_unit_cost:=private.product_cost_as_of(new.product_id,new.business_id,new.transaction_date);
        new.unit_cost:=round(coalesce(v_unit_cost,0)::numeric,4);
        new.cost_amount:=round((new.unit_cost*new.quantity)::numeric,2);
      else
        new.unit_cost:=old.unit_cost;new.cost_amount:=old.cost_amount;
      end if;
    else
      new.unit_cost:=round((new.amount/new.quantity)::numeric,4);
      new.cost_amount:=0;
    end if;
  else
    if new.amount<=0 then raise exception 'Amount zero se zyada hona chahiye'; end if;
    if new.type in ('payment_in','payment_out') and new.contact_id is null then
      if new.type='payment_in' then raise exception 'Wasooli ke liye customer lazmi hai';
      else raise exception 'Adayegi ke liye supplier lazmi hai'; end if;
    end if;
    if new.type='expense' then new.contact_id:=null; end if;
    new.product_id:=null;new.quantity:=null;new.unit_price:=0;new.gross_amount:=round(new.amount::numeric,2);
    new.discount_type:='none';new.discount_value:=0;new.discount_amount:=0;new.unit_cost:=0;
    new.paid_amount:=new.amount;new.status:='paid';new.cost_amount:=0;
  end if;

  return new;
end;
$$;

create or replace function private.archive_contact_impl(p_business_id uuid,p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare
  caller_role text;
  balance numeric;
begin
  caller_role:=private.business_role(p_business_id);
  if caller_role not in ('owner','manager') or not private.is_business_active(p_business_id) then raise exception 'Manager access required'; end if;
  balance:=private.contact_balance(p_business_id,p_contact_id);
  if abs(balance)>0.005 then raise exception 'Outstanding/advance balance zero kiye baghair khata archive nahi ho sakta. Current balance: %',round(balance,2); end if;
  update public.contacts set is_active=false where id=p_contact_id and business_id=p_business_id and is_active=true;
  if not found then raise exception 'Active contact not found'; end if;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id,details)
  values(p_business_id,auth.uid(),'contact_archived','contacts',p_contact_id::text,jsonb_build_object('balance',balance));
end;
$$;

create or replace function private.restore_contact_impl(p_business_id uuid,p_contact_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if private.business_role(p_business_id) not in ('owner','manager') or not private.is_business_active(p_business_id) then raise exception 'Manager access required'; end if;
  update public.contacts set is_active=true where id=p_contact_id and business_id=p_business_id and not is_active;
  if not found then raise exception 'Archived contact not found'; end if;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id) values(p_business_id,auth.uid(),'contact_restored','contacts',p_contact_id::text);
end;
$$;
create or replace function public.restore_contact(p_business_id uuid,p_contact_id uuid) returns void language sql set search_path='' as $$ select private.restore_contact_impl(p_business_id,p_contact_id) $$;

create or replace function private.archive_product_impl(p_business_id uuid,p_product_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
declare v_stock numeric;
begin
  if private.business_role(p_business_id) not in ('owner','manager') or not private.is_business_active(p_business_id) then raise exception 'Manager access required'; end if;
  select stock_quantity into v_stock from public.products where id=p_product_id and business_id=p_business_id and is_active for update;
  if not found then raise exception 'Active product not found'; end if;
  if abs(v_stock)>0.0005 then raise exception 'Product archive se pehle stock zero karein. Current stock: %',v_stock; end if;
  update public.products set is_active=false where id=p_product_id and business_id=p_business_id;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id,details) values(p_business_id,auth.uid(),'product_archived','products',p_product_id::text,jsonb_build_object('stock',v_stock));
end;
$$;
create or replace function public.archive_product(p_business_id uuid,p_product_id uuid) returns void language sql set search_path='' as $$ select private.archive_product_impl(p_business_id,p_product_id) $$;

create or replace function private.restore_product_impl(p_business_id uuid,p_product_id uuid)
returns void
language plpgsql
security definer
set search_path=''
as $$
begin
  if private.business_role(p_business_id) not in ('owner','manager') or not private.is_business_active(p_business_id) then raise exception 'Manager access required'; end if;
  update public.products set is_active=true where id=p_product_id and business_id=p_business_id and not is_active;
  if not found then raise exception 'Archived product not found'; end if;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id) values(p_business_id,auth.uid(),'product_restored','products',p_product_id::text);
end;
$$;
create or replace function public.restore_product(p_business_id uuid,p_product_id uuid) returns void language sql set search_path='' as $$ select private.restore_product_impl(p_business_id,p_product_id) $$;

grant execute on function public.restore_contact(uuid,uuid) to authenticated;
grant execute on function public.archive_product(uuid,uuid) to authenticated;
grant execute on function public.restore_product(uuid,uuid) to authenticated;
revoke execute on function public.restore_contact(uuid,uuid) from anon;
revoke execute on function public.archive_product(uuid,uuid) from anon;
revoke execute on function public.restore_product(uuid,uuid) from anon;

-- Audit history must not be destructively modifiable by browser roles.
revoke truncate,trigger,references on public.audit_logs from anon,authenticated;
