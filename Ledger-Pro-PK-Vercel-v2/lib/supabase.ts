import { createClient } from "@supabase/supabase-js";

const url = "https://tpbrthhgpvdazjircwws.supabase.co";
const publishableKey = "sb_publishable_fUzGyUXfYjQhDMyMT1DQlA_x19KSDL0";

// Keep one normal browser client and let supabase-js own session persistence,
// token refresh and auth event serialization. Do not proxy auth, RPC or table
// reads here: page-level code is the single source of truth for account loading.
export const supabase = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});
