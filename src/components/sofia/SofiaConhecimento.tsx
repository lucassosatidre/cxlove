import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/components/ui/dialog';
import { Plus, RefreshCw, Trash2, FileText, Globe, Database } from 'lucide-react';
import { toast } from 'sonner';

interface KB {
  id: string;
  sofia_kb_id: number;
  name: string;
  description: string | null;
  status: string | null;
  documents_count: number;
  assistants_count: number;
  synced_at: string;
}

interface Doc {
  id: string;
  sofia_doc_id: number;
  sofia_kb_id: number;
  name: string;
  description: string | null;
  type: string | null;
  status: string | null;
  synced_at: string;
}

export default function SofiaConhecimento() {
  const [kbs, setKbs] = useState<KB[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [createKbOpen, setCreateKbOpen] = useState(false);
  const [selected, setSelected] = useState<KB | null>(null);

  useEffect(() => { load(); }, []);

  async function load() {
    setLoading(true);
    const { data, error } = await supabase
      .from('sofia_knowledgebases')
      .select('*')
      .order('created_at', { ascending: false });
    if (error) toast.error('Erro: ' + error.message);
    else setKbs((data ?? []) as KB[]);
    setLoading(false);
  }

  async function sync() {
    setSyncing(true);
    const { data, error } = await supabase.functions.invoke('sofia-kb-sync');
    if (error) toast.error('Falha: ' + error.message);
    else {
      toast.success(`${data?.kbs ?? 0} bases e ${data?.documents ?? 0} documentos sincronizados`);
      await load();
    }
    setSyncing(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted-foreground">
          Bases que a Sofia consulta durante as chamadas (cardápio, taxas, horários, FAQ).
        </p>
        <div className="flex gap-2">
          <Button onClick={sync} disabled={syncing} size="sm" variant="outline">
            <RefreshCw className={`h-4 w-4 mr-2 ${syncing ? 'animate-spin' : ''}`} />
            Sincronizar
          </Button>
          <Button onClick={() => setCreateKbOpen(true)} size="sm">
            <Plus className="h-4 w-4 mr-2" /> Nova base
          </Button>
        </div>
      </div>

      {loading ? (
        <p className="text-sm text-muted-foreground">Carregando...</p>
      ) : kbs.length === 0 ? (
        <Card>
          <CardContent className="py-8 text-center text-muted-foreground">
            <Database className="h-8 w-8 mx-auto mb-2 opacity-50" />
            <p>Nenhuma base de conhecimento ainda. Clique em Sincronizar pra puxar as existentes da Sofia, ou Nova base pra criar.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {kbs.map((kb) => (
            <Card
              key={kb.id}
              className="cursor-pointer hover:shadow-card transition-shadow"
              onClick={() => setSelected(kb)}
            >
              <CardHeader className="pb-2">
                <CardTitle className="text-base">{kb.name}</CardTitle>
                {kb.description && <p className="text-xs text-muted-foreground">{kb.description}</p>}
              </CardHeader>
              <CardContent className="text-sm flex items-center justify-between">
                <div className="flex gap-3 text-muted-foreground">
                  <span><FileText className="h-3.5 w-3.5 inline mr-1" />{kb.documents_count} docs</span>
                  <span>{kb.assistants_count} assistentes</span>
                </div>
                <Badge variant={kb.status === 'active' ? 'default' : 'secondary'}>{kb.status ?? '—'}</Badge>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <CreateKbDialog open={createKbOpen} onClose={() => setCreateKbOpen(false)} onCreated={load} />
      <KbDetailDialog kb={selected} onClose={() => setSelected(null)} onChanged={load} />
    </div>
  );
}

function CreateKbDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name) { toast.error('Nome obrigatório'); return; }
    setSaving(true);
    const { data, error } = await supabase.functions.invoke('sofia-kb-action', {
      body: { action: 'create_kb', name, description: description || undefined },
    });
    if (error || data?.error) {
      toast.error('Erro: ' + (error?.message ?? data?.error));
    } else {
      toast.success('Base criada');
      setName(''); setDescription('');
      onClose();
      onCreated();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Nova base de conhecimento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Cardápio e Operação" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2} />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Criando...' : 'Criar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KbDetailDialog({ kb, onClose, onChanged }: { kb: KB | null; onClose: () => void; onChanged: () => void }) {
  const [docs, setDocs] = useState<Doc[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(false);
  const [createDocOpen, setCreateDocOpen] = useState(false);

  useEffect(() => {
    if (kb) loadDocs();
  }, [kb?.id]);

  async function loadDocs() {
    if (!kb) return;
    setLoadingDocs(true);
    const { data } = await supabase
      .from('sofia_kb_documents')
      .select('*')
      .eq('sofia_kb_id', kb.sofia_kb_id)
      .order('created_at', { ascending: false });
    setDocs((data ?? []) as Doc[]);
    setLoadingDocs(false);
  }

  async function deleteDoc(d: Doc) {
    if (!kb) return;
    if (!confirm(`Excluir documento "${d.name}"?`)) return;
    const { error } = await supabase.functions.invoke('sofia-kb-action', {
      body: { action: 'delete_doc', sofia_kb_id: kb.sofia_kb_id, sofia_doc_id: d.sofia_doc_id },
    });
    if (error) toast.error('Erro: ' + error.message);
    else { toast.success('Documento excluído'); loadDocs(); onChanged(); }
  }

  async function deleteKb() {
    if (!kb) return;
    if (!confirm(`Excluir a base "${kb.name}"? Todos os documentos dela também serão removidos.`)) return;
    const { error, data } = await supabase.functions.invoke('sofia-kb-action', {
      body: { action: 'delete_kb', sofia_kb_id: kb.sofia_kb_id },
    });
    if (error || data?.error) toast.error('Erro: ' + (error?.message ?? data?.error));
    else { toast.success('Base excluída'); onClose(); onChanged(); }
  }

  if (!kb) return null;

  return (
    <Dialog open={!!kb} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{kb.name}</DialogTitle></DialogHeader>
        {kb.description && <p className="text-sm text-muted-foreground">{kb.description}</p>}

        <div className="flex items-center justify-between mt-3">
          <p className="section-title">Documentos ({docs.length})</p>
          <Button size="sm" onClick={() => setCreateDocOpen(true)}>
            <Plus className="h-4 w-4 mr-2" /> Adicionar documento
          </Button>
        </div>

        <div className="border rounded-lg overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Nome</TableHead>
                <TableHead>Tipo</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {loadingDocs ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Carregando...</TableCell></TableRow>
              ) : docs.length === 0 ? (
                <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground">Sem documentos.</TableCell></TableRow>
              ) : docs.map((d) => (
                <TableRow key={d.id}>
                  <TableCell className="font-medium">{d.name}</TableCell>
                  <TableCell><Badge variant="outline">{d.type ?? '—'}</Badge></TableCell>
                  <TableCell><Badge variant={d.status === 'active' ? 'default' : 'secondary'}>{d.status ?? '—'}</Badge></TableCell>
                  <TableCell>
                    <Button size="sm" variant="ghost" onClick={() => deleteDoc(d)}>
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <DialogFooter className="justify-between sm:justify-between">
          <Button variant="destructive" size="sm" onClick={deleteKb}>
            <Trash2 className="h-4 w-4 mr-2" /> Excluir base
          </Button>
          <Button variant="outline" onClick={onClose}>Fechar</Button>
        </DialogFooter>

        <CreateDocDialog
          open={createDocOpen}
          onClose={() => setCreateDocOpen(false)}
          kb={kb}
          onCreated={() => { loadDocs(); onChanged(); }}
        />
      </DialogContent>
    </Dialog>
  );
}

function CreateDocDialog({ open, onClose, kb, onCreated }: { open: boolean; onClose: () => void; kb: KB; onCreated: () => void }) {
  const [type, setType] = useState<'txt' | 'website'>('txt');
  const [name, setName] = useState('');
  const [content, setContent] = useState('');
  const [url, setUrl] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  async function save() {
    if (!name) { toast.error('Nome obrigatório'); return; }
    if (type === 'txt' && !content) { toast.error('Conteúdo obrigatório'); return; }
    if (type === 'website' && !url) { toast.error('URL obrigatória'); return; }

    setSaving(true);
    const action = type === 'txt' ? 'create_doc_text' : 'create_doc_website';
    const body: Record<string, unknown> = { action, sofia_kb_id: kb.sofia_kb_id, name };
    if (description) body.description = description;
    if (type === 'txt') body.content = content;
    if (type === 'website') body.url = url;

    const { data, error } = await supabase.functions.invoke('sofia-kb-action', { body });
    if (error || data?.error) {
      toast.error('Erro: ' + (error?.message ?? data?.error));
    } else {
      toast.success('Documento criado · Processando na Sofia');
      setName(''); setContent(''); setUrl(''); setDescription('');
      onClose();
      onCreated();
    }
    setSaving(false);
  }

  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader><DialogTitle>Adicionar documento</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <div>
            <Label>Tipo</Label>
            <Select value={type} onValueChange={(v) => setType(v as any)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="txt"><FileText className="h-4 w-4 inline mr-2" />Texto puro</SelectItem>
                <SelectItem value="website"><Globe className="h-4 w-4 inline mr-2" />Página web (URL)</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground mt-1">
              PDF/DOCX precisam ser enviados pelo painel da Sofia (upload de arquivo).
            </p>
          </div>
          <div>
            <Label>Nome</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Ex: Cardápio Delivery" />
          </div>
          <div>
            <Label>Descrição (opcional)</Label>
            <Input value={description} onChange={(e) => setDescription(e.target.value)} />
          </div>
          {type === 'txt' ? (
            <div>
              <Label>Conteúdo</Label>
              <Textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                rows={10}
                placeholder="Cole aqui o texto que a Sofia vai consultar (cardápio, taxas, horários, FAQ...)"
              />
            </div>
          ) : (
            <div>
              <Label>URL</Label>
              <Input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://..." />
              <p className="text-xs text-muted-foreground mt-1">
                A Sofia vai fazer scrape da página. Use uma URL pública.
              </p>
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancelar</Button>
          <Button onClick={save} disabled={saving}>{saving ? 'Criando...' : 'Adicionar'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
