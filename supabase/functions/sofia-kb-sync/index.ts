import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { sofiaFetch, corsHeaders, jsonResponse } from "../_shared/sofia.ts";

/**
 * Sincroniza bases de conhecimento + documentos da Sofia com tabelas locais.
 */
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const kbRes = await sofiaFetch("/user/knowledgebases");
    if (!kbRes.ok) {
      const t = await kbRes.text();
      return jsonResponse({ error: "Falha buscando bases", status: kbRes.status, body: t.slice(0, 500) }, 502);
    }
    const kbData = await kbRes.json();
    const bases = kbData.data ?? [];

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const kbRows = bases.map((k: any) => ({
      sofia_kb_id: k.id,
      name: k.name,
      description: k.description ?? null,
      status: k.status ?? null,
      status_label: k.status_label ?? null,
      documents_count: k.documents_count ?? 0,
      assistants_count: k.assistants_count ?? 0,
      raw: k,
      synced_at: new Date().toISOString(),
    }));

    if (kbRows.length > 0) {
      const { error } = await supabase
        .from("sofia_knowledgebases")
        .upsert(kbRows, { onConflict: "sofia_kb_id" });
      if (error) return jsonResponse({ error: "kb upsert: " + error.message }, 500);
    }

    // Pra cada base, buscar docs
    let totalDocs = 0;
    for (const kb of bases) {
      const dRes = await sofiaFetch(`/user/knowledgebases/${kb.id}/documents`);
      if (!dRes.ok) continue;
      const dData = await dRes.json();
      const docs = dData.data ?? [];
      const docRows = docs.map((d: any) => ({
        sofia_doc_id: d.id,
        sofia_kb_id: kb.id,
        name: d.name,
        description: d.description ?? null,
        type: d.type ?? null,
        type_label: d.type_label ?? null,
        status: d.status ?? null,
        status_label: d.status_label ?? null,
        raw: d,
        synced_at: new Date().toISOString(),
      }));
      if (docRows.length > 0) {
        const { error } = await supabase
          .from("sofia_kb_documents")
          .upsert(docRows, { onConflict: "sofia_doc_id" });
        if (error) {
          return jsonResponse({ error: `doc upsert (kb ${kb.id}): ` + error.message }, 500);
        }
        totalDocs += docRows.length;
      }
    }

    return jsonResponse({ kbs: kbRows.length, documents: totalDocs });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return jsonResponse({ error: msg }, 500);
  }
});
