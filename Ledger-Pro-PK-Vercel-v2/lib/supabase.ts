import { createClient } from "@supabase/supabase-js";

const url = "https://tpbrthhgpvdazjircwws.supabase.co";
const publishableKey = "sb_publishable_fUzGyUXfYjQhDMyMT1DQlA_x19KSDL0";

const supabaseClient = createClient(url, publishableKey, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: true,
  },
});

// Ledger Pro supports the same account on multiple devices. Supabase signOut()
// defaults to global scope, which can invalidate refresh sessions on the user's
// other devices. Keep every existing logout button current-device-only unless a
// caller explicitly requests another scope in the future.
const signOut = supabaseClient.auth.signOut.bind(supabaseClient.auth);
supabaseClient.auth.signOut = ((options) =>
  signOut({ ...(options ?? {}), scope: options?.scope ?? "local" })) as typeof supabaseClient.auth.signOut;

// Every authenticated app route already performs getSession() on mount. GoTrue
// also emits INITIAL_SESSION to each new auth listener, which made the same
// account bootstrap run twice (and sometimes three times around a fresh login).
// Suppress only that duplicate initial notification; real SIGNED_IN,
// TOKEN_REFRESHED, SIGNED_OUT and PASSWORD_RECOVERY events still pass through.
const subscribeToAuth = supabaseClient.auth.onAuthStateChange.bind(supabaseClient.auth);
supabaseClient.auth.onAuthStateChange = ((callback) =>
  subscribeToAuth((event, session) => {
    if (event === "INITIAL_SESSION") return;
    return callback(event, session);
  })) as typeof supabaseClient.auth.onAuthStateChange;

export const supabase = supabaseClient;
