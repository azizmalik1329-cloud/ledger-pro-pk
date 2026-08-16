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
let lastBootstrap: { userId: string; data: AccountBootstrap; at: number } | null = null;

const sleep = (ms: number) => new Promise(resolve => window.setTimeout(resolve, ms));

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
  if (lastBootstrap?.userId === userId && Date.now() - lastBootstrap.at < 5000) {
    return { data: lastBootstrap.data, error: null };
  }

  if (bootstrapFlight) return bootstrapFlight;

  bootstrapFlight = (async () => {
    let lastError: any = null;

    for (let attempt = 0; attempt < 6; attempt += 1) {
      const { data, error } = await baseSupabase.rpc("current_account_bootstrap");
      const payload = data && typeof data === "object" ? data as AccountBootstrap : null;

      if (
        !error &&
        payload?.user_id === userId &&
        Array.isArray(payload.memberships)
      ) {
        lastBootstrap = { userId, data: payload, at: Date.now() };
        return { data: payload, error: null };
      }

      lastError = error || new Error("Authenticated account bootstrap did not match the active session.");
      if (attempt < 5) await sleep(120 * (attempt + 1));
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
