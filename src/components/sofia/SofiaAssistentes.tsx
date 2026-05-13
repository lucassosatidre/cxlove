import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, ExternalLink } from 'lucide-react';
import { toast } from 'sonner';

interface Assistant {
  id: string;
  sofia_id: number;
  name: string;
  type: string;
  status: string;
  voice_id: number | null;
  phone_number_id: number | null;
  webhook_url: string | null;
  inbound_webhook_url: string | null;
  post_call_evaluation: boolean;
  post_call_schema: any;
  synced_at: string;
}

export default function SofiaAssistentes() {
  const [items, setItems] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<Assistant | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('sofia_assistants')
      .select('*')
      .order('name');
    if (error) toast.error('Erro: ' + error.message);
    else setItems((data ?? []) as Assistant[]);
    setLoading(false);
  }

  async function sync() {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke('sofia-sync-assistants');
    if (error) toast.error('Falha: ' + error.message);
    else {
      toast.success(`${data?.synced ?? 0} assistentes sincronizados`);
      await load();
    }
    setSyncing(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Assistentes configurados na Sua SofIA. Edição é feita no painel oficial.
        </p>
        <div className="flex gap-2">
          <Button onClick={sync} disabled={syncing} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar
          </Button>
          <Button asChild size="sm" variant="ghost">
            <a href="https://suasofia.online/" target="_blank" rel="noreferrer">
              <ExternalLink className="h-4 w-4 mr-2" /> Painel Sofia
            </a>
          </Button>
        </div>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Número</TableHead>
              <TableHead>Webhook</TableHead>
              <TableHead>Schema</TableHead>
              <TableHead>Sync</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : items.length === 0 ? (
              <TableRow><TableCell colSpan={8} className="text-center text-muted-foreground">Nenhum assistente. Clique em Sincronizar.</TableCell></TableRow>
            ) : items.map((a) => (
              <TableRow key={a.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(a)}>
                <TableCell className="font-medium">{a.name}</TableCell>
                <TableCell><Badge variant="secondary">{a.type}</Badge></TableCell>
                <TableCell><Badge variant={a.status === 'active' ? 'default' : 'secondary'}>{a.status}</Badge></TableCell>
                <TableCell className="font-mono-tabular text-xs">{a.phone_number_id ?? '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]">{a.webhook_url ?? '—'}</TableCell>
                <TableCell>{Array.isArray(a.post_call_schema) ? `${a.post_call_schema.length} campos` : '—'}</TableCell>
                <TableCell className="text-xs text-muted-foreground">{new Date(a.synced_at).toLocaleString('pt-BR')}</TableCell>
                <TableCell><Button size="sm" variant="ghost">Ver</Button></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </div>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader><DialogTitle>{selected?.name}</DialogTitle></DialogHeader>
          {selected && (
            <div className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2">
                <div><span className="text-muted-foreground">Sofia ID:</span> {selected.sofia_id}</div>
                <div><span className="text-muted-foreground">Tipo:</span> {selected.type}</div>
                <div><span className="text-muted-foreground">Status:</span> {selected.status}</div>
                <div><span className="text-muted-foreground">Voz:</span> {selected.voice_id ?? '—'}</div>
              </div>
              <div>
                <p className="section-title mb-1">Webhook URL</p>
                <p className="font-mono text-xs break-all bg-muted/30 p-2 rounded">{selected.webhook_url ?? '— (não configurado)'}</p>
              </div>
              {Array.isArray(selected.post_call_schema) && selected.post_call_schema.length > 0 && (
                <div>
                  <p className="section-title mb-1">Campos extraídos pós-chamada</p>
                  <div className="space-y-1">
                    {selected.post_call_schema.map((f: any, i: number) => (
                      <div key={i} className="text-xs bg-muted/30 rounded p-2">
                        <span className="font-mono font-semibold">{f.name}</span>{' '}
                        <Badge variant="outline" className="ml-1">{f.type}</Badge>
                        <p className="text-muted-foreground mt-0.5">{f.description}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
