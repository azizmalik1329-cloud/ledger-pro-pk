create index if not exists audit_logs_actor_idx on public.audit_logs(actor_id);
create index if not exists platform_admins_created_by_idx on public.platform_admins(created_by);

drop policy if exists platform_admins_select_own on public.platform_admins;
create policy platform_admins_select_own on public.platform_admins for select to authenticated
using (user_id=(select auth.uid()));

create or replace function public.platform_admin_me()
returns boolean language sql stable security invoker set search_path=''
as $$ select exists(select 1 from public.platform_admins where user_id=(select auth.uid())) $$;
revoke all on function public.platform_admin_me() from public,anon;
grant execute on function public.platform_admin_me() to authenticated;
