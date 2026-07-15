// Aba "Contas a Pagar (Saipos)" — lista lançamentos financeiros não pagos,
// sincronizados via edge function sync-saipos-financeiro.

import { useEffect, useState, useMemo, useCallback } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { RefreshCw, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

type FinTx = {
  id: string;
  id_store_fin_transaction: number;
  date: string | null;
  paid: string | null;
  amount: number | null;
  desc_store_fin_transaction: string | null;
  desc_store_category_financial: string | null;
  desc_store_payment_method: string | null;
  desc_store_bank_account: string | null;
  provider_trade_name: string | null;
  synced_at: string;
};

function fmtBRL(v: number | null | undefined) {
  const n = Number(v ?? 0);
  return n.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const [y, m, d] = v.split('-');
  return `${d}/${m}/${y}`;
}

function fmtDateTime(iso: string | null | undefined) {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('pt-BR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return '—';
  }
}

export default function ContasAPagarSaipos() {
  const [rows, setRows] = useState<FinTx[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [lastSyncStatus, setLastSyncStatus] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const from = new Date(today);
    from.setDate(from.getDate() - 30);
    const to = new Date(today);
    to.setDate(to.getDate() + 90);
    const toStr = (d: Date) => d.toISOString().slice(0, 10);

    const { data, error } = await (supabase as any)
      .from('saipos_fin_effective')
      .select('id,id_store_fin_transaction,date,paid,amount,desc_store_fin_transaction,desc_store_category_financial,desc_store_payment_method,desc_store_bank_account,provider_trade_name,synced_at')
      .neq('paid', 'Y')
      .gte('date', toStr(from))
      .lte('date', toStr(to))
      .order('date', { ascending: true })
      .limit(500);

    if (error) {
      console.error(error);
      toast.error('Erro ao carregar contas a pagar');
    } else {
      setRows((data as FinTx[]) || []);
      const latest = ((data as any[]) || []).reduce((acc: string | null, r: any) => {
        if (!acc || (r.synced_at && r.synced_at > acc)) return r.synced_at;
        return acc;
      }, null as string | null);
      setLastSyncAt(latest);
    }

    // Última entrada do sync_logs
    const { data: logs } = await supabase
      .from('sync_logs')
      .select('status,executed_at')
      .eq('sync_type', 'saipos_financeiro')
      .order('executed_at', { ascending: false })
      .limit(1);
    if (logs && logs.length > 0) {
      setLastSyncStatus(logs[0].status);
      setLastSyncAt((prev) => {
        const cand = logs[0].executed_at;
        if (!prev) return cand;
        return cand && cand > prev ? cand : prev;
      });
    }
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('sync-saipos-financeiro', { body: {} });
      if (error) throw error;
      toast.success(`Sincronizado: ${data?.total_upserted ?? 0} lançamentos`);
      await load();
    } catch (err: any) {
      console.error(err);
      toast.error(`Falha ao sincronizar: ${err?.message || err}`);
    } finally {
      setSyncing(false);
    }
  };

  const totalAPagar = useMemo(
    () => rows.filter(r => Number(r.amount ?? 0) < 0).reduce((s, r) => s + Math.abs(Number(r.amount ?? 0)), 0),
    [rows]
  );

  const hoje = new Date();
  hoje.setHours(0, 0, 0, 0);
  const isVencido = (d: string | null) => {
    if (!d) return false;
    return new Date(d + 'T00:00:00') < hoje;
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4">
        <div>
          <CardTitle>Contas a Pagar (Saipos)</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            Lançamentos financeiros não pagos, próximos 90 dias.
          </p>
          <p className="text-xs text-muted-foreground mt-1">
            Última sincronização: <span className="text-foreground/80">{fmtDateTime(lastSyncAt)}</span>
            {lastSyncStatus && lastSyncStatus !== 'success' && (
              <Badge variant="destructive" className="ml-2">{lastSyncStatus}</Badge>
            )}
          </p>
        </div>
        <Button onClick={handleSync} disabled={syncing} size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          {syncing ? 'Sincronizando…' : 'Sincronizar agora'}
        </Button>
      </CardHeader>
      <CardContent>
        <div className="mb-4 flex items-center gap-4 text-sm">
          <div className="text-foreground">
            <span className="text-foreground/70">Total a pagar:</span>{' '}
            <span className="font-semibold">{fmtBRL(totalAPagar)}</span>
          </div>
          <div className="text-foreground/70">{rows.length} lançamento(s)</div>
        </div>

        {loading ? (
          <div className="text-center py-8 text-muted-foreground">Carregando…</div>
        ) : rows.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            Nenhum lançamento em aberto. Clique em "Sincronizar agora" para buscar do Saipos.
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr className="text-left">
                  <th className="px-3 py-2 font-medium">Vencimento</th>
                  <th className="px-3 py-2 font-medium">Descrição</th>
                  <th className="px-3 py-2 font-medium">Categoria</th>
                  <th className="px-3 py-2 font-medium">Método</th>
                  <th className="px-3 py-2 font-medium">Fornecedor</th>
                  <th className="px-3 py-2 font-medium text-right">Valor</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const vencido = isVencido(r.date);
                  return (
                    <tr key={r.id} className="border-t border-border hover:bg-muted/30">
                      <td className="px-3 py-2 whitespace-nowrap">
                        <span className={vencido ? 'text-destructive font-medium inline-flex items-center gap-1' : 'text-foreground'}>
                          {vencido && <AlertCircle className="h-3 w-3" />}
                          {fmtDate(r.date)}
                        </span>
                      </td>
                      <td className="px-3 py-2">{r.desc_store_fin_transaction || '—'}</td>
                      <td className="px-3 py-2 text-foreground/80">{r.desc_store_category_financial || '—'}</td>
                      <td className="px-3 py-2 text-foreground/80">{r.desc_store_payment_method || '—'}</td>
                      <td className="px-3 py-2 text-foreground/80">{r.provider_trade_name || '—'}</td>
                      <td className="px-3 py-2 text-right font-mono whitespace-nowrap">
                        {fmtBRL(Math.abs(Number(r.amount ?? 0)))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
