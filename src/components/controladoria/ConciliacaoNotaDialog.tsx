// Diálogo de conciliação de uma nota (NF-e ou NFS-e) em parcelas de ctrl_contas_pagar.
import { useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';

import { supabase } from '@/integrations/supabase/client';
import { parseNFeXml } from '@/lib/nfeFinanceParser';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { TagCombobox } from '@/components/cashflow/TagCombobox';

export type NotaParaConciliar = {
  chave: string;
  tipo: 'nfe' | 'nfse';
  fornecedor: string;
  cnpj: string;
  numero: string;
  emissao: string | null;
  valor: number;
  duplicatas: any[] | null;
  pag_method: string | null;
  raw_xml: string | null;
};

type Parcela = { nDup: string; dVenc: string; vDup: string };

const METODOS = [
  'Pix', 'Cartão de Crédito', 'Cartão de Débito', 'Boleto', 'Dinheiro',
  'Débito Automático', 'Tarifas Bancárias', 'Transferência', 'Não informado',
];

type OptionKind = 'categoria' | 'metodo' | 'conta' | 'fornecedor' | 'descricao';
type OptionsMap = Record<OptionKind, string[]>;

function uniqSort(list: string[]): string[] {
  const seen = new Map<string, string>();
  for (const v of list) {
    const t = (v ?? '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (!seen.has(k)) seen.set(k, t);
  }
  return Array.from(seen.values()).sort((a, b) => a.localeCompare(b, 'pt-BR'));
}
function uniqKeepOrder(list: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const v of list) {
    const t = (v ?? '').trim();
    if (!t) continue;
    const k = t.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(t);
  }
  return out;
}
function toNumber(s: string): number {
  return Number(String(s).replace(/\./g, '').replace(',', '.'));
}
function fmtBRL(v: number) {
  return v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

export default function ConciliacaoNotaDialog({
  nota, onClose, onSaved,
}: {
  nota: NotaParaConciliar | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const open = !!nota;
  const [parcelas, setParcelas] = useState<Parcela[]>([]);
  const [categoria, setCategoria] = useState('Matéria Prima');
  const [metodo, setMetodo] = useState('Boleto');
  const [conta, setConta] = useState('');
  const [saving, setSaving] = useState(false);

  // Opções próprias da Controladoria (isoladas do Caixa).
  const optionsQuery = useQuery({
    queryKey: ['ctrl_options'],
    enabled: open,
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from('ctrl_options')
        .select('kind,value')
        .order('value');
      if (error) throw error;
      const g: OptionsMap = { categoria: [], metodo: [], conta: [], fornecedor: [], descricao: [] };
      for (const r of (data ?? []) as { kind: OptionKind; value: string }[]) {
        if (g[r.kind]) g[r.kind].push(r.value);
      }
      return g;
    },
    staleTime: 5 * 60 * 1000,
  });


  useEffect(() => {
    if (!nota) return;
    // pré-preenchimento das parcelas
    let dups: any[] = Array.isArray(nota.duplicatas) ? nota.duplicatas : [];
    if (nota.tipo === 'nfe' && dups.length === 0 && nota.raw_xml) {
      try {
        const parsed = parseNFeXml(nota.raw_xml);
        dups = parsed.duplicatas ?? [];
      } catch { /* segue vazio */ }
    }
    if (dups.length > 0) {
      setParcelas(dups.map((d, i) => ({
        nDup: String(d.nDup ?? (i + 1)),
        dVenc: d.dVenc ?? '',
        vDup: String(Number(d.vDup ?? 0).toFixed(2)).replace('.', ','),
      })));
    } else {
      setParcelas([{ nDup: '1', dVenc: '', vDup: String(Number(nota.valor ?? 0).toFixed(2)).replace('.', ',') }]);
    }
    setCategoria('Matéria Prima');
    setMetodo(nota.pag_method || 'Boleto');
    setConta('');
  }, [nota?.chave]); // eslint-disable-line react-hooks/exhaustive-deps

  const opts = optionsQuery.data ?? { categoria: [], metodo: [], conta: [], fornecedor: [], descricao: [] };
  const categoriasAll = useMemo(() => uniqSort(['Matéria Prima', ...opts.categoria]), [opts.categoria]);
  const metodosAll = useMemo(() => uniqKeepOrder([...METODOS, ...opts.metodo]), [opts.metodo]);
  const contasAll = useMemo(() => uniqSort(opts.conta), [opts.conta]);

  const somaParcelas = useMemo(
    () => parcelas.reduce((a, p) => a + (isFinite(toNumber(p.vDup)) ? toNumber(p.vDup) : 0), 0),
    [parcelas],
  );
  const totalNota = Number(nota?.valor ?? 0);
  const divergente = !!nota && Math.abs(somaParcelas - totalNota) > 0.02;

  function addParcela() {
    setParcelas((prev) => [...prev, { nDup: String(prev.length + 1), dVenc: '', vDup: '0,00' }]);
  }
  function removeParcela(idx: number) {
    setParcelas((prev) => prev.filter((_, i) => i !== idx));
  }
  function updateParcela(idx: number, patch: Partial<Parcela>) {
    setParcelas((prev) => prev.map((p, i) => (i === idx ? { ...p, ...patch } : p)));
  }

  async function addOption(kind: OptionKind, value: string) {
    const v = value.trim();
    if (!v) return;
    const { data: userRes } = await supabase.auth.getUser();
    await (supabase as any).from('ctrl_options').insert({ kind, value: v, created_by: userRes?.user?.id ?? null });
  }


  async function confirmar() {
    if (!nota) return;
    if (parcelas.length === 0) { toast.error('Adicione ao menos uma parcela'); return; }
    for (const p of parcelas) {
      if (!p.dVenc) { toast.error(`Parcela ${p.nDup} sem vencimento`); return; }
      const v = toNumber(p.vDup);
      if (!isFinite(v) || v <= 0) { toast.error(`Parcela ${p.nDup} com valor inválido`); return; }
    }

    setSaving(true);
    try {
      const { data: userRes } = await supabase.auth.getUser();
      const uid = userRes?.user?.id ?? null;
      const n = parcelas.length;
      const source = nota.tipo === 'nfe' ? 'nfe' : 'nfse';
      const notaLabel = nota.tipo === 'nfe' ? 'NF-e' : 'NFS-e';

      const rows = parcelas.map((p, i) => ({
        emissao: nota.emissao,
        vencimento: p.dVenc,
        pagamento: null,
        paid: false,
        amount: -Math.abs(toNumber(p.vDup)),
        category: categoria || null,
        payment_method: metodo || null,
        conta: conta || null,
        fornecedor: nota.fornecedor || null,
        descricao: `${notaLabel} ${nota.numero} parcela ${i + 1}/${n}`,
        cnpj: nota.cnpj || null,
        numero_nota: nota.numero || null,
        source,
        nota_chave: nota.chave,
        parcela: `${i + 1}/${n}`,
        created_by: uid,
      }));

      // Inserir uma a uma para tratar conflito de UNIQUE (nota_chave,parcela) sem quebrar.
      let inseridas = 0;
      let jaExistiam = 0;
      for (const row of rows) {
        const { error } = await (supabase as any).from('ctrl_contas_pagar').insert(row);
        if (error) {
          if (/duplicate|unique|23505/i.test(error.message ?? '')) jaExistiam++;
          else throw error;
        } else {
          inseridas++;
        }
      }

      await (supabase as any).from('ctrl_nota_status').upsert({
        chave: nota.chave,
        tipo: nota.tipo,
        status: 'lancada',
        handled_by: uid,
        handled_at: new Date().toISOString(),
      }, { onConflict: 'chave' });

      if (inseridas > 0) toast.success(`${inseridas} parcela(s) lançada(s)` + (jaExistiam ? ` (${jaExistiam} já existia(m))` : ''));
      else if (jaExistiam > 0) toast.info(`Parcelas já haviam sido lançadas (${jaExistiam})`);
      onSaved();
    } catch (err: any) {
      console.error(err);
      toast.error(`Erro ao lançar: ${err?.message || err}`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-w-3xl">
        <DialogHeader>
          <DialogTitle>Conciliar nota em contas a pagar</DialogTitle>
        </DialogHeader>

        {nota && (
          <div className="space-y-4">
            <div className="grid gap-2 md:grid-cols-4 rounded-md border border-border/60 bg-muted/20 p-3 text-sm">
              <div>
                <div className="text-[11px] uppercase text-muted-foreground">Fornecedor</div>
                <div className="font-medium break-words">{nota.fornecedor}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground">Emissão</div>
                <div className="font-medium">{nota.emissao ? nota.emissao.split('-').reverse().join('/') : '—'}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground">Número</div>
                <div className="font-medium">{nota.numero}</div>
              </div>
              <div>
                <div className="text-[11px] uppercase text-muted-foreground">Valor total</div>
                <div className="font-mono font-semibold">{fmtBRL(totalNota)}</div>
              </div>
            </div>

            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <Label className="text-sm font-semibold">Parcelas</Label>
                <Button size="sm" variant="outline" onClick={addParcela}>
                  <Plus className="h-4 w-4 mr-1" /> Adicionar parcela
                </Button>
              </div>

              <div className="space-y-2">
                {parcelas.map((p, i) => (
                  <div key={i} className="grid grid-cols-[60px_1fr_1fr_40px] gap-2 items-end">
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Nº</Label>
                      <Input value={p.nDup} onChange={(e) => updateParcela(i, { nDup: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Vencimento</Label>
                      <Input type="date" value={p.dVenc} onChange={(e) => updateParcela(i, { dVenc: e.target.value })} />
                    </div>
                    <div>
                      <Label className="text-[10px] text-muted-foreground">Valor (R$)</Label>
                      <Input inputMode="decimal" value={p.vDup} onChange={(e) => updateParcela(i, { vDup: e.target.value })} />
                    </div>
                    <Button size="icon" variant="ghost" onClick={() => removeParcela(i)} title="Remover">
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </div>
                ))}
              </div>

              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">Soma das parcelas:</span>
                <span className={`font-mono font-semibold ${divergente ? 'text-amber-600 dark:text-amber-400' : ''}`}>
                  {fmtBRL(somaParcelas)}
                </span>
              </div>
              {divergente && (
                <p className="text-xs text-amber-600 dark:text-amber-400">
                  Atenção: soma das parcelas difere do valor da nota em {fmtBRL(Math.abs(somaParcelas - totalNota))}.
                </p>
              )}
            </div>

            <div className="grid gap-3 md:grid-cols-3">
              <div>
                <Label className="text-xs">Categoria</Label>
                <TagCombobox value={categoria} onChange={setCategoria} options={categoriasAll} onCreate={(v) => addOption('categoria', v)} placeholder="Categoria" />
              </div>
              <div>
                <Label className="text-xs">Método</Label>
                <TagCombobox value={metodo} onChange={setMetodo} options={metodosAll} onCreate={(v) => addOption('metodo', v)} placeholder="Método" />
              </div>
              <div>
                <Label className="text-xs">Conta / Banco</Label>
                <TagCombobox value={conta} onChange={setConta} options={contasAll} onCreate={(v) => addOption('conta', v)} placeholder="Conta / Banco" />
              </div>
            </div>
          </div>
        )}

        <DialogFooter>
          <Button variant="ghost" onClick={onClose} disabled={saving}>Cancelar</Button>
          <Button onClick={confirmar} disabled={saving}>{saving ? 'Lançando…' : 'Confirmar lançamento'}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
