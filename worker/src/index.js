// Cloudflare Worker: Facebook login + subscriptions for the injaz app.
// Secrets (set with `wrangler secret put` or in the dashboard): FB_APP_ID, FB_APP_SECRET, ADMIN_PASSWORD.
// Var (wrangler.toml): WORKER_URL (this worker's public URL, no trailing slash).
// KV binding: SUBS (stores trials, subscriptions and activation codes).

const GRAPH = "https://graph.facebook.com/v19.0";
const SCOPES = "pages_show_list,pages_read_engagement,pages_manage_engagement,pages_manage_posts";
const DAY = 24 * 60 * 60 * 1000;
const TRIAL_MS = 2 * 60 * 60 * 1000;
const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "POST, OPTIONS",
  "access-control-allow-headers": "content-type, x-admin-password",
};

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

    if (url.pathname === "/login") {
      const state = crypto.randomUUID();
      const auth = new URL("https://www.facebook.com/v19.0/dialog/oauth");
      auth.search = new URLSearchParams({
        client_id: env.FB_APP_ID,
        redirect_uri: `${env.WORKER_URL}/callback`,
        scope: SCOPES,
        state,
        response_type: "code",
      }).toString();
      return Response.redirect(auth.toString(), 302);
    }

    if (url.pathname === "/callback") {
      const code = url.searchParams.get("code");
      if (!code) return new Response("Login cancelled.", { status: 400 });

      try {
        // 1) Exchange the code for a short-lived user token.
        const short = await getJson(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
          client_id: env.FB_APP_ID,
          client_secret: env.FB_APP_SECRET,
          redirect_uri: `${env.WORKER_URL}/callback`,
          code,
        }));

        // 2) Upgrade it to a long-lived user token.
        const long = await getJson(`${GRAPH}/oauth/access_token?` + new URLSearchParams({
          grant_type: "fb_exchange_token",
          client_id: env.FB_APP_ID,
          client_secret: env.FB_APP_SECRET,
          fb_exchange_token: short.access_token,
        }));

        // 3) Pages this user manages, each with its own page token.
        const accounts = await getJson(`${GRAPH}/me/accounts?` + new URLSearchParams({
          fields: "id,name,access_token",
          access_token: long.access_token,
        }));

        const pages = (accounts.data || []).map((p) => ({ id: p.id, name: p.name, token: p.access_token }));
        if (!pages.length) return new Response("No pages found for this account.", { status: 400 });

        // 4) Hand the result back to the app through its custom scheme.
        const payload = btoa(unescape(encodeURIComponent(JSON.stringify(pages))));
        return Response.redirect(`injaz://auth?pages=${encodeURIComponent(payload)}`, 302);
      } catch (e) {
        return new Response("Login failed: " + e.message, { status: 500 });
      }
    }

    // App: check trial/subscription state for a page (starts the 2-hour trial on first call).
    if (url.pathname === "/status" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const pageId = await verifyPage(body.pageId, body.token);
      if (!pageId) return json({ error: "invalid_page" }, 401);
      const sub = await readSub(env, pageId);
      return json(statusOf(sub));
    }

    // App: redeem an activation code for a page (one-time use).
    if (url.pathname === "/activate" && request.method === "POST") {
      const body = await request.json().catch(() => ({}));
      const pageId = await verifyPage(body.pageId, body.token);
      if (!pageId) return json({ error: "invalid_page" }, 401);

      const key = "code:" + String(body.code || "").trim().toUpperCase();
      const days = Number(await env.SUBS.get(key));
      if (!days) return json({ error: "invalid_code" }, 400);
      await env.SUBS.delete(key);

      const sub = await readSub(env, pageId);
      sub.activeUntil = Math.max(Date.now(), sub.activeUntil || 0) + days * DAY;
      await env.SUBS.put("sub:" + pageId, JSON.stringify(sub));
      return json(statusOf(sub));
    }

    // Owner only: create activation codes. Body: { days: 30 | 365, count: 1..50 }.
    if (url.pathname === "/admin/codes" && request.method === "POST") {
      if (!env.ADMIN_PASSWORD || request.headers.get("x-admin-password") !== env.ADMIN_PASSWORD) {
        return json({ error: "unauthorized" }, 401);
      }
      const body = await request.json().catch(() => ({}));
      const days = Number(body.days) || 30;
      const count = Math.min(Number(body.count) || 1, 50);
      const codes = [];
      for (let i = 0; i < count; i++) {
        const c = randomCode();
        await env.SUBS.put("code:" + c, String(days));
        codes.push(c);
      }
      return json({ days, codes });
    }

    return new Response("injaz auth worker", { status: 200 });
  },
};

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...CORS, "content-type": "application/json; charset=utf-8" },
  });
}

// The app sends its page token; Facebook tells us which page it belongs to.
async function verifyPage(pageId, token) {
  if (!pageId || !token) return null;
  const me = await fetch(`${GRAPH}/me?fields=id&access_token=${encodeURIComponent(token)}`)
    .then((r) => r.json())
    .catch(() => null);
  return me && String(me.id) === String(pageId) ? String(pageId) : null;
}

async function readSub(env, pageId) {
  const raw = await env.SUBS.get("sub:" + pageId);
  if (raw) return JSON.parse(raw);
  const sub = { trialStart: Date.now(), activeUntil: 0 };
  await env.SUBS.put("sub:" + pageId, JSON.stringify(sub));
  return sub;
}

function statusOf(sub) {
  const now = Date.now();
  if (sub.activeUntil > now) return { state: "active", endsAt: sub.activeUntil };
  const trialEnd = sub.trialStart + TRIAL_MS;
  if (trialEnd > now) return { state: "trial", endsAt: trialEnd };
  return { state: "expired", endsAt: sub.activeUntil || trialEnd };
}

function randomCode() {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no 0/O/1/I
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s.slice(0, 5) + "-" + s.slice(5);
}

async function getJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (data.error) throw new Error(data.error.message);
  return data;
}
