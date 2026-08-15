import { createClient } from "@supabase/supabase-js";

const url = "https://tpbrthhgpvdazjircwws.supabase.co";
const publishableKey = "sb_publishable_fUzGyUXfYjQhDMyMT1DQlA_x19KSDL0";

export const supabase = createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});
