import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sofiaFetch, corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Roteador de ações na base de conhecimento da Sofia.
 *
 * Body: { action, ...args }
 *
 * actions:
 *   - create_kb         { name, description? }
 *   - delete_kb         { sofia_kb_id }
 *   - update_kb         { sofia_kb_id, name?, description? }
 *   - create_doc_text   { sofia_kb_id, name, content, description? }
 *   - create_doc_website{ sofia_kb_id, name, url, links?, relative_links_limit? }
 *   - delete_doc        { sofia_kb_id, sofia_doc_id }
 *   - update_doc        { sofia_kb_id, sofia_doc_id, name?, description? }
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return jsonResponse({ error: "Method not allowed" }, 405);

  try {
    const body = await req.json();
    const action: string = body?.action;
    if (!action) return jsonResponse({ error: "action obrigatória" }, 400);

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    switch (action) {
      case "create_kb": {
        if (!body.name) return jsonResponse({ error: "name obrigatório" }, 400);
        const r = await sofiaFetch("/user/knowledgebases", {
          method: "POST",
          body: JSON.stringify({ name: body.name, description: body.description ?? null }),
        });
        const data = await r.json();
        if (!r.ok) return jsonResponse({ error: "Sofia: " + (data?.message ?? r.status), data }, 502);
        const k = data.data ?? data;
        await supabase.from("sofia_knowledgebases").upsert({
          sofia_kb_id: k.id,
          name: k.name,
          description: k.description ?? null,
          status: k.status ?? null,
          status_label: k.status_label ?? null,
          raw: k,
          synced_at: new Date().toISOString(),
        }, { onConflict: "sofia_kb_id" });
        return jsonResponse({ ok: true, sofia_kb_id: k.id, data });
      }

      case "delete_kb": {
        if (!body.sofia_kb_id) return jsonResponse({ error: "sofia_kb_id obrigatório" }, 400);
        const r = await sofiaFetch(`/user/knowledgebases/${body.sofia_kb_id}`, { method: "DELETE" });
        if (!r.ok) {
          const t = await r.text();
          return jsonResponse({ error: "Sofia: " + r.status, body: t.slice(0, 500) }, 502);
        }
        await supabase.from("sofia_knowledgebases").delete().eq("sofia_kb_id", body.sofia_kb_id);
        return jsonResponse({ ok: true });
      }

      case "update_kb": {
        if (!body.sofia_kb_id) return jsonResponse({ error: "sofia_kb_id obrigatório" }, 400);
        const payload: Record<string, unknown> = {};
        if (body.name !== undefined) payload.name = body.name;
        if (body.description !== undefined) payload.description = body.description;
        const r = await sofiaFetch(`/user/knowledgebases/${body.sofia_kb_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) return jsonResponse({ error: "Sofia: " + r.status, data }, 502);
        const k = data.data ?? data;
        await supabase.from("sofia_knowledgebases").update({
          name: k.name,
          description: k.description ?? null,
          synced_at: new Date().toISOString(),
        }).eq("sofia_kb_id", body.sofia_kb_id);
        return jsonResponse({ ok: true });
      }

      case "create_doc_text": {
        if (!body.sofia_kb_id || !body.name || !body.content) {
          return jsonResponse({ error: "sofia_kb_id, name, content obrigatórios" }, 400);
        }
        // Sofia espera multipart com file pra type=txt — usamos Blob
        const blob = new Blob([body.content], { type: "text/plain" });
        const fd = new FormData();
        fd.set("name", body.name);
        fd.set("type", "txt");
        if (body.description) fd.set("description", body.description);
        fd.set("file", blob, `${body.name}.txt`);
        const r = await sofiaFetch(`/user/knowledgebases/${body.sofia_kb_id}/documents`, {
          method: "POST",
          body: fd,
          // não setar Content-Type manualmente — FormData injeta com boundary
        });
        const data = await r.json();
        if (!r.ok) return jsonResponse({ error: "Sofia: " + r.status, data }, 502);
        const d = data.data ?? data;
        await supabase.from("sofia_kb_documents").upsert({
          sofia_doc_id: d.id,
          sofia_kb_id: body.sofia_kb_id,
          name: d.name,
          description: d.description ?? null,
          type: d.type ?? "txt",
          type_label: d.type_label ?? null,
          status: d.status ?? "processing",
          status_label: d.status_label ?? null,
          raw: d,
          synced_at: new Date().toISOString(),
        }, { onConflict: "sofia_doc_id" });
        return jsonResponse({ ok: true, sofia_doc_id: d.id });
      }

      case "create_doc_website": {
        if (!body.sofia_kb_id || !body.name || !body.url) {
          return jsonResponse({ error: "sofia_kb_id, name, url obrigatórios" }, 400);
        }
        const payload: Record<string, unknown> = {
          name: body.name,
          type: "website",
          url: body.url,
        };
        if (body.description) payload.description = body.description;
        if (Array.isArray(body.links)) payload.links = body.links;
        if (body.relative_links_limit) payload.relative_links_limit = body.relative_links_limit;
        const r = await sofiaFetch(`/user/knowledgebases/${body.sofia_kb_id}/documents`, {
          method: "POST",
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) return jsonResponse({ error: "Sofia: " + r.status, data }, 502);
        const d = data.data ?? data;
        await supabase.from("sofia_kb_documents").upsert({
          sofia_doc_id: d.id,
          sofia_kb_id: body.sofia_kb_id,
          name: d.name,
          description: d.description ?? null,
          type: d.type ?? "website",
          type_label: d.type_label ?? null,
          status: d.status ?? "processing",
          status_label: d.status_label ?? null,
          raw: d,
          synced_at: new Date().toISOString(),
        }, { onConflict: "sofia_doc_id" });
        return jsonResponse({ ok: true, sofia_doc_id: d.id });
      }

      case "delete_doc": {
        if (!body.sofia_kb_id || !body.sofia_doc_id) {
          return jsonResponse({ error: "sofia_kb_id e sofia_doc_id obrigatórios" }, 400);
        }
        const r = await sofiaFetch(`/user/knowledgebases/${body.sofia_kb_id}/documents/${body.sofia_doc_id}`, { method: "DELETE" });
        if (!r.ok) {
          const t = await r.text();
          return jsonResponse({ error: "Sofia: " + r.status, body: t.slice(0, 500) }, 502);
        }
        await supabase.from("sofia_kb_documents").delete().eq("sofia_doc_id", body.sofia_doc_id);
        return jsonResponse({ ok: true });
      }

      case "update_doc": {
        if (!body.sofia_kb_id || !body.sofia_doc_id) {
          return jsonResponse({ error: "sofia_kb_id e sofia_doc_id obrigatórios" }, 400);
        }
        const payload: Record<string, unknown> = {};
        if (body.name !== undefined) payload.name = body.name;
        if (body.description !== undefined) payload.description = body.description;
        const r = await sofiaFetch(`/user/knowledgebases/${body.sofia_kb_id}/documents/${body.sofia_doc_id}`, {
          method: "PUT",
          body: JSON.stringify(payload),
        });
        const data = await r.json();
        if (!r.ok) return jsonResponse({ error: "Sofia: " + r.status, data }, 502);
        const d = data.data ?? data;
        await supabase.from("sofia_kb_documents").update({
          name: d.name,
          description: d.description ?? null,
          synced_at: new Date().toISOString(),
        }).eq("sofia_doc_id", body.sofia_doc_id);
        return jsonResponse({ ok: true });
      }

      default:
        return jsonResponse({ error: `action desconhecida: ${action}` }, 400);
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
