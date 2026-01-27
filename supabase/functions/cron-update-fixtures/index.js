import { serve } from "https://deno.land/std@0.168.0/http/server.ts";

serve(async () => {
  const BASE_URL = Deno.env.get("APP_BASE_URL");

  if (!BASE_URL) {
    return new Response(
      JSON.stringify({ error: "APP_BASE_URL not set" }),
      { status: 500 }
    );
  }

  const res = await fetch(`${BASE_URL}/api/update/fixtures`, {
    method: "GET",
  });

  const text = await res.text();

  return new Response(
    JSON.stringify({
      ok: res.ok,
      status: res.status,
      response: text,
    }),
    { headers: { "Content-Type": "application/json" } }
  );
});