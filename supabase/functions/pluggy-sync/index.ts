// pluggy-sync — dispara update (PATCH), aguarda coleta e sincroniza Pluggy → cashflow_*
// Idempotente via (account_id, external_id).
import { corsHeaders } from 'npm:@supabase/supabase-js@2/cors';
import { createClient } from 'npm:@supabase/supabase-js@2';

const PLUGGY = 'https://api.pluggy.ai';
const DAYS_BACK = 90;
const POLL_INTERVAL_MS = 3000;
const POLL_TIMEOUT_MS = 75_000;

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

/**
 * Dispara PATCH /items/{id} pedindo update com credenciais armazenadas.
 * Retorna { ok, status, body } — não lança, pra não derrubar os outros itens.
 */
async function pluggyPatchItem(apiKey: string, itemId: string): Promise<{ ok: boolean; status: number; body: any }> {
  const r = await fetch(`${PLUGGY}/items/${itemId}`, {
    method: 'PATCH',
    headers: { 'X-API-KEY': apiKey, 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  const text = await r.text();
  let body: any = text;
  try { body = JSON.parse(text); } catch { /* mantém texto */ }
  return { ok: r.ok, status: r.status, body };
}

const TERMINAL_STATUSES = new Set([
  'UPDATED',
  'LOGIN_ERROR',
  'WAITING_USER_INPUT',
  'OUTDATED',
  'ERROR',
]);

async function pollItemUntilDone(apiKey: string, itemId: string): Promise<{ status: string; lastUpdatedAt: string | null; timedOut: boolean; executionStatus: string | null; }> {
  const started = Date.now();
  let last: any = null;
  while (Date.now() - started < POLL_TIMEOUT_MS) {
    try {
      last = await pgetJson(apiKey, `/items/${itemId}`);
    } catch (e) {
      // erro transitório: espera e tenta de novo
      await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
      continue;
    }
    const st = String(last?.status ?? '');
    if (st && st !== 'UPDATING' && (TERMINAL_STATUSES.has(st) || st !== 'UPDATING')) {
      if (TERMINAL_STATUSES.has(st)) {
        return {
          status: st,
          lastUpdatedAt: last?.lastUpdatedAt ?? null,
          timedOut: false,
          executionStatus: last?.executionStatus ?? null,
        };
      }
    }
    await new Promise((r) => setTimeout(r, POLL_INTERVAL_MS));
  }
  return {
    status: String(last?.status ?? 'UNKNOWN'),
    lastUpdatedAt: last?.lastUpdatedAt ?? null,
    timedOut: true,
    executionStatus: last?.executionStatus ?? null,
  };
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
    let skipTrigger = false;
    if (req.method === 'POST') {
      try {
        const body = await req.json();
        if (body?.itemId && typeof body.itemId === 'string') filterItemId = body.itemId;
        if (body?.skipTrigger === true) skipTrigger = true;
      } catch { /* body opcional */ }
    }

    const apiKey = await pluggyAuth(clientId, clientSecret);

    // 1. carrega itens
    let itemsQ = supa.from('pluggy_items').select('id,item_id,connector_name');
    if (filterItemId) itemsQ = itemsQ.eq('item_id', filterItemId);
    const { data: items, error: itemsErr } = await itemsQ;
    if (itemsErr) throw new Error(itemsErr.message);

    // 2. FASE TRIGGER — PATCH em paralelo pra todos os itens
    const triggerResults = new Map<string, { patchOk: boolean; patchStatus: number; patchError: string | null }>();
    if (!skipTrigger) {
      await Promise.all((items ?? []).map(async (it) => {
        const res = await pluggyPatchItem(apiKey, it.item_id);
        let patchError: string | null = null;
        if (!res.ok) {
          const msg = typeof res.body === 'string'
            ? res.body
            : (res.body?.message ?? res.body?.error ?? JSON.stringify(res.body));
          patchError = `PATCH ${res.status}: ${msg}`;
        }
        triggerResults.set(it.item_id, { patchOk: res.ok, patchStatus: res.status, patchError });
      }));
    }

    // 3. FASE POLLING — em paralelo pra todos os itens
    const pollResults = new Map<string, { status: string; lastUpdatedAt: string | null; timedOut: boolean; executionStatus: string | null }>();
    await Promise.all((items ?? []).map(async (it) => {
      const trig = triggerResults.get(it.item_id);
      // Se o PATCH falhou por permissão/plano, não adianta polling — só lê o estado atual
      if (trig && !trig.patchOk) {
        try {
          const info = await pgetJson(apiKey, `/items/${it.item_id}`);
          pollResults.set(it.item_id, {
            status: String(info?.status ?? 'UNKNOWN'),
            lastUpdatedAt: info?.lastUpdatedAt ?? null,
            timedOut: false,
            executionStatus: info?.executionStatus ?? null,
          });
        } catch {
          pollResults.set(it.item_id, { status: 'UNKNOWN', lastUpdatedAt: null, timedOut: false, executionStatus: null });
        }
        return;
      }
      const r = await pollItemUntilDone(apiKey, it.item_id);
      pollResults.set(it.item_id, r);
    }));

    const today = new Date();
    const from = new Date(today.getTime() - DAYS_BACK * 24 * 3600 * 1000);
    const fromStr = isoDate(from);
    const toStr = isoDate(today);

    const summary: any[] = [];
    const unlinked: any[] = [];

    // 4. Persistência + leitura de accounts/transactions
    for (const it of items ?? []) {
      const trig = triggerResults.get(it.item_id);
      const poll = pollResults.get(it.item_id);
      const itemSummary: any = {
        item_id: it.item_id,
        connector: it.connector_name,
        patch: trig ? { ok: trig.patchOk, http_status: trig.patchStatus, error: trig.patchError } : { skipped: true },
        final_status: poll?.status ?? null,
        last_updated_at: poll?.lastUpdatedAt ?? null,
        polling_timed_out: poll?.timedOut ?? false,
        execution_status: poll?.executionStatus ?? null,
        accounts: [] as any[],
      };

      // hint amigável
      if (poll?.status === 'LOGIN_ERROR' || poll?.status === 'WAITING_USER_INPUT') {
        itemSummary.action_required = `Reconectar/reautorizar ${it.connector_name} no widget Open Finance.`;
      }

      const statusMsg = trig?.patchError
        ?? (poll?.status === 'LOGIN_ERROR' ? 'LOGIN_ERROR: reautorizar Open Finance'
        : poll?.status === 'WAITING_USER_INPUT' ? 'WAITING_USER_INPUT: reautorizar Open Finance'
        : poll?.timedOut ? 'timeout no update (leu parcial)'
        : null);

      // grava status + last_updated_at
      try {
        await supa.from('pluggy_items').update({
          status: poll?.status ?? null,
          last_updated_at: poll?.lastUpdatedAt ?? null,
          last_status_message: statusMsg,
        }).eq('item_id', it.item_id);
      } catch (e) { console.warn('update pluggy_items falhou', e); }

      // contas
      let pluggyAccounts: any[] = [];
      try {
        const accResp = await pgetJson(apiKey, `/accounts?itemId=${it.item_id}`);
        pluggyAccounts = accResp?.results ?? [];
      } catch (e) {
        itemSummary.accounts_error = e instanceof Error ? e.message : String(e);
        summary.push(itemSummary);
        continue;
      }

      for (const pa of pluggyAccounts) {
        // upsert pluggy_accounts (preserva cashflow_account_id existente)
        const { data: existing } = await supa.from('pluggy_accounts')
          .select('id, cashflow_account_id')
          .eq('pluggy_account_id', pa.id).maybeSingle();
        const cfAccountId = existing?.cashflow_account_id ?? null;

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

        // last_synced_at = hora REAL da coleta na Pluggy (não hora da edge)
        const realCollectAt = poll?.lastUpdatedAt ?? new Date().toISOString();

        const upsertRow = {
          pluggy_account_id: String(pa.id),
          item_id: it.item_id,
          name: pa.name ?? null,
          type: pa.type ?? null,
          subtype: pa.subtype ?? null,
          number: pa.number ?? null,
          balance: typeof pa.balance === 'number' ? pa.balance : null,
          currency: pa.currencyCode ?? pa.currency ?? null,
          last_synced_at: realCollectAt,
          ...(cfAccountId ? { cashflow_account_id: cfAccountId } : {}),
        };
        await supa.from('pluggy_accounts').upsert(upsertRow, { onConflict: 'pluggy_account_id' });

        if (!cfAccountId) {
          unlinked.push({ pluggy_account_id: pa.id, name: pa.name, number: pa.number });
          itemSummary.accounts.push({ pluggy_account_id: pa.id, name: pa.name, linked: false });
          continue;
        }

        let inserted = 0;
        let accountError: string | null = null;
        try {
          let path: string | null =
            `/v2/transactions?accountId=${pa.id}&dateFrom=${fromStr}&dateTo=${toStr}`;
          const seen = new Set<string>();
          while (path) {
            if (seen.has(path)) break;
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
                const rawBal = tx.balance;
                const runBal = rawBal === null || rawBal === undefined || rawBal === ''
                  ? null
                  : (Number.isFinite(Number(rawBal)) ? Number(rawBal) : null);
                return {
                  source: 'pluggy',
                  account_id: cfAccountId,
                  tx_date: dateStr,
                  description: desc,
                  detail,
                  amount: typeof tx.amount === 'number' ? tx.amount : Number(tx.amount ?? 0),
                  running_balance: runBal,
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

            const next = typeof tResp?.next === 'string' ? tResp.next.trim() : '';
            path = next ? `/v2/transactions${next.startsWith('?') ? next : `?${next}`}` : null;
          }
        } catch (e) {
          accountError = e instanceof Error ? e.message : String(e);
          console.error(`conta ${pa.id} (${pa.name}) falhou:`, accountError);
        }

        let chosenBalance: number | null = null;
        let balanceSource: 'anchor' | 'account_balance' | 'none' = 'none';

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
            chosenBalance = Number(balanceAnchor) + soma;
            balanceSource = 'anchor';
          } catch (e) {
            console.warn('anchored balance falhou', e);
          }
        }

        if (chosenBalance === null && typeof pa.balance === 'number') {
          chosenBalance = pa.balance;
          balanceSource = 'account_balance';
        }

        if (chosenBalance !== null) {
          try {
            await supa.from('cashflow_balances').upsert({
              account_id: cfAccountId,
              as_of: toStr,
              own_balance: chosenBalance,
            }, { onConflict: 'account_id,as_of' });
          } catch (e) {
            console.warn('upsert cashflow_balances falhou', e);
          }
        }

        itemSummary.accounts.push({
          pluggy_account_id: pa.id,
          name: pa.name,
          linked: true,
          balance: chosenBalance,
          balance_source: balanceSource,
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
