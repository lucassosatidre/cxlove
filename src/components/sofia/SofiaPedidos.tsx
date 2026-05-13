import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { RefreshCw, Play } from 'lucide-react';
import { toast } from 'sonner';

interface Call {
  id: string;
  sofia_call_id: string | null;
  direction: 'inbound' | 'outbound';
  phone: string | null;
  customer_name: string | null;
  status: string;
  duration_sec: number | null;
  cost_minutes: number | null;
  recording_url: string | null;
  transcript: any;
  summary: string | null;
  extracted_data: any;
  started_at: string | null;
}

export default function SofiaPedidos() {
  const [calls, setCalls] = useState<Call[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [search, setSearch] = useState('');
  const [selected, setSelected] = useState<Call | null>(null);

  useEffect(() => {
    loadCalls();
  }, []);

  async function loadCalls() {
    setLoading(true);
    const { data, error } = await supabase
      .from('sofia_calls')
      .select('id, sofia_call_id, direction, phone, customer_name, status, duration_sec, cost_minutes, recording_url, transcript, summary, extracted_data, started_at')
      .order('started_at', { ascending: false })
      .limit(200);
    if (error) {
      toast.error('Erro ao carregar chamadas: ' + error.message);
    } else {
      setCalls((data ?? []) as Call[]);
    }
    setLoading(false);
  }

  async function syncFromSofia() {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke('sofia-sync-calls', {
      body: { max_pages: 20 },
    });
    if (error) {
      toast.error('Falha na sync: ' + error.message);
    } else {
      toast.success(`${data?.synced ?? 0} chamadas sincronizadas`);
      await loadCalls();
    }
    setSyncing(false);
  }

  const filtered = calls.filter((c) => {
    if (!search) return true;
    const s = search.toLowerCase();
    return (
      c.phone?.toLowerCase().includes(s) ||
      c.customer_name?.toLowerCase().includes(s) ||
      c.summary?.toLowerCase().includes(s)
    );
  });

  function fmtDuration(sec: number | null) {
    if (!sec) return '—';
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${m}:${String(s).padStart(2, '0')}`;
  }

  function statusBadge(s: string) {
    const variant = s === 'completed' ? 'default' : s === 'failed' ? 'destructive' : 'secondary';
    return <Badge variant={variant}>{s}</Badge>;
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Buscar por telefone, nome ou resumo..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="max-w-sm"
        />
        <Button onClick={syncFromSofia} disabled={syncing} variant="outline" size="sm">
          <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
          Sincronizar
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Data</TableHead>
              <TableHead>Direção</TableHead>
              <TableHead>Cliente</TableHead>
              <TableHead>Telefone</TableHead>
              <TableHead>Pedido?</TableHead>
              <TableHead>Valor</TableHead>
              <TableHead>Duração</TableHead>
              <TableHead>Status</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : filtered.length === 0 ? (
              <TableRow><TableCell colSpan={9} className="text-center text-muted-foreground">Nenhuma chamada. Clique em Sincronizar pra puxar da Sofia.</TableCell></TableRow>
            ) : filtered.map((c) => {
              const hasOrder = c.extracted_data?.status === true || c.extracted_data?.status === 'true';
              const valor = c.extracted_data?.valor;
              return (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(c)}>
                  <TableCell className="text-xs text-muted-foreground">
                    {c.started_at ? new Date(c.started_at).toLocaleString('pt-BR') : '—'}
                  </TableCell>
                  <TableCell>{c.direction}</TableCell>
                  <TableCell>{c.customer_name || c.extracted_data?.nome_cliente || '—'}</TableCell>
                  <TableCell className="font-mono-tabular">{c.phone || c.extracted_data?.telefone_cliente || '—'}</TableCell>
                  <TableCell>{hasOrder ? <Badge>Sim</Badge> : <Badge variant="secondary">Não</Badge>}</TableCell>
                  <TableCell className="font-mono-tabular">{valor || '—'}</TableCell>
                  <TableCell className="font-mono-tabular">{fmtDuration(c.duration_sec)}</TableCell>
                  <TableCell>{statusBadge(c.status)}</TableCell>
                  <TableCell><Button size="sm" variant="ghost">Detalhes</Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <CallDetailDialog call={selected} onClose={() => setSelected(null)} />
    </div>
  );
}

function CallDetailDialog({ call, onClose }: { call: Call | null; onClose: () => void }) {
  if (!call) return null;
  const transcript = Array.isArray(call.transcript) ? call.transcript : [];
  const extracted = call.extracted_data ?? {};

  return (
    <Dialog open={!!call} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[80vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Chamada · {call.customer_name || extracted.nome_cliente || call.phone || 'Anônimo'}</DialogTitle>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-2 text-sm">
          <div><span className="text-muted-foreground">Telefone:</span> {call.phone || extracted.telefone_cliente || '—'}</div>
          <div><span className="text-muted-foreground">Status:</span> {call.status}</div>
          <div><span className="text-muted-foreground">Duração:</span> {call.duration_sec}s</div>
          <div><span className="text-muted-foreground">Custo:</span> R$ {Number(call.cost_minutes ?? 0).toFixed(2)}</div>
        </div>

        {call.recording_url && (
          <div className="mt-2">
            <p className="section-title mb-1">Gravação</p>
            <audio controls src={call.recording_url} className="w-full" />
          </div>
        )}

        {Object.keys(extracted).length > 0 && (
          <div className="mt-3">
            <p className="section-title mb-2">Dados Extraídos</p>
            <div className="grid grid-cols-2 gap-1 text-sm bg-muted/30 rounded p-3">
              {Object.entries(extracted).map(([k, v]) => (
                <div key={k}>
                  <span className="text-muted-foreground">{k}:</span>{' '}
                  <span className="font-medium">{v === null ? '—' : String(v)}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {transcript.length > 0 && (
          <div className="mt-3">
            <p className="section-title mb-2">Transcrição</p>
            <div className="space-y-1.5 text-sm max-h-80 overflow-y-auto bg-muted/30 rounded p-3">
              {transcript.map((msg: any, i: number) => (
                <div key={i} className={msg.type === 'user' ? 'text-foreground' : 'text-muted-foreground'}>
                  <span className="font-semibold capitalize">{msg.type || 'msg'}:</span> {msg.text}
                </div>
              ))}
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
