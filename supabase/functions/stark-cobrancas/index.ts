// @ts-nocheck
import { starkFetch, starkErrorMessage } from "../_shared/stark.ts";
import { getAuthedUser, isAprovador } from "../_shared/require-user.ts";

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(obj: any, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function mapInvoice(i: any) {
  return {
    id: i.id,
    amount: Number(i.amount ?? 0) / 100,
    nominalAmount: i.nominalAmount != null ? Number(i.nominalAmount) / 100 : null,
    fee: i.fee != null ? Number(i.fee) / 100 : null,
    name: i.name,
    taxId: i.taxId,
    status: i.status,
    brcode: i.brcode,
    link: i.link,
    due: i.due,
    created: i.created,
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  try {
    const user = await getAuthedUser(req);
    if (!user) return json({ error: 'Não autenticado' }, 401);
    const body = await req.json().catch(() => ({}));
    const action = body?.action;

    if (action === 'list') {
      const limit = Math.min(Math.max(Number(body.limit ?? 100), 1), 100);
      const { ok, status, data, raw } = await starkFetch(`/invoice?limit=${limit}`);
      if (!ok) return json({ ok: false, error: starkErrorMessage(data, raw, status), status }, 200);
      return json({ ok: true, invoices: (data?.invoices ?? []).map(mapInvoice) });
    }

    if (action === 'create') {
      const amount = Number(body.amount);
      const name = String(body.name || '').trim();
      const taxId = String(body.taxId || '').replace(/\D/g, '');
      const due = body.due || undefined;
      const description = body.description ? String(body.description) : undefined;
      if (!amount || amount <= 0) return json({ ok: false, error: 'Valor inválido' }, 400);
      if (!name) return json({ ok: false, error: 'Nome do pagador é obrigatório' }, 400);
      if (!taxId || (taxId.length !== 11 && taxId.length !== 14)) {
        return json({ ok: false, error: 'CPF/CNPJ inválido' }, 400);
      }

      const invoice: any = {
        amount: Math.round(amount * 100),
        name,
        taxId,
      };
      if (due) invoice.due = due;
      if (description) invoice.descriptions = [{ key: 'Ref', value: description }];

      const { ok, status, data, raw } = await starkFetch('/invoice', {
        method: 'POST',
        body: { invoices: [invoice] },
      });
      if (!ok) return json({ ok: false, error: starkErrorMessage(data, raw, status), status }, 200);
      const created = (data?.invoices ?? [])[0];
      if (!created) return json({ ok: false, error: 'Resposta sem invoice' }, 200);
      return json({ ok: true, invoice: mapInvoice(created) });
    }

    if (action === 'cancel') {
      const id = String(body.id || '').trim();
      if (!id) return json({ ok: false, error: 'ID da cobrança é obrigatório' }, 400);
      const { ok, status, data, raw } = await starkFetch(`/invoice/${id}`, {
        method: 'PATCH',
        body: { status: 'canceled' },
      });
      if (!ok) return json({ ok: false, error: starkErrorMessage(data, raw, status), status }, 200);
      const updated = data?.invoice ?? null;
      if (!updated) return json({ ok: false, error: 'Resposta sem invoice' }, 200);
      return json({ ok: true, invoice: mapInvoice(updated) });
    }

    return json({ ok: false, error: `Ação inválida: ${action}` }, 400);
  } catch (e: any) {
    console.error('stark-cobrancas error', e);
    return json({ ok: false, error: e?.message ?? 'Erro inesperado' }, 200);
  }
});
