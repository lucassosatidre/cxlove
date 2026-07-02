import { useCallback, useEffect, useState } from 'react';
import { PluggyConnect } from 'react-pluggy-connect';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Landmark, Loader2, Plus } from 'lucide-react';
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

function fmtDate(iso: string) {
  return new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

export default function ConectarBancoOpenFinance() {
  const [items, setItems] = useState<PluggyItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [opening, setOpening] = useState(false);
  const [accessToken, setAccessToken] = useState<string | null>(null);

  const loadItems = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase
      .from('pluggy_items')
      .select('id,item_id,connector_id,connector_name,status,company,created_at')
      .order('created_at', { ascending: false });
    setLoading(false);
    if (error) { toast.error(`Bancos conectados: ${error.message}`); return; }
    setItems((data ?? []) as PluggyItem[]);
  }, []);

  useEffect(() => { loadItems(); }, [loadItems]);

  const handleOpen = useCallback(async () => {
    setOpening(true);
    try {
      const { data, error } = await supabase.functions.invoke('pluggy-connect-token', {
        body: {},
      });
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
      await loadItems();
    } catch (e) {
      console.error(e);
      toast.error(e instanceof Error ? e.message : 'Erro ao salvar conexão.');
    }
  }, [loadItems]);

  const handleError = useCallback((error: any) => {
    console.error('PluggyConnect erro:', error);
    toast.error('Não foi possível conectar. Tente de novo.');
  }, []);

  const handleClose = useCallback(() => {
    setAccessToken(null);
  }, []);

  return (
    <Card className="border-border/60">
      <CardHeader className="flex flex-row items-center justify-between space-y-0">
        <CardTitle className="text-lg font-semibold flex items-center gap-2">
          <Landmark className="h-5 w-5" />
          Conexões automáticas (Open Finance)
        </CardTitle>
        <Button onClick={handleOpen} disabled={opening || !!accessToken}>
          {opening ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Plus className="h-4 w-4 mr-2" />}
          Conectar banco (Open Finance)
        </Button>
      </CardHeader>
      <CardContent>
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Carregando...
          </div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum banco conectado ainda. Clique em <b>Conectar banco</b> para começar (modo sandbox).
          </p>
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Data</TableHead>
                  <TableHead>Banco</TableHead>
                  <TableHead>Item ID</TableHead>
                  <TableHead>Empresa</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {items.map((it) => (
                  <TableRow key={it.id}>
                    <TableCell className="whitespace-nowrap text-sm">{fmtDate(it.created_at)}</TableCell>
                    <TableCell className="text-sm">{it.connector_name ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{it.item_id}</TableCell>
                    <TableCell className="text-sm">{it.company ?? '—'}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="uppercase">{it.status ?? '—'}</Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}

        {accessToken && (
          <PluggyConnect
            connectToken={accessToken}
            includeSandbox={true}
            onSuccess={handleSuccess}
            onError={handleError}
            onClose={handleClose}
          />
        )}
      </CardContent>
    </Card>
  );
}
