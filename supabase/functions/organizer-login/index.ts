// Public login endpoint. Supabase Auth verifies the password and issues the session.
const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Cache-Control": "no-store",
  "Content-Type": "application/json",
};

function reply(status: number, body: object) {
  return new Response(JSON.stringify(body), { status, headers });
}

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { headers });
  if (request.method !== "POST") return reply(405, { error: "method" });
  let input;
  try {
    input = await request.json();
  } catch {
    return reply(400, { error: "input" });
  }
  const alias = typeof input?.alias === "string" ? input.alias.trim().toLowerCase() : "";
  const password = input?.password;
  const denied = () => reply(401, { error: "credentials" });
  if (!/^[a-z][a-z0-9_]{2,23}$/.test(alias) || typeof password !== "string" || !password) return denied();

  const url = Deno.env.get("SUPABASE_URL");
  try {
    const service = JSON.parse(Deno.env.get("SUPABASE_SECRET_KEYS") || "{}").default ||
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    const anon = JSON.parse(Deno.env.get("SUPABASE_PUBLISHABLE_KEYS") || "{}").default ||
      Deno.env.get("SUPABASE_ANON_KEY");
    if (!url || !service || !anon) return reply(503, { error: "setup" });
    const lookup = await fetch(url + "/rest/v1/rpc/league_resolve_alias", {
      method: "POST",
      headers: { apikey: service, "Content-Type": "application/json" },
      body: JSON.stringify({ requested_alias: alias }),
    });
    if (!lookup.ok) return reply(503, { error: "setup" });
    const email = await lookup.json();
    if (typeof email !== "string" || !email) return denied();
    const auth = await fetch(url + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: { apikey: anon, "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (auth.status === 429) return reply(429, { error: "rate_limit" });
    if (auth.status >= 500) return reply(503, { error: "unavailable" });
    if (!auth.ok) return denied();
    const { access_token, refresh_token } = await auth.json();
    if (!access_token || !refresh_token) return reply(503, { error: "unavailable" });
    return reply(200, { access_token, refresh_token });
  } catch {
    return reply(503, { error: "unavailable" });
  }
});
