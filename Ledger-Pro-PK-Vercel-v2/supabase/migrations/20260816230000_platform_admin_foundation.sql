create table if not exists public.platform_admins (
  user_id uuid primary key references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  created_by uuid references auth.users(id) on delete set null
);
alter table public.platform_admins enable row level security;

alter table public.businesses
  add column if not exists status text not null default 'active',
  add column if not exists plan text not null default 'free',
  add column if not exists trial_ends_at timestamptz default (now() + interval '14 days'),
  add column if not exists plan_expires_at timestamptz,
  add column if not exists phone text,
  add column if not exists address text,
  add column if not exists tax_number text,
  add column if not exists invoice_prefix text not null default 'INV',
  add column if not exists max_members integer not null default 2,
  add column if not exists max_monthly_transactions integer not null default 200;

alter table public.businesses drop constraint if exists businesses_status_check;
alter table public.businesses add constraint businesses_status_check check (status in ('active','suspended','archived'));
alter table public.businesses drop constraint if exists businesses_plan_check;
alter table public.businesses add constraint businesses_plan_check check (plan in ('free','pro','business'));
alter table public.businesses drop constraint if exists businesses_limits_check;
alter table public.businesses add constraint businesses_limits_check check (max_members > 0 and max_monthly_transactions > 0);

create table if not exists public.audit_logs (
  id bigint generated always as identity primary key,
  business_id uuid references public.businesses(id) on delete cascade,
  actor_id uuid references auth.users(id) on delete set null,
  action text not null,
  entity_type text not null,
  entity_id text,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
alter table public.audit_logs enable row level security;
create index if not exists audit_logs_business_created_idx on public.audit_logs(business_id, created_at desc);

drop policy if exists audit_logs_select_owner on public.audit_logs;
create policy audit_logs_select_owner on public.audit_logs for select to authenticated
using (private.is_business_owner(business_id));

create or replace function private.is_platform_admin(p_user_id uuid default auth.uid())
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.platform_admins where user_id = p_user_id) $$;
revoke all on function private.is_platform_admin(uuid) from public, anon, authenticated;

create or replace function private.is_business_active(p_business_id uuid)
returns boolean language sql stable security definer set search_path = ''
as $$ select exists(select 1 from public.businesses where id=p_business_id and status='active') $$;
revoke all on function private.is_business_active(uuid) from public, anon, authenticated;

drop policy if exists contacts_select_member on public.contacts;
create policy contacts_select_member on public.contacts for select to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id));
drop policy if exists contacts_insert_member on public.contacts;
create policy contacts_insert_member on public.contacts for insert to authenticated
with check (private.is_business_member(business_id) and private.is_business_active(business_id) and created_by=(select auth.uid()));
drop policy if exists contacts_update_member on public.contacts;
create policy contacts_update_member on public.contacts for update to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id))
with check (private.is_business_member(business_id) and private.is_business_active(business_id));
drop policy if exists contacts_delete_member on public.contacts;
create policy contacts_delete_member on public.contacts for delete to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id));

drop policy if exists products_select_member on public.products;
create policy products_select_member on public.products for select to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id));
drop policy if exists products_insert_member on public.products;
create policy products_insert_member on public.products for insert to authenticated
with check (private.is_business_member(business_id) and private.is_business_active(business_id) and created_by=(select auth.uid()));
drop policy if exists products_update_member on public.products;
create policy products_update_member on public.products for update to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id))
with check (private.is_business_member(business_id) and private.is_business_active(business_id));
drop policy if exists products_delete_member on public.products;
create policy products_delete_member on public.products for delete to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id));

drop policy if exists transactions_select_member on public.transactions;
create policy transactions_select_member on public.transactions for select to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id));
drop policy if exists transactions_insert_member on public.transactions;
create policy transactions_insert_member on public.transactions for insert to authenticated
with check (private.is_business_member(business_id) and private.is_business_active(business_id) and created_by=(select auth.uid()));
drop policy if exists transactions_update_member on public.transactions;
create policy transactions_update_member on public.transactions for update to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id))
with check (private.is_business_member(business_id) and private.is_business_active(business_id));
drop policy if exists transactions_delete_member on public.transactions;
create policy transactions_delete_member on public.transactions for delete to authenticated
using (private.is_business_member(business_id) and private.is_business_active(business_id));

create or replace function private.record_business_change()
returns trigger language plpgsql security definer set search_path = '' as $$
declare target_business uuid; target_id text;
begin
  if tg_op='DELETE' then target_business:=old.business_id; target_id:=old.id::text;
  else target_business:=new.business_id; target_id:=new.id::text; end if;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id)
  values(target_business,auth.uid(),lower(tg_op),tg_table_name,target_id);
  return case when tg_op='DELETE' then old else new end;
