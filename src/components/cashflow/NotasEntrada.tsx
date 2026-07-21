// Notas de Entrada (NF-e) no Vigia — puxadas direto do Espião (edge espiao-sync-entrada).
// Lista as notas de entrada, detalhe com itens, sincronização e importação de XML.
import { useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import JSZip from 'jszip';
import { Upload, FileText, Eye, Trash2, Loader2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import {
  Dialog, DialogContent, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

type Nfe = {
  id: string;
  access_key: string | null;
  numero: string | null;
  serie: string | null;
  emit_cnpj: string | null;
  emit_name: string | null;
  emission_date: string | null;
  total_value: number | null;
  source: string | null;
  created_at: string;
  nfe_entrada_items?: { count: number }[];
};
type Item = {
  id: string; seq: number | null; c_prod: string | null; description: string | null;
  ncm: string | null; cfop: string | null; u_com: string | null; q_com: number | null;
  v_un_com: number | null; v_prod: number | null;
};

function fmtBRL(v: number | null | undefined) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtCNPJ(v: string | null): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v ?? '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function extractXmls(files: File[]): Promise<string[]> {
  const out: string[] = [];
  for (const f of files) {
    const name = f.name.toLowerCase();
    if (name.endsWith('.zip')) {
      const zip = await JSZip.loadAsync(f);
      const entries = Object.values(zip.files).filter((e) => !e.dir && e.name.toLowerCase().endsWith('.xml'));
      for (const e of entries) out.push(await e.async('text'));
    } else if (name.endsWith('.xml')) {
      out.push(await f.text());
    }
  }
  return out;
}

export default function NotasEntrada() {
  const qc = useQueryClient();
  const inputRef = useRef<HTMLInputElement>(null);
  const [importing, setImporting] = useState(false);
  const [from, setFrom] = useState<string>(firstOfMonthISO());
  const [to, setTo] = useState<string>(todayISO());
  const [busca, setBusca] = useState('');
  const [detailId, setDetailId] = useState<string | null>(null);
  const [deleteId, setDeleteId] = useState<string | null>(null);

  const list = useQuery({
    queryKey: ['nfe_entrada', { from, to }],
    queryFn: async () => {
      let q = (supabase as any)
        .from('nfe_entrada')
        .select('id,access_key,numero,serie,emit_cnpj,emit_name,emission_date,total_value,source,created_at,nfe_entrada_items(count)')
        .order('emission_date', { ascending: false, nullsFirst: false })
        .limit(3000);
      if (from) q = q.gte('emission_date', `${from}T00:00:00`);
      if (to) q = q.lte('emission_date', `${to}T23:59:59`);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Nfe[];
    },
  });

  const rows = useMemo(() => {
    const all = list.data ?? [];
    const s = busca.trim().toLowerCase();
    if (!s) return all;
    return all.filter((r) => `${r.emit_name ?? ''} ${r.numero ?? ''} ${r.emit_cnpj ?? ''}`.toLowerCase().includes(s));
  }, [list.data, busca]);

  const totalValor = useMemo(() => rows.reduce((a, r) => a + Number(r.total_value ?? 0), 0), [rows]);

  const detail = useQuery({
    queryKey: ['nfe_entrada_items', detailId],
    enabled: !!detailId,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('nfe_entrada_items')
        .select('id,seq,c_prod,description,ncm,cfop,u_com,q_com,v_un_com,v_prod')
        .eq('nfe_id', detailId)
        .order('seq');
      if (error) throw error;
      return (data ?? []) as Item[];
    },
  });

  async function handleUpload(files: FileList | null) {
    if (!files || files.length === 0) return;
    setImporting(true);
    try {
      const xmls = await extractXmls(Array.from(files));
      if (xmls.length === 0) { toast.error('Nenhum XML encontrado'); return; }
      const { data, error } = await supabase.functions.invoke('espiao-sync-entrada', { body: { xmls } });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      const s: any = data ?? {};
      toast.success(`Importadas ${s.imported ?? 0} nota(s)` + (s.skipped ? `, ${s.skipped} já existia(m)` : '') + (s.errors ? `, ${s.errors} erro(s)` : ''));
      qc.invalidateQueries({ queryKey: ['nfe_entrada'] });
    } catch (e: any) {
      toast.error(`Erro ao importar: ${e?.message || e}`);
    } finally {
      setImporting(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await (supabase as any).from('nfe_entrada').delete().eq('id', deleteId);
    if (error) { toast.error(`Erro ao excluir: ${error.message}`); return; }
    toast.success('Nota excluída');
    setDeleteId(null);
    qc.invalidateQueries({ queryKey: ['nfe_entrada'] });
  }

  const detailNota = rows.find((r) => r.id === detailId);

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-4 flex-wrap">
        <div>
          <CardTitle>Notas de Entrada</CardTitle>
          <p className="text-sm text-muted-foreground mt-1">
            NF-e de entrada capturadas na SEFAZ (Espião). Entram sozinhas várias vezes ao dia.
            Para adicionar uma nota na hora, importe o XML.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            ref={inputRef}
            type="file"
            multiple
            accept=".xml,.zip,application/xml,text/xml,application/zip"
            className="hidden"
            onChange={(e) => handleUpload(e.target.files)}
          />
          <Button size="sm" onClick={() => inputRef.current?.click()} disabled={importing}>
            {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
            Importar XML
          </Button>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-4">
          <div>
            <Label className="text-xs">Emissão de</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Emissão até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Busca (fornecedor, número ou CNPJ)</Label>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" />
          </div>
        </div>

        <div className="grid gap-3 md:grid-cols-3">
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Notas no período</div>
            <div className="font-mono text-lg font-semibold">{rows.length}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Valor total das entradas</div>
            <div className="font-mono text-lg font-semibold">{fmtBRL(totalValor)}</div>
          </div>
          <div className="rounded-lg border border-border/60 bg-muted/20 p-3">
            <div className="text-[11px] uppercase tracking-wider text-muted-foreground">Período</div>
            <div className="text-sm font-medium">{from.split('-').reverse().join('/')} → {to.split('-').reverse().join('/')}</div>
            <div className="text-[11px] text-muted-foreground">por emissão</div>
          </div>
        </div>

        {list.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-14 w-14 text-muted-foreground mb-3" />
            <h3 className="text-base font-semibold">Nenhuma nota de entrada no período</h3>
            <p className="text-sm text-muted-foreground">As notas entram sozinhas ao longo do dia, ou use "Importar XML".</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Fornecedor</TableHead>
                  <TableHead className="whitespace-nowrap">Número / Série</TableHead>
                  <TableHead className="whitespace-nowrap">Emissão</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Itens</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Valor total</TableHead>
                  <TableHead>Origem</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const itemCount = r.nfe_entrada_items?.[0]?.count ?? 0;
                  return (
                    <TableRow key={r.id}>
                      <TableCell className="align-top">
                        <div className="font-medium whitespace-normal break-words">{r.emit_name || '—'}</div>
                        {r.emit_cnpj && <div className="text-xs text-muted-foreground">CNPJ {fmtCNPJ(r.emit_cnpj)}</div>}
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap align-top">
                        <div>{r.numero ?? '—'}</div>
                        <div className="text-muted-foreground">Série {r.serie ?? '—'}</div>
                      </TableCell>
                      <TableCell className="text-xs whitespace-nowrap align-top">
                        {r.emission_date ? format(new Date(r.emission_date), 'dd/MM/yyyy', { locale: ptBR }) : '—'}
                      </TableCell>
                      <TableCell className="text-right text-xs align-top">{itemCount}</TableCell>
                      <TableCell className="text-right font-mono text-sm whitespace-nowrap align-top">{fmtBRL(r.total_value)}</TableCell>
                      <TableCell className="text-xs align-top">
                        <span className="inline-block rounded px-1.5 py-0.5 text-[11px] bg-muted text-muted-foreground">
                          {r.source === 'upload' ? 'XML' : 'Espião'}
                        </span>
                      </TableCell>
                      <TableCell className="text-right align-top whitespace-nowrap">
                        <Button size="icon" variant="ghost" onClick={() => setDetailId(r.id)} title="Ver itens">
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button size="icon" variant="ghost" onClick={() => setDeleteId(r.id)} title="Excluir">
                          <Trash2 className="h-4 w-4 text-destructive" />
                        </Button>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      {/* Detalhe: itens da nota */}
      <Dialog open={!!detailId} onOpenChange={(o) => { if (!o) setDetailId(null); }}>
        <DialogContent className="max-w-3xl">
          <DialogHeader>
            <DialogTitle>
              {detailNota ? `${detailNota.emit_name ?? 'Nota'} — NF ${detailNota.numero ?? ''}` : 'Itens da nota'}
            </DialogTitle>
          </DialogHeader>
          <div className="overflow-x-auto max-h-[60vh]">
            {detail.isLoading ? (
              <div className="space-y-2 p-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-8 w-full" />)}</div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-10">#</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead className="whitespace-nowrap">NCM / CFOP</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Qtd</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Vlr unit.</TableHead>
                    <TableHead className="text-right whitespace-nowrap">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {(detail.data ?? []).map((it) => (
                    <TableRow key={it.id}>
                      <TableCell className="text-xs">{it.seq ?? '—'}</TableCell>
                      <TableCell className="text-xs whitespace-normal break-words">{it.description || '—'}</TableCell>
                      <TableCell className="text-xs whitespace-nowrap text-muted-foreground">{it.ncm || '—'} / {it.cfop || '—'}</TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap">{Number(it.q_com ?? 0).toLocaleString('pt-BR')} {it.u_com || ''}</TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap font-mono">{fmtBRL(it.v_un_com)}</TableCell>
                      <TableCell className="text-right text-xs whitespace-nowrap font-mono">{fmtBRL(it.v_prod)}</TableCell>
                    </TableRow>
                  ))}
                  {(detail.data ?? []).length === 0 && !detail.isLoading && (
                    <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Sem itens.</TableCell></TableRow>
                  )}
                </TableBody>
              </Table>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteId} onOpenChange={(o) => !o && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Excluir esta nota de entrada?</AlertDialogTitle>
            <AlertDialogDescription>
              Remove a NF-e e seus itens do Vigia. Se ela vier de novo do Espião numa próxima sincronização, será reimportada.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancelar</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete}>Excluir</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
