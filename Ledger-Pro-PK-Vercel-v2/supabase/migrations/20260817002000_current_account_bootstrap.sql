create or replace function public.current_account_bootstrap()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with memberships as (
    select
      bm.business_id,
      bm.role,
      b.id,
      b.name,
      b.currency,
      b.status,
      b.plan,
      b.trial_ends_at,
      b.plan_expires_at,
      b.phone,
      b.address,
      b.tax_number,
      b.invoice_prefix,
      b.max_members,
      b.max_monthly_transactions
    from public.business_members bm
    join public.businesses b on b.id = bm.business_id
    where bm.user_id = (select auth.uid())
  )
  select jsonb_build_object(
    'user_id', (select auth.uid()),
    'is_platform_admin', exists(
      select 1 from public.platform_admins pa where pa.user_id = (select auth.uid())
    ),
    'memberships', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'business_id', m.business_id,
          'role', m.role,
          'businesses', jsonb_build_object(
            'id', m.id,
            'name', m.name,
            'currency', m.currency,
            'status', m.status,
            'plan', m.plan,
            'trial_ends_at', m.trial_ends_at,
            'plan_expires_at', m.plan_expires_at,
            'phone', m.phone,
            'address', m.address,
            'tax_number', m.tax_number,
            'invoice_prefix', m.invoice_prefix,
            'max_members', m.max_members,
            'max_monthly_transactions', m.max_monthly_transactions
          )
        )
      ) filter (where m.business_id is not null),
      '[]'::jsonb
    )
  )
  from memberships m;
$$;

revoke all on function public.current_account_bootstrap() from public;
revoke all on function public.current_account_bootstrap() from anon;
grant execute on function public.current_account_bootstrap() to authenticated;