end $$;
revoke all on function private.record_business_change() from public,anon,authenticated;

do $$ declare t text; begin
  foreach t in array array['contacts','products','transactions'] loop
    execute format('drop trigger if exists %I_audit on public.%I',t,t);
    execute format('create trigger %I_audit after insert or update or delete on public.%I for each row execute function private.record_business_change()',t,t);
  end loop;
end $$;

create or replace function public.platform_admin_me()
returns boolean language sql stable security definer set search_path=''
as $$ select private.is_platform_admin(auth.uid()) $$;
revoke all on function public.platform_admin_me() from public,anon;
grant execute on function public.platform_admin_me() to authenticated;

create or replace function public.platform_admin_overview()
returns jsonb language plpgsql security definer set search_path='' as $$
declare result jsonb;
begin
  if not private.is_platform_admin(auth.uid()) then raise exception 'Platform admin access required'; end if;
  select jsonb_build_object(
    'users',(select count(*) from auth.users),
    'businesses',(select count(*) from public.businesses),
    'active_businesses',(select count(*) from public.businesses where status='active'),
    'suspended_businesses',(select count(*) from public.businesses where status='suspended'),
    'transactions',(select count(*) from public.transactions),
    'new_users_30d',(select count(*) from auth.users where created_at>=now()-interval '30 days')
  ) into result;
  return result;
end $$;
revoke all on function public.platform_admin_overview() from public,anon;
grant execute on function public.platform_admin_overview() to authenticated;

create or replace function public.platform_admin_businesses()
returns table(id uuid,name text,status text,plan text,trial_ends_at timestamptz,plan_expires_at timestamptz,owner_email text,members bigint,transactions bigint,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin(auth.uid()) then raise exception 'Platform admin access required'; end if;
  return query select b.id,b.name,b.status,b.plan,b.trial_ends_at,b.plan_expires_at,u.email::text,
    (select count(*) from public.business_members m where m.business_id=b.id),
    (select count(*) from public.transactions t where t.business_id=b.id),b.created_at
  from public.businesses b join auth.users u on u.id=b.owner_id order by b.created_at desc;
end $$;
revoke all on function public.platform_admin_businesses() from public,anon;
grant execute on function public.platform_admin_businesses() to authenticated;

create or replace function public.platform_admin_update_business(p_business_id uuid,p_status text,p_plan text,p_plan_expires_at timestamptz default null)
returns void language plpgsql security definer set search_path='' as $$
begin
  if not private.is_platform_admin(auth.uid()) then raise exception 'Platform admin access required'; end if;
  if p_status not in ('active','suspended','archived') or p_plan not in ('free','pro','business') then raise exception 'Invalid status or plan'; end if;
  update public.businesses set status=p_status,plan=p_plan,plan_expires_at=p_plan_expires_at,
    max_members=case p_plan when 'free' then 2 when 'pro' then 10 else 50 end,
    max_monthly_transactions=case p_plan when 'free' then 200 when 'pro' then 5000 else 50000 end
  where id=p_business_id;
  if not found then raise exception 'Business not found'; end if;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id,details)
  values(p_business_id,auth.uid(),'platform_update','business',p_business_id::text,jsonb_build_object('status',p_status,'plan',p_plan,'expires_at',p_plan_expires_at));
end $$;
revoke all on function public.platform_admin_update_business(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.platform_admin_update_business(uuid,text,text,timestamptz) to authenticated;

create or replace function public.owner_add_member_by_email(p_email text,p_role text)
returns void language plpgsql security definer set search_path='' as $$
declare bid uuid; target_user uuid; member_count bigint; member_limit integer;
begin
  if p_role not in ('manager','staff') then raise exception 'Invalid role'; end if;
  select b.id,b.max_members into bid,member_limit from public.businesses b where b.owner_id=auth.uid() and b.status='active' limit 1;
  if bid is null then raise exception 'Active owned business not found'; end if;
  select count(*) into member_count from public.business_members where business_id=bid;
  if member_count>=member_limit then raise exception 'Plan member limit reached'; end if;
  select id into target_user from auth.users where lower(email)=lower(trim(p_email));
  if target_user is null then raise exception 'User pehle app par signup kare'; end if;
  insert into public.business_members(business_id,user_id,role) values(bid,target_user,p_role)
  on conflict(business_id,user_id) do update set role=excluded.role;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id,details)
  values(bid,auth.uid(),'member_added','business_member',target_user::text,jsonb_build_object('role',p_role));
end $$;
revoke all on function public.owner_add_member_by_email(text,text) from public,anon;
grant execute on function public.owner_add_member_by_email(text,text) to authenticated;
