import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, Play, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';

interface Campaign {
  id: string;
  name: string;
  kind: 'satisfaction' | 'reactivation' | 'custom';
  assistant_sofia_id: number;
  status: string;
  default_variables: Record<string, any>;
  estimated_minutes_per_call: number;
  notes: string | null;
  created_at: string;
}

interface Assistant {
  sofia_id: number;
  name: string;
  type: string;
}

export default function SofiaCampanhas() {
  const [campaigns, setCampaigns] = useState<Campaign[]>([]);
  const [assistants, setAssistants] = useState<Assistant[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [selected, setSelected] = useState<Campaign | null>(null);

  useEffect(() => {
    loadAll();
  }, []);

  async function loadAll() {
    setLoading(true);
    const [campRes, asstRes] = await Promise.all([
      supabase.from('sofia_campaigns').select('*').order('created_at', { ascending: false }),
      supabase.from('sofia_assistants').select('sofia_id, name, type').order('name'),
    ]);
    setCampaigns((campRes.data ?? []) as Campaign[]);
    setAssistants((asstRes.data ?? []) as Assistant[]);
    setLoading(false);
  }

  const kindLabel = (k: string) => ({ satisfaction: 'Satisfação', reactivation: 'Reativação', custom: 'Personalizada' }[k] ?? k);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Campanhas outbound — pesquisa de satisfação, reativação de clientes, etc.
        </p>
        <Button onClick={() => setCreateOpen(true)} size="sm">
          <Plus className="h-4 w-4 mr-2" /> Nova campanha
        </Button>
      </div>

      <div className="border rounded-lg overflow-hidden">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nome</TableHead>
              <TableHead>Tipo</TableHead>
              <TableHead>Assistente</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Criada em</TableHead>
              <TableHead></TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
            ) : campaigns.length === 0 ? (
              <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground">Nenhuma campanha. Crie a primeira.</TableCell></TableRow>
            ) : campaigns.map((c) => {
              const a = assistants.find((x) => x.sofia_id === c.assistant_sofia_id);
              return (
                <TableRow key={c.id} className="cursor-pointer hover:bg-muted/50" onClick={() => setSelected(c)}>
                  <TableCell className="font-medium">{c.name}</TableCell>
                  <TableCell>{kindLabel(c.kind)}</TableCell>
                  <TableCell>{a?.name ?? `#${c.assistant_sofia_id}`}</TableCell>
                  <TableCell><Badge variant={c.status === 'running' ? 'default' : 'secondary'}>{c.status}</Badge></TableCell>
                  <TableCell className="text-xs text-muted-foreground">{new Date(c.created_at).toLocaleDateString('pt-BR')}</TableCell>
                  <TableCell><Button size="sm" variant="ghost">Gerenciar</Button></TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </div>

      <CreateCampaignDialog open={createOpen} onClose={() => setCreateOpen(false)} assistants={assistants} onCreated={loadAll} />
      <CampaignDetailDialog campaign={selected} onClose={() => setSelected(null)} onChanged={loadAll} />
    </div>
  );
}

function CreateCampaignDialog({ open, onClose, assistants, onCreated }: { open: boolean; onClose: () => void; assistants: Assistant[]; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<'satisfaction' | 'reactivation' | 'custom'>('satisfaction');
  const [assistantId, setAssistantId] = useState<string>('');
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name || !assistantId) {
      toast.error('Preencha nome e assistente');
      return;
    }
    setSaving(true);
    const { data: userData } = await supabase.auth.getUser();
    const { error } = await supabase.from('sofia_campaigns').insert({
      name,
      kind,
      assistant_sofia_id: Number(assistantId),
      notes: notes || null,
      created_by: userData?.user?.id ?? null,
    });
    if (error) {
      toast.error('Erro: ' + error.message);
    } else {
      toast.success('Campanha criada');
      setName(''); setNotes(''); setAssistantId('');
      onClose();
      onCreated();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova campanha</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Pesquisa de satisfação · Maio/26" />
          </div>
          <div>
            <Label>Tipo</Label>
            <Select value={kind} onValueChange={(v) => setKind(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="satisfaction">Pesquisa de satisfação</SelectItem>
                <SelectItem value="reactivation">Reativação de inativos</SelectItem>
                <SelectItem value="custom">Personalizada</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Assistente</Label>
            <Select value={assistantId} onValueChange={setAssistantId}>
              <SelectTrigger><SelectValue placeholder="Selecione um assistente" /></SelectTrigger>
              <SelectContent>
                {assistants.map((a) => (
                  <SelectItem key={a.sofia_id} value={String(a.sofia_id)}>{a.name} · {a.type}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label>Notas (opcional)</Label>
            <Textarea value={notes} onChange={(e) => setNotes(e.target.value)} rows={3} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Salvando...' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function CampaignDetailDialog({ campaign, onClose, onChanged }: { campaign: Campaign | null; onClose: () => void; onChanged: () => void }) {
  const [targets, setTargets] = useState<any[]>([]);
  const [csvText, setCsvText] = useState('');
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (campaign) loadTargets();
  }, [campaign?.id]);

  async function loadTargets() {
    if (!campaign) return;
    const { data } = await supabase
      .from('sofia_campaign_targets')
      .select('*')
      .eq('campaign_id', campaign.id)
      .order('created_at', { ascending: false })
      .limit(500);
    setTargets(data ?? []);
  }

  async function uploadCsv() {
    if (!campaign || !csvText.trim()) return;
    // CSV simples: phone,name (header opcional). Variáveis extras viram colunas JSON.
    const lines = csvText.trim().split(/\r?\n/);
    const header = lines[0].toLowerCase().split(',').map((s) => s.trim());
    const hasHeader = header.includes('phone') || header.includes('telefone');
    const dataLines = hasHeader ? lines.slice(1) : lines;
    const cols = hasHeader ? header : ['phone', 'name'];

    const rows = dataLines.map((line) => {
      const parts = line.split(',').map((s) => s.trim());
      const obj: Record<string, string> = {};
      cols.forEach((c, i) => { obj[c] = parts[i] ?? ''; });
      const phone = obj.phone || obj.telefone || '';
      const name = obj.name || obj.nome || obj.customer_name || null;
      const variables: Record<string, string> = {};
      for (const [k, v] of Object.entries(obj)) {
        if (!['phone', 'telefone', 'name', 'nome', 'customer_name'].includes(k) && v) variables[k] = v;
      }
      return { campaign_id: campaign.id, phone, customer_name: name, variables };
    }).filter((r) => r.phone);

    if (rows.length === 0) {
      toast.error('Nenhuma linha válida no CSV');
      return;
    }

    const { error } = await supabase.from('sofia_campaign_targets').insert(rows);
    if (error) {
      toast.error('Erro: ' + error.message);
    } else {
      toast.success(`${rows.length} contatos adicionados`);
      setCsvText('');
      loadTargets();
    }
  }

  async function dialAll() {
    if (!campaign) return;
    const pending = targets.filter((t) => t.status === 'pending');
    if (pending.length === 0) {
      toast.error('Nenhum target pendente');
      return;
    }
    const estimatedCost = pending.length * (campaign.estimated_minutes_per_call ?? 3) * 0.50;
    if (!confirm(`Disparar ${pending.length} chamadas? Custo estimado: ~R$ ${estimatedCost.toFixed(2)}`)) return;

    setRunning(true);
    let ok = 0, fail = 0;
    for (const t of pending.slice(0, 50)) { // limite seguro de 50 por vez
      const { error } = await supabase.functions.invoke('sofia-make-call', {
        body: {
          assistant_sofia_id: campaign.assistant_sofia_id,
          phone_number: t.phone,
          variables: { ...(campaign.default_variables ?? {}), ...t.variables, nome_cliente: t.customer_name ?? '' },
          campaign_id: campaign.id,
          target_id: t.id,
        },
      });
      if (error) fail++; else ok++;
      // pequeno delay pra evitar rate limit
      await new Promise((r) => setTimeout(r, 1500));
    }
    toast.success(`${ok} disparadas, ${fail} falhas`);
    setRunning(false);
    loadTargets();
  }

  async function deleteCampaign() {
    if (!campaign) return;
    if (!confirm(`Excluir campanha "${campaign.name}"? Todos os targets também serão removidos.`)) return;
    await supabase.from('sofia_campaigns').delete().eq('id', campaign.id);
    toast.success('Campanha excluída');
    onClose();
    onChanged();
  }

  if (!campaign) return null;
  const counts = {
    pending: targets.filter((t) => t.status === 'pending').length,
    dialing: targets.filter((t) => t.status === 'dialing').length,
    completed: targets.filter((t) => t.status === 'completed').length,
    failed: targets.filter((t) => t.status === 'failed').length,
  };

  return (
    <Dialog open={!!campaign} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{campaign.name}</DialogTitle></DialogHeader>

        <div className="flex gap-4 text-sm">
          <span><Badge variant="secondary">Pendentes: {counts.pending}</Badge></span>
          <span><Badge>Em andamento: {counts.dialing}</Badge></span>
          <span><Badge variant="default">Concluídas: {counts.completed}</Badge></span>
          <span><Badge variant="destructive">Falhas: {counts.failed}</Badge></span>
        </div>

        <div className="mt-3">
          <Label>Adicionar contatos via CSV</Label>
          <Textarea
            placeholder="phone,name,nome_cliente,endereço_cliente&#10;+5548999999999,João da Silva,João,Rua X 123"
            value={csvText}
            onChange={(e) => setCsvText(e.target.value)}
            rows={5}
            className="font-mono text-xs"
          />
          <Button size="sm" onClick={uploadCsv} className="mt-2">
            <Upload className="h-4 w-4 mr-2" /> Importar CSV
          </Button>
        </div>

        <div className="mt-3 flex gap-2">
          <Button onClick={dialAll} disabled={running || counts.pending === 0}>
            <Play className="h-4 w-4 mr-2" /> {running ? 'Disparando...' : `Disparar pendentes (${counts.pending})`}
          </Button>
          <Button variant="destructive" size="sm" onClick={deleteCampaign}>
            <Trash2 className="h-4 w-4 mr-2" /> Excluir campanha
          </Button>
        </div>

        <div className="mt-3 max-h-64 overflow-y-auto border rounded">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Telefone</TableHead>
                <TableHead>Nome</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Tentativas</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {targets.slice(0, 100).map((t) => (
                <TableRow key={t.id}>
                  <TableCell className="font-mono-tabular">{t.phone}</TableCell>
                  <TableCell>{t.customer_name ?? '—'}</TableCell>
                  <TableCell><Badge variant="secondary">{t.status}</Badge></TableCell>
                  <TableCell>{t.attempts}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </DialogContent>
    </Dialog>
  );
}
