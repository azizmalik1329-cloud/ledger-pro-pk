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

// App routes already perform getSession() on mount. GoTrue also emits
// INITIAL_SESSION, and background auto-refresh emits TOKEN_REFRESHED. The
// Supabase client updates its own active token before TOKEN_REFRESHED fires, so
// route components do not need to rebuild all business data for that event.
// Keep user-visible/auth-lifecycle events (SIGNED_IN, SIGNED_OUT,
// PASSWORD_RECOVERY, USER_UPDATED, etc.) flowing normally.
const subscribeToAuth = supabaseClient.auth.onAuthStateChange.bind(supabaseClient.auth);
supabaseClient.auth.onAuthStateChange = ((callback) =>
  subscribeToAuth((event, session) => {
    if (event === "INITIAL_SESSION" || event === "TOKEN_REFRESHED") return;
    return callback(event, session);
  })) as typeof supabaseClient.auth.onAuthStateChange;

export const supabase = supabaseClient;
