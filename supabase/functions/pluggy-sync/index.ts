// pluggy-sync — sincroniza contas e transações Pluggy → cashflow_*
// Acionamento manual (sem cron). Idempotente via (account_id, external_id).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PLUGGY = 'https://api.pluggy.ai';
const DAYS_BACK = 90;

// ---- espelha detectInternalTransfer de src/lib/cashflow-parsers.ts ----
const INTERNAL_TOKENS = [
  'PIZZARIA ESTRELA DA ILHA',
  'PROPOSITO',
  '5 ESTRELAS',
  'PROVER',
  'LUCAS SOSA TIDRE',
  'LUANA',
];
function norm(s: string): string {
  return (s || '').normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
}
function detectInternalTransfer(description?: string | null, detail?: string | null) {
  const txt = `${description ?? ''} ${detail ?? ''}`;
  const n = norm(txt);
  if (/IFOOD/.test(n) && /(REPASSE|PIX ENVIADO|ANTECIPACAO)/.test(n)) {
    return { is_internal_transfer: true, counterparty: 'IFOOD' };
  }
  for (const tok of INTERNAL_TOKENS) {
    if (n.includes(tok)) return { is_internal_transfer: true, counterparty: tok };
  }
  const m = txt.match(/Pix\s+(?:enviado\s+para|recebido(?:\s+c6)?\s+de)\s+(.+)/i);
  return { is_internal_transfer: false, counterparty: m ? m[1].trim().slice(0, 200) : null };
}

async function pluggyAuth(clientId: string, clientSecret: string): Promise<string> {
  const r = await fetch(`${PLUGGY}/auth`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ clientId, clientSecret }),
  });
  if (!r.ok) throw new Error(`Pluggy /auth ${r.status}: ${await r.text()}`);
  const { apiKey } = await r.json();
  return apiKey;
}

async function pgetJson(apiKey: string, path: string): Promise<any> {
  const r = await fetch(`${PLUGGY}${path}`, { headers: { 'X-API-KEY': apiKey } });
  if (!r.ok) throw new Error(`Pluggy GET ${path} ${r.status}: ${await r.text()}`);
  return r.json();
}

