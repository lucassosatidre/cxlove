import type { ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Copy } from 'lucide-react';
import { toast } from 'sonner';
import { supabase } from '@/integrations/supabase/client';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';

type Tipo = 'nfe' | 'nfse';

function fmtBRL(v: number | null | undefined) {
  return Number(v ?? 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}
function fmtNum(v: number | null | undefined) {
  return Number(v ?? 0).toLocaleString('pt-BR', { minimumFractionDigits: 0, maximumFractionDigits: 4 });
}
function fmtCNPJ(v: string | null | undefined): string {
  const d = (v ?? '').replace(/\D/g, '');
  if (d.length !== 14) return v || '—';
  return `${d.slice(0,2)}.${d.slice(2,5)}.${d.slice(5,8)}/${d.slice(8,12)}-${d.slice(12)}`;
}
function fmtDate(v: string | null | undefined) {
  if (!v) return '—';
  const iso = String(v).slice(0, 10);
  const [y, m, d] = iso.split('-');
  return d ? `${d}/${m}/${y}` : '—';
}
function Field({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="text-sm font-medium break-words">{value ?? '—'}</div>
    </div>
  );
}

export default function NotaDetalheDialog({
  chave, tipo, onClose,
}: { chave: string | null; tipo: Tipo | null; onClose: () => void }) {
  const open = !!chave && !!tipo;

  const q = useQuery({
    queryKey: ['ctrl_nota_detalhe', tipo, chave],
    enabled: open,
    queryFn: async () => {
      if (tipo === 'nfe') {
        const { data: nota, error } = await (supabase as any)
          .from('nfe_entrada').select('*').eq('access_key', chave).maybeSingle();
        if (error) throw error;
        let items: any[] = [];
        if (nota?.id) {
          const { data: its } = await (supabase as any)
            .from('nfe_entrada_items').select('*').eq('nfe_id', nota.id).order('seq', { ascending: true });
          items = its ?? [];
        }
        return { nota, items };
      }
      const { data: nota, error } = await (supabase as any)
        .from('nfse_documents').select('*').eq('chave_acesso', chave).maybeSingle();
      if (error) throw error;
      return { nota, items: [] as any[] };
    },
  });

  const nota = q.data?.nota;
  const items = q.data?.items ?? [];
  const duplicatas: any[] = Array.isArray(nota?.duplicatas) ? nota.duplicatas : [];

  function copyChave() {
    if (!chave) return;
    navigator.clipboard.writeText(chave).then(() => toast.success('Chave copiada'));
  }

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 flex-wrap">
            {tipo === 'nfe' ? (nota?.emit_name ?? 'Nota fiscal') : (nota?.prestador_nome ?? 'Nota de serviço')}
            <Badge variant="outline" className="text-[10px]">{tipo === 'nfe' ? 'Produto (NF-e)' : 'Serviço (NFS-e)'}</Badge>
          </DialogTitle>
        </DialogHeader>

        {q.isLoading ? (
          <div className="space-y-3">{Array.from({ length: 5 }).map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}</div>
        ) : !nota ? (
          <p className="text-sm text-muted-foreground py-8 text-center">Não foi possível carregar a nota.</p>
        ) : tipo === 'nfe' ? (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Número" value={nota.numero} />
              <Field label="Série" value={nota.serie} />
              <Field label="Emissão" value={fmtDate(nota.emission_date)} />
              <Field label="Valor total" value={<span className="font-mono">{fmtBRL(nota.total_value)}</span>} />
              <Field label="Pagamento" value={nota.pag_method} />
              <Field label="Origem" value={nota.source} />
              <Field label="CNPJ emitente" value={fmtCNPJ(nota.emit_cnpj)} />
              <Field label="CNPJ destinatário" value={fmtCNPJ(nota.dest_cnpj)} />
            </div>

            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Chave de acesso</div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all bg-muted px-2 py-1 rounded">{chave}</code>
                <Button size="icon" variant="ghost" onClick={copyChave}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>

            {duplicatas.length > 0 && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Parcelas / Duplicatas</h4>
                <div className="rounded-md border overflow-x-auto">
                  <Table>
                    <TableHeader><TableRow>
                      <TableHead>Nº</TableHead><TableHead>Vencimento</TableHead><TableHead className="text-right">Valor</TableHead>
                    </TableRow></TableHeader>
                    <TableBody>
                      {duplicatas.map((d, i) => (
                        <TableRow key={i}>
                          <TableCell>{d.nDup ?? i + 1}</TableCell>
                          <TableCell>{fmtDate(d.dVenc)}</TableCell>
                          <TableCell className="text-right font-mono">{fmtBRL(d.vDup)}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </div>
            )}

            <div>
              <h4 className="text-sm font-semibold mb-2">Itens ({items.length})</h4>
              <div className="rounded-md border overflow-x-auto">
                <Table>
                  <TableHeader><TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>Código</TableHead>
                    <TableHead className="min-w-[200px]">Descrição</TableHead>
                    <TableHead>NCM</TableHead>
                    <TableHead>CFOP</TableHead>
                    <TableHead>Un</TableHead>
                    <TableHead className="text-right">Qtd</TableHead>
                    <TableHead className="text-right">V. unit</TableHead>
                    <TableHead className="text-right">Total</TableHead>
                    <TableHead className="text-right">Desc.</TableHead>
                    <TableHead className="text-right">Encargos</TableHead>
                  </TableRow></TableHeader>
                  <TableBody>
                    {items.map((it: any) => (
                      <TableRow key={it.id ?? it.seq}>
                        <TableCell>{it.seq}</TableCell>
                        <TableCell className="text-xs">{it.c_prod}</TableCell>
                        <TableCell className="text-xs">{it.description}</TableCell>
                        <TableCell className="text-xs">{it.ncm}</TableCell>
                        <TableCell className="text-xs">{it.cfop}</TableCell>
                        <TableCell className="text-xs">{it.u_com}</TableCell>
                        <TableCell className="text-right text-xs">{fmtNum(it.q_com)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmtBRL(it.v_un_com)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmtBRL(it.v_prod)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmtBRL(it.v_desc)}</TableCell>
                        <TableCell className="text-right text-xs font-mono">{fmtBRL(it.v_encargos)}</TableCell>
                      </TableRow>
                    ))}
                    {items.length === 0 && (
                      <TableRow><TableCell colSpan={11} className="text-center text-sm text-muted-foreground py-6">Sem itens detalhados.</TableCell></TableRow>
                    )}
                  </TableBody>
                </Table>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-6">
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
              <Field label="Número" value={nota.numero_nfse} />
              <Field label="Emissão" value={fmtDate(nota.data_emissao)} />
              <Field label="Valor do serviço" value={<span className="font-mono">{fmtBRL(nota.valor_servico)}</span>} />
              <Field label="Situação" value={nota.situacao} />
              <Field label="Município" value={nota.municipio} />
              <Field label="Cód. verificação" value={nota.codigo_verificacao} />
              <Field label="Prestador" value={nota.prestador_nome} />
              <Field label="CNPJ prestador" value={fmtCNPJ(nota.prestador_cnpj)} />
              <Field label="Tomador" value={nota.tomador_nome} />
              <Field label="CNPJ tomador" value={fmtCNPJ(nota.tomador_cnpj)} />
            </div>
            <div>
              <div className="text-[11px] uppercase tracking-wide text-muted-foreground mb-1">Chave de acesso</div>
              <div className="flex items-center gap-2">
                <code className="text-xs break-all bg-muted px-2 py-1 rounded">{chave}</code>
                <Button size="icon" variant="ghost" onClick={copyChave}><Copy className="h-4 w-4" /></Button>
              </div>
            </div>
            {nota.descricao && (
              <div>
                <h4 className="text-sm font-semibold mb-2">Descrição do serviço</h4>
                <p className="text-sm whitespace-pre-wrap bg-muted/50 rounded p-3">{nota.descricao}</p>
              </div>
            )}
            {nota.justificativa && <Field label="Justificativa" value={nota.justificativa} />}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
