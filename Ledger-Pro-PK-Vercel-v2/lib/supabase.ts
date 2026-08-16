import { createClient } from "@supabase/supabase-js";

const url = "https://tpbrthhgpvdazjircwws.supabase.co";
const publishableKey = "sb_publishable_fUzGyUXfYjQhDMyMT1DQlA_x19KSDL0";

const baseSupabase = createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

// The app only reads business_members directly to discover the signed-in user's
// own businesses. Team mutations and listings already use secured RPCs.
// Route that discovery through the authoritative SECURITY DEFINER bootstrap RPC
// so an embedded businesses RLS read can never transiently turn a valid account
// into the misleading "Business linked nahi hai" state.
const membershipReadAdapter = {
  select: async () => {
    const { data, error } = await baseSupabase.rpc("current_account_bootstrap");
    const payload = data && typeof data === "object" ? data as { memberships?: unknown[] } : null;
    return {
      data: Array.isArray(payload?.memberships) ? payload.memberships : [],
      error,
      count: null,
      status: error ? 400 : 200,
      statusText: error ? "Bootstrap error" : "OK",
    };
  },
};

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property === "from") {
      return (relation: string) => relation === "business_members"
        ? membershipReadAdapter
        : (target as any).from(relation);
    }
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as typeof baseSupabase;
