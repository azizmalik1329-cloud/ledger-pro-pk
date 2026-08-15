create or replace function private.business_role(p_business_id uuid,p_user_id uuid default auth.uid())
returns text language sql stable security definer set search_path=''
as $$ select role from public.business_members where business_id=p_business_id and user_id=p_user_id $$;
revoke all on function private.business_role(uuid,uuid) from public,anon,authenticated;

drop policy if exists contacts_update_member on public.contacts;
create policy contacts_update_manager on public.contacts for update to authenticated
using (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'))
with check (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'));
drop policy if exists contacts_delete_member on public.contacts;
create policy contacts_delete_manager on public.contacts for delete to authenticated
using (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'));

drop policy if exists products_update_member on public.products;
create policy products_update_manager on public.products for update to authenticated
using (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'))
with check (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'));
drop policy if exists products_delete_member on public.products;
create policy products_delete_manager on public.products for delete to authenticated
using (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'));

drop policy if exists transactions_update_member on public.transactions;
create policy transactions_update_manager on public.transactions for update to authenticated
using (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'))
with check (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'));
drop policy if exists transactions_delete_member on public.transactions;
create policy transactions_delete_manager on public.transactions for delete to authenticated
using (private.is_business_active(business_id) and private.business_role(business_id) in ('owner','manager'));

create or replace function public.owner_members()
returns table(user_id uuid,email text,full_name text,role text,created_at timestamptz)
language plpgsql security definer set search_path='' as $$
declare bid uuid;
begin
  select id into bid from public.businesses where owner_id=auth.uid() limit 1;
  if bid is null then raise exception 'Owner access required'; end if;
  return query select bm.user_id,u.email::text,p.full_name,bm.role,bm.created_at
  from public.business_members bm join auth.users u on u.id=bm.user_id
  left join public.profiles p on p.id=bm.user_id where bm.business_id=bid order by bm.created_at;
end $$;
revoke all on function public.owner_members() from public,anon;
grant execute on function public.owner_members() to authenticated;

create or replace function public.owner_remove_member(p_user_id uuid)
returns void language plpgsql security definer set search_path='' as $$
declare bid uuid;
begin
  select id into bid from public.businesses where owner_id=auth.uid() limit 1;
  if bid is null then raise exception 'Owner access required'; end if;
  if p_user_id=auth.uid() then raise exception 'Owner ko remove nahi kar sakte'; end if;
  delete from public.business_members where business_id=bid and user_id=p_user_id;
  insert into public.audit_logs(business_id,actor_id,action,entity_type,entity_id)
  values(bid,auth.uid(),'member_removed','business_member',p_user_id::text);
end $$;
revoke all on function public.owner_remove_member(uuid) from public,anon;
grant execute on function public.owner_remove_member(uuid) to authenticated;