function isoDate(d: Date) { return d.toISOString().slice(0, 10); }

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  try {
    const clientId = Deno.env.get('PLUGGY_CLIENT_ID');
    const clientSecret = Deno.env.get('PLUGGY_CLIENT_SECRET');
    const supaUrl = Deno.env.get('SUPABASE_URL')!;
    const supaKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    if (!clientId || !clientSecret) {
      return new Response(JSON.stringify({ error: 'Credenciais Pluggy não configuradas.' }),
        { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
    }
    const supa = createClient(supaUrl, supaKey);

    let filterItemId: string | undefined;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body?.itemId && typeof body.itemId === 'string') filterItemId = body.itemId;
      } catch { /* body opcional */ }
    }

    const apiKey = await pluggyAuth(clientId, clientSecret);

    // 1. carrega itens
    let itemsQ = supa.from('pluggy_items').select('id,item_id,connector_name');
    if (filterItemId) itemsQ = itemsQ.eq('item_id', filterItemId);
    const { data: items, error: itemsErr } = await itemsQ;
    if (itemsErr) throw new Error(itemsErr.message);

    const today = new Date();
    const from = new Date(today.getTime() - DAYS_BACK * 24 * 3600 * 1000);
    const fromStr = isoDate(from);
    const toStr = isoDate(today);

    const summary: any[] = [];
    const unlinked: any[] = [];

    for (const it of items ?? []) {
      const itemSummary: any = { item_id: it.item_id, connector: it.connector_name, accounts: [] };

      // status do item
      try {
        const itemInfo = await pgetJson(apiKey, `/items/${it.item_id}`);
        if (itemInfo?.status) {
          await supa.from('pluggy_items').update({ status: itemInfo.status }).eq('item_id', it.item_id);
        }
      } catch (e) { console.warn('item info falhou', e); }

      // contas
      const accResp = await pgetJson(apiKey, `/accounts?itemId=${it.item_id}`);
      const pluggyAccounts: any[] = accResp?.results ?? [];

      for (const pa of pluggyAccounts) {
        // upsert pluggy_accounts (preserva cashflow_account_id existente)
        const { data: existing } = await supa.from('pluggy_accounts')
          .select('id, cashflow_account_id')
          .eq('pluggy_account_id', pa.id).maybeSingle();
        const cfAccountId = existing?.cashflow_account_id ?? null;

        // Se vinculada, carrega âncora de saldo da cashflow_accounts
        let balanceAnchor: number | null = null;
        let balanceAnchorDate: string | null = null;
        if (cfAccountId) {
          const { data: cfAcc } = await supa.from('cashflow_accounts')
            .select('balance_anchor, balance_anchor_date')
            .eq('id', cfAccountId).maybeSingle();
          balanceAnchor = cfAcc?.balance_anchor ?? null;
          balanceAnchorDate = cfAcc?.balance_anchor_date ?? null;
        }
        const hasAnchor = balanceAnchor !== null && balanceAnchorDate !== null;

        const upsertRow = {
          pluggy_account_id: String(pa.id),
          item_id: it.item_id,
          name: pa.name ?? null,
          type: pa.type ?? null,
          subtype: pa.subtype ?? null,
          number: pa.number ?? null,
          balance: typeof pa.balance === 'number' ? pa.balance : null,
          currency: pa.currencyCode ?? pa.currency ?? null,
          last_synced_at: new Date().toISOString(),
          ...(cfAccountId ? { cashflow_account_id: cfAccountId } : {}),
        };
        await supa.from('pluggy_accounts').upsert(upsertRow, { onConflict: 'pluggy_account_id' });

        if (!cfAccountId) {
          unlinked.push({ pluggy_account_id: pa.id, name: pa.name, number: pa.number });
          itemSummary.accounts.push({ pluggy_account_id: pa.id, name: pa.name, linked: false });
          continue;
        }

        // saldo do dia — SEM âncora: usa balance da Pluggy (antes das tx, resiliente a falhas)
        // COM âncora: será calculado DEPOIS das transações (rollforward)
        if (!hasAnchor && typeof pa.balance === 'number') {
          try {
            await supa.from('cashflow_balances').upsert({
              account_id: cfAccountId,
              as_of: toStr,
              own_balance: pa.balance,
            }, { onConflict: 'account_id,as_of' });
          } catch (e) {
            console.warn('upsert cashflow_balances falhou', e);
          }
        }

        // transações via /v2/transactions com cursor — isolado por conta; erro NÃO derruba o sync
        let inserted = 0;
        let accountError: string | null = null;
        try {
          // primeira página
          let path: string | null =
            `/v2/transactions?accountId=${pa.id}&dateFrom=${fromStr}&dateTo=${toStr}`;
          const seen = new Set<string>();
          while (path) {
            if (seen.has(path)) break; // defensivo: evita loop
            seen.add(path);

            const tResp = await pgetJson(apiKey, path);
            const results: any[] = tResp?.results ?? [];

            if (results.length) {
              const rows = results.map((tx) => {
                const desc = tx.description ?? tx.descriptionRaw ?? null;
                const detail = tx.descriptionRaw && tx.descriptionRaw !== desc
                  ? tx.descriptionRaw
                  : (tx.category ?? null);
                const it2 = detectInternalTransfer(desc, detail);
                const rawDate = tx.date ?? tx.createdAt ?? null;
                const dateStr = rawDate
                  ? (typeof rawDate === 'string' ? rawDate : new Date(rawDate).toISOString()).slice(0, 10)
                  : toStr;
                return {
                  source: 'pluggy',
                  account_id: cfAccountId,
                  tx_date: dateStr,
                  description: desc,
                  detail,
                  amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount ?? 0),
                  running_balance: typeof tx.balance === 'number' ? tx.balance : null,
                  category: tx.category ?? null,
                  is_internal_transfer: it2.is_internal_transfer,
                  counterparty: it2.counterparty,
                  external_id: String(tx.id),
                  source_seq: 0,
                };
              });

              const { error: upErr } = await supa
                .from('cashflow_transactions')
                .upsert(rows, { onConflict: 'account_id,external_id', ignoreDuplicates: false });
              if (upErr) throw new Error(`Erro ao gravar transações: ${upErr.message}`);
              inserted += rows.length;
            }

            // próxima página: campo `next` vem como querystring "?accountId=...&after=..."
            const next = typeof tResp?.next === 'string' ? tResp.next.trim() : '';
            path = next ? `/v2/transactions${next.startsWith('?') ? next : `?${next}`}` : null;
          }
        } catch (e) {
          accountError = e instanceof Error ? e.message : String(e);
          console.error(`conta ${pa.id} (${pa.name}) falhou:`, accountError);
        }

        // COM âncora: calcula saldo = anchor + sum(amount das tx pluggy > anchor_date)
        let anchoredBalance: number | null = null;
        if (hasAnchor) {
          try {
            const { data: txSum, error: sumErr } = await supa
              .from('cashflow_transactions')
              .select('amount')
              .eq('account_id', cfAccountId)
              .eq('source', 'pluggy')
              .gt('tx_date', balanceAnchorDate!);
            if (sumErr) throw new Error(sumErr.message);
            const soma = (txSum ?? []).reduce((s: number, r: any) => s + Number(r.amount ?? 0), 0);
            anchoredBalance = Number(balanceAnchor) + soma;
            await supa.from('cashflow_balances').upsert({
              account_id: cfAccountId,
              as_of: toStr,
              own_balance: anchoredBalance,
            }, { onConflict: 'account_id,as_of' });
          } catch (e) {
            console.warn('anchored balance falhou', e);
          }
        }


        itemSummary.accounts.push({
          pluggy_account_id: pa.id,
          name: pa.name,
          linked: true,
          balance: pa.balance,
          transactions_upserted: inserted,
          ...(accountError ? { error: accountError } : {}),
        });
      }

      summary.push(itemSummary);
    }

    return new Response(JSON.stringify({
      ok: true,
      items: summary,
      unlinked_accounts: unlinked,
      window: { from: fromStr, to: toStr },
    }), { status: 200, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  } catch (e) {
    console.error('pluggy-sync erro:', e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } },
    );
  }
});
