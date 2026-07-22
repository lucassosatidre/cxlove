// Notas capturadas pelo Espião (NF-e + NFS-e) com status de conciliação da Controladoria.
import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Eye, EyeOff, FileText, RotateCcw, ScanLine } from 'lucide-react';

import { supabase } from '@/integrations/supabase/client';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from '@/components/ui/select';
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from '@/components/ui/table';
import { Skeleton } from '@/components/ui/skeleton';
import ConciliacaoNotaDialog, { type NotaParaConciliar } from './ConciliacaoNotaDialog';

type NotaTipo = 'nfe' | 'nfse';
type NotaStatus = 'pendente' | 'lancada' | 'ignorada';
type StatusFilter = 'todas' | NotaStatus;

type NotaRow = {
  chave: string;
  tipo: NotaTipo;
  fornecedor: string;
  cnpj: string;
  numero: string;
  emissao: string | null;   // ISO date
  valor: number;
  parcelas: number | null;
  status: NotaStatus;
  duplicatas: any[] | null;
  pag_method: string | null;
  raw_xml: string | null;
};

function firstOfMonthISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function fmtBRL(v: number | null | undefined) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtCNPJ(v: string | null): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v ?? '—';
  return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`;
}
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const iso = v.slice(0, 10);
  const [y, m, d] = iso.split('-');
  return `${d}/${m}/${y}`;
}

export default function ControladoriaNotas() {
  const qc = useQueryClient();
  const [from, setFrom] = useState<string>(firstOfMonthISO());
  const [to, setTo] = useState<string>(todayISO());
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('pendente');
  const [busca, setBusca] = useState('');
  const [notaConciliando, setNotaConciliando] = useState<NotaParaConciliar | null>(null);

  const notasQuery = useQuery({
    queryKey: ['ctrl_notas', { from, to }],
    queryFn: async () => {
      const nfePromise = (supabase as any)
        .from('nfe_entrada')
        .select('access_key,numero,emit_cnpj,emit_name,emission_date,total_value,duplicatas,pag_method,raw_xml')
        .gte('emission_date', `${from}T00:00:00`)
        .lte('emission_date', `${to}T23:59:59`)
        .order('emission_date', { ascending: false, nullsFirst: false })
        .limit(5000);

      const nfsePromise = (supabase as any)
        .from('nfse_documents')
        .select('chave_acesso,numero_nfse,prestador_cnpj,prestador_nome,data_emissao,valor_servico')
        .gte('data_emissao', from)
        .lte('data_emissao', to)
        .order('data_emissao', { ascending: false, nullsFirst: false })
        .limit(5000);

      const statusPromise = (supabase as any)
        .from('ctrl_nota_status')
        .select('chave,status')
        .limit(20000);

      const lancadasPromise = (supabase as any)
        .from('ctrl_contas_pagar')
        .select('nota_chave')
        .not('nota_chave', 'is', null)
        .limit(50000);

      const [nfeRes, nfseRes, statusRes, lancadasRes] = await Promise.all([nfePromise, nfsePromise, statusPromise, lancadasPromise]);
      if (nfeRes.error) throw nfeRes.error;
      if (nfseRes.error) throw nfseRes.error;
      if (statusRes.error) throw statusRes.error;
      if (lancadasRes.error) throw lancadasRes.error;

      const ignoradas = new Set<string>();
      for (const s of (statusRes.data ?? []) as any[]) {
        if (s.status === 'ignorada' && s.chave) ignoradas.add(s.chave);
      }
      const lancadas = new Set<string>();
      for (const l of (lancadasRes.data ?? []) as any[]) {
        if (l.nota_chave) lancadas.add(l.nota_chave);
      }
      const deriveStatus = (chave: string): NotaStatus => {
        if (ignoradas.has(chave)) return 'ignorada';
        if (lancadas.has(chave)) return 'lancada';
        return 'pendente';
      };

      const nfeRows: NotaRow[] = ((nfeRes.data ?? []) as any[])
        .filter((r) => r.access_key)
        .map((r) => ({
          chave: r.access_key,
          tipo: 'nfe' as const,
          fornecedor: r.emit_name ?? '—',
          cnpj: r.emit_cnpj ?? '',
          numero: r.numero ?? '—',
          emissao: r.emission_date ? r.emission_date.slice(0, 10) : null,
          valor: Number(r.total_value ?? 0),
          parcelas: Array.isArray(r.duplicatas) ? r.duplicatas.length : (r.duplicatas ? 1 : null),
          status: deriveStatus(r.access_key),
          duplicatas: r.duplicatas ?? null,
          pag_method: r.pag_method ?? null,
          raw_xml: r.raw_xml ?? null,
        }));

      const nfseRows: NotaRow[] = ((nfseRes.data ?? []) as any[])
        .filter((r) => r.chave_acesso)
        .map((r) => ({
          chave: r.chave_acesso,
          tipo: 'nfse' as const,
          fornecedor: r.prestador_nome ?? '—',
          cnpj: r.prestador_cnpj ?? '',
          numero: r.numero_nfse ?? '—',
          emissao: r.data_emissao ?? null,
          valor: Number(r.valor_servico ?? 0),
          parcelas: null,
          status: deriveStatus(r.chave_acesso),
          duplicatas: null,
          pag_method: null,
          raw_xml: null,
        }));


      const all = [...nfeRows, ...nfseRows].sort((a, b) => (b.emissao ?? '').localeCompare(a.emissao ?? ''));
      return all;
    },
  });

  const rows = useMemo(() => {
    const all = notasQuery.data ?? [];
    const s = busca.trim().toLowerCase();
    return all.filter((r) => {
      if (statusFilter !== 'todas' && r.status !== statusFilter) return false;
      if (!s) return true;
      return `${r.fornecedor} ${r.numero} ${r.cnpj}`.toLowerCase().includes(s);
    });
  }, [notasQuery.data, statusFilter, busca]);

  async function setStatus(nota: NotaRow, status: NotaStatus) {
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const { error } = await (supabase as any)
        .from('ctrl_nota_status')
        .upsert({
          chave: nota.chave,
          tipo: nota.tipo,
          status,
          handled_by: userRes?.user?.id ?? null,
          handled_at: new Date().toISOString(),
        }, { onConflict: 'chave' });
      if (error) throw error;
      toast.success(status === 'ignorada' ? 'Nota ignorada' : 'Status atualizado');
      qc.invalidateQueries({ queryKey: ['ctrl_notas'] });
    } catch (err: any) {
      toast.error(`Erro: ${err?.message || err}`);
    }
  }

  function abrirConciliacao(nota: NotaRow) {
    setNotaConciliando({
      chave: nota.chave,
      tipo: nota.tipo,
      fornecedor: nota.fornecedor,
      cnpj: nota.cnpj,
      numero: nota.numero,
      emissao: nota.emissao,
      valor: nota.valor,
      duplicatas: nota.duplicatas,
      pag_method: nota.pag_method,
      raw_xml: nota.raw_xml,
    });
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Notas do Espião</CardTitle>
        <p className="text-sm text-muted-foreground mt-1">
          NF-e e NFS-e capturadas automaticamente. Lance em contas a pagar ou ignore.
        </p>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 md:grid-cols-5">
          <div>
            <Label className="text-xs">Emissão de</Label>
            <Input type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Emissão até</Label>
            <Input type="date" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div>
            <Label className="text-xs">Status</Label>
            <Select value={statusFilter} onValueChange={(v) => setStatusFilter(v as StatusFilter)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todas">Todas</SelectItem>
                <SelectItem value="pendente">Pendentes</SelectItem>
                <SelectItem value="lancada">Lançadas</SelectItem>
                <SelectItem value="ignorada">Ignoradas</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="md:col-span-2">
            <Label className="text-xs">Busca (fornecedor, número ou CNPJ)</Label>
            <Input value={busca} onChange={(e) => setBusca(e.target.value)} placeholder="Buscar…" />
          </div>
        </div>

        {notasQuery.isLoading ? (
          <div className="space-y-2">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}</div>
        ) : rows.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <FileText className="h-14 w-14 text-muted-foreground mb-3" />
            <h3 className="text-base font-semibold">Nenhuma nota nesse filtro</h3>
            <p className="text-sm text-muted-foreground">Ajuste o período ou o status.</p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-md border border-border">
            <Table className="w-full">
              <TableHeader>
                <TableRow>
                  <TableHead className="min-w-[220px]">Fornecedor</TableHead>
                  <TableHead>Tipo</TableHead>
                  <TableHead className="whitespace-nowrap">Nº</TableHead>
                  <TableHead className="whitespace-nowrap">Emissão</TableHead>
                  <TableHead className="text-right whitespace-nowrap">Valor</TableHead>
                  <TableHead className="text-center whitespace-nowrap">Parcelas</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Ações</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={`${r.tipo}:${r.chave}`}>
                    <TableCell className="align-top">
                      <div className="font-medium whitespace-normal break-words">{r.fornecedor}</div>
                      {r.cnpj && <div className="text-xs text-muted-foreground">CNPJ {fmtCNPJ(r.cnpj)}</div>}
                    </TableCell>
                    <TableCell className="align-top">
                      <Badge variant="outline" className="text-[10px]">
                        {r.tipo === 'nfe' ? 'Produto' : 'Serviço'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-xs whitespace-nowrap align-top">{r.numero}</TableCell>
                    <TableCell className="text-xs whitespace-nowrap align-top">{fmtDate(r.emissao)}</TableCell>
                    <TableCell className="text-right font-mono text-sm whitespace-nowrap align-top">{fmtBRL(r.valor)}</TableCell>
                    <TableCell className="text-center text-xs align-top">{r.parcelas ?? '—'}</TableCell>
                    <TableCell className="align-top">
                      {r.status === 'lancada' ? (
                        <Badge className="bg-emerald-600 hover:bg-emerald-700 text-white">Lançada</Badge>
                      ) : r.status === 'ignorada' ? (
                        <Badge variant="secondary">Ignorada</Badge>
                      ) : (
                        <Badge variant="outline" className="border-amber-400 text-amber-600 dark:text-amber-400">Pendente</Badge>
                      )}
                    </TableCell>
                    <TableCell className="text-right align-top whitespace-nowrap">
                      {r.status === 'pendente' && (
                        <>
                          <Button size="sm" onClick={() => abrirConciliacao(r)}>
                            <CheckCircle2 className="h-4 w-4 mr-1" /> Lançar
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'ignorada')} className="ml-1">
                            <EyeOff className="h-4 w-4" />
                          </Button>
                        </>
                      )}
                      {r.status !== 'pendente' && (
                        <Button size="sm" variant="ghost" onClick={() => setStatus(r, 'pendente')}>
                          <RotateCcw className="h-4 w-4 mr-1" /> Reabrir
                        </Button>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>

      <ConciliacaoNotaDialog
        nota={notaConciliando}
        onClose={() => setNotaConciliando(null)}
        onSaved={() => {
          setNotaConciliando(null);
          qc.invalidateQueries({ queryKey: ['ctrl_notas'] });
          qc.invalidateQueries({ queryKey: ['ctrl_contas_pagar'] });
        }}
      />
    </Card>
  );
}
