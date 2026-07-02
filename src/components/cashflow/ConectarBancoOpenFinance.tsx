import { useCallback, useEffect, useState } from 'react';
import { PluggyConnect } from 'react-pluggy-connect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import { Landmark, Loader2, Plus, RefreshCw } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';

type PluggyItem = {
  id: string;
  item_id: string;
  connector_id: number | null;
  connector_name: string | null;
  status: string | null;
  company: string | null;
  created_at: string;
};

type PluggyAccount = {
  id: string;
  pluggy_account_id: string;
  item_id: string;
  name: string | null;
  type: string | null;
  subtype: string | null;
  number: string | null;
  balance: number | null;
  currency: string | null;
  cashflow_account_id: string | null;
  last_synced_at: string | null;
};

type CashflowAccount = {
  id: string;
  name: string;
  bank: string | null;
  company: string;
};

const brl = (v: number | null) =>
  v == null ? '—' : v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function fmtDate(iso: string | null) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ConectarBancoOpenFinance() {
  const [items, setItems] = useState<PluggyItem[]>([]);
  const [accounts, setAccounts] = useState<PluggyAccount[]>([]);
  const [cfAccounts, setCfAccounts] = useState<CashflowAccount[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const loadAll = useCallback(async () => {
    setLoading(true);
    const [{ data: it }, { data: pa }, { data: ca }] = await Promise.all([
      supabase.from('pluggy_items')
        .select('id,item_id,connector_id,connector_name,status,company,created_at')
        .order('created_at', { ascending: false }),
      supabase.from('pluggy_accounts')
        .select('id,pluggy_account_id,item_id,name,type,subtype,number,balance,currency,cashflow_account_id,last_synced_at')
        .order('name', { ascending: true }),
      supabase.from('cashflow_accounts')
        .select('id,name,bank,company')
        .eq('active', true)
        .order('name', { ascending: true }),
    ]);
    setLoading(false);
    setItems((it ?? []) as PluggyItem[]);
    setAccounts((pa ?? []) as PluggyAccount[]);
    setCfAccounts((ca ?? []) as CashflowAccount[]);
  }, []);

  useEffect(() => { loadAll(); }, [loadAll]);

  const handleOpen = useCallback(async () => {
    setOpening(true);
    try {
      const { data, error } = await supabase.functions.invoke('pluggy-connect-token', { body: {} });
      if (error) throw new Error(error.message);
      const token = (data as { accessToken?: string } | null)?.accessToken;
      if (!token) throw new Error('Token não recebido.');
      setAccessToken(token);
    } catch (e) {
      console.error(e);
      toast.error('Não foi possível iniciar a conexão. Tente de novo.');
    } finally {
      setOpening(false);
    }
  }, []);

  const handleSuccess = useCallback(async (itemData: any) => {
    try {
      const item = itemData?.item ?? {};
      const connector = item?.connector ?? {};
      const payload = {
        item_id: String(item.id),
        connector_id: typeof connector.id === 'number' ? connector.id : null,
        connector_name: connector.name ?? null,
        status: item.status ?? null,
      };
      const { error } = await supabase.from('pluggy_items').upsert(payload, { onConflict: 'item_id' });
      if (error) throw new Error(error.message);
      toast.success('Banco conectado!');
      setAccessToken(null);
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar conexão.');
    }
  }, [loadAll]);

  const handleError = useCallback((error: any) => {
    console.error('PluggyConnect erro:', error);
    toast.error('Não foi possível conectar. Tente de novo.');
  }, []);

  const handleClose = useCallback(() => setAccessToken(null), []);

  const handleLink = useCallback(async (pluggyRowId: string, cfAccountId: string | null) => {
    const { error } = await supabase.from('pluggy_accounts')
      .update({ cashflow_account_id: cfAccountId })
      .eq('id', pluggyRowId);
    if (error) { toast.error(`Vincular: ${error.message}`); return; }
    toast.success(cfAccountId ? 'Conta vinculada.' : 'Vínculo removido.');
    await loadAll();
  }, [loadAll]);

  const handleSync = useCallback(async () => {
    setSyncing(true);
    try {
      const { data, error } = await supabase.functions.invoke('pluggy-sync', { body: {} });
      if (error) throw new Error(error.message);
      const d = data as any;
      const totalTx = (d?.items ?? []).reduce((s: number, it: any) =>
        s + (it.accounts ?? []).reduce((ss: number, a: any) => ss + (a.transactions_upserted ?? 0), 0), 0);
      const unlinked = d?.unlinked_accounts?.length ?? 0;
      toast.success(`Sync ok: ${totalTx} transações, ${unlinked} contas não vinculadas.`);
      await loadAll();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Erro no sync.');
    } finally {
      setSyncing(false);
    }
  }, [loadAll]);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 gap-2 flex-wrap">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Landmark className="h-5 w-5" />
          Conexões automáticas (Open Finance)
        </CardTitle>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleSync} disabled={syncing || accounts.length === 0}>
            {syncing ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <RefreshCw className="h-4 w-4 mr-2" />}
            Sincronizar agora
          </Button>
          <Button onClick={handleOpen} disabled={opening || !!accessToken}>
            {opening ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
            Conectar banco (Open Finance)
          </Button>
        </div>
      </CardHeader>
      <CardContent className="space-y-6">
        <p className="text-xs text-muted-foreground">
          As contas precisam estar vinculadas para o extrato entrar no fluxo de caixa.
          A sincronização automática diária será ligada depois da validação.
        </p>

        {/* Bancos conectados */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Bancos conectados</h4>
          {loading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
            </div>
          ) : items.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhum banco conectado ainda. Clique em <b>Conectar banco</b> para começar.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Banco</TableHead>
                    <TableHead>Item ID</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {items.map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="whitespace-nowrap text-sm">
                        {new Date(it.created_at).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' })}
                      </TableCell>
                      <TableCell className="text-sm">{it.connector_name ?? '—'}</TableCell>
                      <TableCell className="font-mono text-xs">{it.item_id}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className="uppercase">{it.status ?? '—'}</Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {/* Contas Pluggy → vínculo */}
        <div>
          <h4 className="text-sm font-semibold mb-2">Contas para vincular</h4>
          {accounts.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Nenhuma conta ainda. Ao conectar um banco e clicar em <b>Sincronizar agora</b>, as contas
              aparecem aqui para vincular a uma conta interna do fluxo de caixa.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Conta Pluggy</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Número</TableHead>
                    <TableHead className="text-right">Saldo</TableHead>
                    <TableHead>Último sync</TableHead>
                    <TableHead>Vínculo interno</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {accounts.map((a) => (
                    <TableRow key={a.id}>
                      <TableCell className="text-sm">{a.name ?? '—'}</TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {[a.type, a.subtype].filter(Boolean).join(' · ') || '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs">{a.number ?? '—'}</TableCell>
                      <TableCell className="text-right text-sm whitespace-nowrap">{brl(a.balance)}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap">{fmtDate(a.last_synced_at)}</TableCell>
                      <TableCell>
                        <Select
                          value={a.cashflow_account_id ?? 'none'}
                          onValueChange={(v) => handleLink(a.id, v === 'none' ? null : v)}
                        >
                          <SelectTrigger className="w-[220px]">
                            <SelectValue placeholder="Não vinculada" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— não vinculada —</SelectItem>
                            {cfAccounts.map((c) => (
                              <SelectItem key={c.id} value={c.id}>
                                {c.name} {c.company ? `(${c.company})` : ''}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </div>

        {accessToken && (
          <PluggyConnect
            connectToken={accessToken}
            includeSandbox={false}
            onSuccess={handleSuccess}
            onError={handleError}
            onClose={handleClose}
          />
        )}
      </CardContent>
    </Card>
  );
}
