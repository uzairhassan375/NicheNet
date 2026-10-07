const url = import.meta.env.VITE_SUPABASE_URL;
const key = import.meta.env.VITE_SUPABASE_ANON_KEY;

export function isConfigured() {
  return Boolean(url && key);
}

export async function rpc(name, args) {
  if (!isConfigured()) {
    return {
      ok: false,
      error: "Add VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY to admin/.env, then restart this site.",
    };
  }
  let response;
  try {
    response = await fetch(`${url}/rest/v1/rpc/${name}`, {
      method: "POST",
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(args),
    });
  } catch {
    return { ok: false, error: "Could not reach Supabase." };
  }
  let payload = null;
  try {
    payload = await response.json();
  } catch {
    payload = null;
  }
  if (!response.ok) {
    const message = payload?.message || payload?.error || `Supabase returned HTTP ${response.status}.`;
    if (response.status === 401 || /invalid api key|no api key/i.test(message)) {
      return { ok: false, error: "Paste the Supabase anon key into admin/.env as VITE_SUPABASE_ANON_KEY, then restart this site." };
    }
    return { ok: false, error: message };
  }
  if (payload && typeof payload === "object" && !Array.isArray(payload)) return payload;
  return { ok: false, error: "Unexpected response from Supabase." };
}
