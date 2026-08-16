import { createClient } from "@supabase/supabase-js";

const url = "https://tpbrthhgpvdazjircwws.supabase.co";
const publishableKey = "sb_publishable_fUzGyUXfYjQhDMyMT1DQlA_x19KSDL0";

const baseSupabase = createClient(url, publishableKey, {
  auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
});

type AccountBootstrap = {
  user_id: string | null;
  is_platform_admin: boolean;
  memberships: unknown[];
};

type BootstrapResult = {
  data: AccountBootstrap | null;
  error: any;
};

let bootstrapFlight: Promise<BootstrapResult> | null = null;
let lastBootstrap: { userId: string; accessToken: string; data: AccountBootstrap; at: number } | null = null;

const sleep = (ms: number) => new Promise(resolve => globalThis.setTimeout(resolve, ms));
const nowSeconds = () => Math.floor(Date.now() / 1000);
const SAFE_REFRESH_WINDOW_SECONDS = 120;

// The UI shell previously forced refreshSession() while the business page was
// still completing a cold-start bootstrap. Supabase refresh tokens rotate, so
// an unnecessary forced refresh during app reopen/multiple-tab startup could
// invalidate the persisted refresh token and make the next reopen look like a
// different/unlinked account. If the current access token is still comfortably
// valid, return the existing session instead of rotating the refresh token.
async function refreshSessionSafely(currentSession?: Parameters<typeof baseSupabase.auth.refreshSession>[0]) {
  const { data: current, error } = await baseSupabase.auth.getSession();
  if (!currentSession && error) return { data: { user: null, session: null }, error };

  const session = currentSession && "access_token" in currentSession
    ? currentSession as typeof current.session
    : current.session;

  if (
    session?.access_token &&
    session.expires_at &&
    session.expires_at - nowSeconds() > SAFE_REFRESH_WINDOW_SECONDS
  ) {
    return {
      data: { user: session.user, session },
      error: null,
    };
  }

  return baseSupabase.auth.refreshSession(currentSession);
}

const authAdapter = new Proxy(baseSupabase.auth, {
  get(target, property, receiver) {
    if (property === "refreshSession") return refreshSessionSafely;
    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
});

async function callBootstrapWithToken(accessToken: string): Promise<BootstrapResult> {
  try {
    const response = await fetch(`${url}/rest/v1/rpc/current_account_bootstrap`, {
      method: "POST",
      cache: "no-store",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
        "Content-Type": "application/json",
      },
      body: "{}",
    });

    const text = await response.text();
    let payload: unknown = null;
    if (text) {
      try {
        payload = JSON.parse(text);
      } catch {
        payload = null;
      }
    }

    if (!response.ok) {
      const message = payload && typeof payload === "object" && "message" in payload
        ? String((payload as { message?: unknown }).message || `Bootstrap HTTP ${response.status}`)
        : `Bootstrap HTTP ${response.status}`;
      return { data: null, error: new Error(message) };
    }

    return {
      data: payload && typeof payload === "object" ? payload as AccountBootstrap : null,
      error: null,
    };
  } catch (error) {
    return { data: null, error };
  }
}

async function readAccountBootstrap(): Promise<BootstrapResult> {
  const { data: sessionData, error: sessionError } = await baseSupabase.auth.getSession();
  if (sessionError) return { data: null, error: sessionError };

  const session = sessionData.session;
  if (!session) {
    lastBootstrap = null;
    return {
      data: { user_id: null, is_platform_admin: false, memberships: [] },
      error: null,
    };
  }

  const userId = session.user.id;
  const accessToken = session.access_token;
  if (
    lastBootstrap?.userId === userId &&
    lastBootstrap.accessToken === accessToken &&
    Date.now() - lastBootstrap.at < 5000
  ) {
    return { data: lastBootstrap.data, error: null };
  }

  if (bootstrapFlight) return bootstrapFlight;

  bootstrapFlight = (async () => {
    let lastError: any = null;

    for (let attempt = 0; attempt < 4; attempt += 1) {
      // Do not let the SDK choose an implicit/possibly stale Authorization token
      // during auth initialization. Bind this account bootstrap to the exact access
      // token belonging to the session we just read above.
      const { data, error } = await callBootstrapWithToken(accessToken);
      const payload = data && typeof data === "object" ? data as AccountBootstrap : null;

      if (
        !error &&
        payload?.user_id === userId &&
        Array.isArray(payload.memberships)
      ) {
        lastBootstrap = { userId, accessToken, data: payload, at: Date.now() };
        return { data: payload, error: null };
      }

      lastError = error || new Error("Authenticated account bootstrap did not match the active session.");
      if (attempt < 3) await sleep(150 * (attempt + 1));
    }

    return { data: null, error: lastError };
  })();

  try {
    return await bootstrapFlight;
  } finally {
    bootstrapFlight = null;
  }
}

// The app only reads business_members directly to discover the signed-in user's
// own businesses. Team mutations and listings already use secured RPCs.
// Route that discovery through the authoritative bootstrap and serialize it so
// duplicate auth events cannot race an anonymous/older result against a valid one.
const membershipReadAdapter = {
  select: async () => {
    const { data, error } = await readAccountBootstrap();
    return {
      data: Array.isArray(data?.memberships) ? data.memberships : [],
      error,
      count: null,
      status: error ? 400 : 200,
      statusText: error ? "Bootstrap error" : "OK",
    };
  },
};

export const supabase = new Proxy(baseSupabase, {
  get(target, property, receiver) {
    if (property === "auth") return authAdapter;

    if (property === "from") {
      return (relation: string) => relation === "business_members"
        ? membershipReadAdapter
        : (target as any).from(relation);
    }

    if (property === "rpc") {
      return (fn: string, args?: Record<string, unknown>, options?: Record<string, unknown>) => {
        if (fn === "current_account_bootstrap") return readAccountBootstrap();
        return (target as any).rpc(fn, args, options);
      };
    }

    const value = Reflect.get(target, property, receiver);
    return typeof value === "function" ? value.bind(target) : value;
  },
}) as typeof baseSupabase;
