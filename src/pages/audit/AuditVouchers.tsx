import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import * as XLSX from 'xlsx';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import {
  Breadcrumb, BreadcrumbItem, BreadcrumbLink, BreadcrumbList, BreadcrumbPage, BreadcrumbSeparator,
} from '@/components/ui/breadcrumb';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from 'sonner';
import {
  ArrowLeft, ChevronDown, ChevronRight, FileSpreadsheet, FileText, Landmark, Loader2, UploadCloud,
} from 'lucide-react';
import { extractPdfText } from '@/lib/pdf-text-extract';

type AuditPeriod = { id: string; month: number; year: number; status: string };

type AuditImport = {
  id: string;
  file_type: string;
  file_name: string;
  status: string;
  imported_rows: number;
  total_rows: number;
  created_at: string;
  error_message?: string | null;
};

type Lot = {
  id: string;
  operadora: string;
  numero_reembolso: string;
  numero_contrato: string | null;
  produto: string | null;
  data_corte: string | null;
  data_credito: string;
  subtotal_vendas: number;
  total_descontos: number;
  valor_liquido: number;
  descontos: Record<string, number> | null;
  bb_deposit_id: string | null;
  status: string;
  manual: boolean;
};

type LotItem = {
  id: string;
  lot_id: string;
  data_transacao: string;
  data_postagem: string | null;
  numero_documento: string | null;
  numero_cartao_mascarado: string | null;
  valor: number;
};

type BankDeposit = {
  id: string;
  deposit_date: string;
  description: string | null;
  detail: string | null;
  category: string | null;
  amount: number;
};

type MaquinonaSale = {
  id: string;
  sale_date: string;
  gross_amount: number;
  net_amount: number;
  brand: string | null;
};

type CompOverride = {
  id: string;
  lot_id: string;
  year: number;
  month: number;
  taxa_competencia: number;
  note: string | null;
};

const MONTHS = [
  'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
  'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
];

const DISCOUNT_LABELS: Record<string, string> = {
  tarifa_gestao: 'Tarifa de gestão',
  tarifa_transacao: 'Tarifa por transação',
  taxa_tpe: 'Taxa TPE',
  anuidade: 'Anuidade',
  outros: 'Outros',
};

const CATEGORY_LABELS: Record<string, string> = {
  ticket: 'Ticket',
  alelo: 'Alelo',
  pluxee: 'Pluxee',
  vr: 'VR',
  brendi: 'Brendi',
  outro: 'Outro',
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtPct = (v: number) => `${v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
const fmtDate = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';
const fmtDateTime = (iso: string) => new Date(iso).toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });

// Fallback runtime: pdf parser pode ter salvo subtotal/total_descontos como 0
// quando regex flexível não casou. Reconstroi a partir dos items+valor_liquido.
function computedLot(lot: Lot, items: LotItem[]) {
  const sumItems = items.reduce((s, i) => s + Number(i.valor || 0), 0);
  const subtotal = Number(lot.subtotal_vendas) > 0
    ? Number(lot.subtotal_vendas)
    : Math.round(sumItems * 100) / 100;
  let totalDesc = Number(lot.total_descontos);
  const liquido = Number(lot.valor_liquido);
  if (totalDesc === 0 && subtotal > 0 && liquido > 0 && subtotal > liquido) {
    totalDesc = Math.round((subtotal - liquido) * 100) / 100;
  }
  return { subtotal, totalDesc, liquido };
}

export default function AuditVouchers() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { isAdmin, loading: roleLoading } = useUserRole();

  const now = new Date();
  const [month, setMonth] = useState<number>(Number(searchParams.get('month')) || now.getMonth() + 1);
  const [year, setYear] = useState<number>(Number(searchParams.get('year')) || now.getFullYear());

  const [period, setPeriod] = useState<AuditPeriod | null>(null);
  const [loading, setLoading] = useState(true);
  const [lots, setLots] = useState<Lot[]>([]);
  const [imports, setImports] = useState<AuditImport[]>([]);
  const [deposits, setDeposits] = useState<BankDeposit[]>([]);
  const [maquinonaTicket, setMaquinonaTicket] = useState<MaquinonaSale[]>([]);
  const [overrides, setOverrides] = useState<CompOverride[]>([]);
  const [expandedLot, setExpandedLot] = useState<string | null>(null);
  const [matching, setMatching] = useState(false);
  const [itemsByLot, setItemsByLot] = useState<Record<string, LotItem[]>>({});
  const [allItemsByLot, setAllItemsByLot] = useState<Record<string, LotItem[]>>({});
  const [categoryFilter, setCategoryFilter] = useState<string>('ticket');
  const [showAllLots, setShowAllLots] = useState(false);

  const refresh = async (periodId: string) => {
    const compIni = `${year}-${String(month).padStart(2, '0')}-01`;
    const next = new Date(year, month, 1);
    const compFim = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;

    const [lotsRes, importsRes, depRes, maqRes, ovrRes] = await Promise.all([
      supabase
        .from('audit_voucher_lots')
        .select('id, operadora, numero_reembolso, numero_contrato, produto, data_corte, data_credito, subtotal_vendas, total_descontos, valor_liquido, descontos, bb_deposit_id, status, manual')
        .eq('audit_period_id', periodId)
        .order('data_credito', { ascending: true }),
      supabase
        .from('audit_imports')
        .select('id, file_type, file_name, status, imported_rows, total_rows, created_at, error_message')
        .eq('audit_period_id', periodId)
        .in('file_type', ['bb', 'ticket', 'alelo', 'pluxee', 'vr'])
        .order('created_at', { ascending: false }),
      supabase
        .from('audit_bank_deposits')
        .select('id, deposit_date, description, detail, category, amount')
        .eq('audit_period_id', periodId)
        .eq('bank', 'bb')
        .order('deposit_date', { ascending: true }),
      supabase
        .from('audit_card_transactions')
        .select('id, sale_date, gross_amount, net_amount, brand')
        .eq('deposit_group', 'ticket')
        .gte('sale_date', compIni)
        .lt('sale_date', compFim),
      supabase
        .from('audit_voucher_lot_competencia_overrides')
        .select('id, lot_id, year, month, taxa_competencia, note')
        .eq('year', year)
        .eq('month', month),
    ]);
    const fetchedLots = (lotsRes.data ?? []) as Lot[];
    setLots(fetchedLots);
    setImports((importsRes.data ?? []) as AuditImport[]);
    setDeposits((depRes.data ?? []) as BankDeposit[]);
    setMaquinonaTicket((maqRes.data ?? []) as MaquinonaSale[]);
    setOverrides((ovrRes.data ?? []) as CompOverride[]);

    // Carrega TODOS os items de TODOS os lotes (em batch) pra calcular competência
    // de venda. lot_items é compacto (10-50 rows por lote típico), 19 lotes ~= 50-200 rows.
    const lotIds = fetchedLots.map(l => l.id);
    if (lotIds.length > 0) {
      const { data: allItems } = await supabase
        .from('audit_voucher_lot_items')
        .select('id, lot_id, data_transacao, data_postagem, numero_documento, numero_cartao_mascarado, valor')
        .in('lot_id', lotIds);
      const grouped: Record<string, LotItem[]> = {};
      for (const it of (allItems ?? []) as LotItem[]) {
        if (!grouped[it.lot_id]) grouped[it.lot_id] = [];
        grouped[it.lot_id].push(it);
      }
      setAllItemsByLot(grouped);
    } else {
      setAllItemsByLot({});
    }
  };

  useEffect(() => {
    if (!isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from('audit_periods').select('*').eq('month', month).eq('year', year).maybeSingle();
      const p = (data as AuditPeriod) ?? null;
      if (!active) return;
      setPeriod(p);
      if (p) await refresh(p.id);
      else { setLots([]); setImports([]); setDeposits([]); setMaquinonaTicket([]); setAllItemsByLot({}); setOverrides([]); }
      setLoading(false);
    })();
    return () => { active = false; };
  }, [isAdmin, month, year]);

  // Sincroniza search params
  useEffect(() => {
    const next = new URLSearchParams(searchParams);
    next.set('month', String(month));
    next.set('year', String(year));
    setSearchParams(next, { replace: true });
  }, [month, year]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadItems = (lotId: string) => {
    if (itemsByLot[lotId] || allItemsByLot[lotId]) {
      if (!itemsByLot[lotId] && allItemsByLot[lotId]) {
        const sorted = [...allItemsByLot[lotId]].sort((a, b) => a.data_transacao.localeCompare(b.data_transacao));
        setItemsByLot(s => ({ ...s, [lotId]: sorted }));
      }
      setExpandedLot(expandedLot === lotId ? null : lotId);
      return;
    }
    setExpandedLot(lotId);
  };

  // Cria período se não existir
  const ensurePeriod = async (): Promise<AuditPeriod | null> => {
    if (period) return period;
    const { data, error } = await supabase
      .from('audit_periods')
      .insert({ month, year, status: 'aberto' })
      .select()
      .single();
    if (error) {
      toast.error('Erro ao criar período', { description: error.message });
      return null;
    }
    const p = data as AuditPeriod;
    setPeriod(p);
    return p;
  };

  // Janela do mês de competência (vendas) — YYYY-MM-DD
  const competenciaIni = useMemo(() => `${year}-${String(month).padStart(2, '0')}-01`, [year, month]);
  const competenciaFim = useMemo(() => {
    const next = new Date(year, month, 1); // mês seguinte
    return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-01`;
  }, [year, month]);
  // Janela do BB: começa no início da competência, vai até +60 dias depois do fim do mês de competência (cobre defasagem Ticket de até 26d + folga)
  const bbWindowFim = useMemo(() => {
    const fim = new Date(competenciaFim + 'T00:00:00');
    fim.setDate(fim.getDate() + 60);
    return fim.toISOString().slice(0, 10);
  }, [competenciaFim]);

  // Agrega valor de vendas DENTRO da competência por lote.
  // saleByLotInCompetencia[lotId] = { count, valor } (só items com data_transacao no mês X)
  const competenciaByLot = useMemo(() => {
    const map: Record<string, { count: number; valor: number }> = {};
    for (const [lotId, items] of Object.entries(allItemsByLot)) {
      let count = 0; let valor = 0;
      for (const it of items) {
        if (it.data_transacao >= competenciaIni && it.data_transacao < competenciaFim) {
          count++;
          valor += Number(it.valor);
        }
      }
      if (count > 0) map[lotId] = { count, valor };
    }
    return map;
  }, [allItemsByLot, competenciaIni, competenciaFim]);

  const allTicketLots = useMemo(() => lots.filter(l => l.operadora === 'ticket'), [lots]);

  // Lotes com pelo menos 1 venda na competência
  const ticketLotsCompetencia = useMemo(
    () => allTicketLots.filter(l => competenciaByLot[l.id]),
    [allTicketLots, competenciaByLot],
  );

  // Visíveis na tabela: ou todos (toggle on), ou só os de competência
  const visibleTicketLots = useMemo(
    () => showAllLots ? allTicketLots : ticketLotsCompetencia,
    [showAllLots, allTicketLots, ticketLotsCompetencia],
  );

  // Override de competência indexado por lot_id
  const overrideByLot = useMemo(() => {
    const map = new Map<string, CompOverride>();
    for (const o of overrides) map.set(o.lot_id, o);
    return map;
  }, [overrides]);

  // Stats refletem competência (vendas no mês X). Regras:
  // - Lote 100% no mês: usa total_descontos do lote inteiro
  // - Lote parcial COM override: usa override.taxa_competencia
  // - Lote parcial SEM override: NÃO contribui pro KPI (countAguardando) e
  //   precisa input manual; o usuário consulta portal Ticket pra digitar.
  const ticketStats = useMemo(() => {
    let count = 0;
    let countParcial = 0;
    let countAguardando = 0; // parciais sem override
    let subtotal = 0;        // bruto vendido na competência
    let descontos = 0;       // taxa relevante (com override quando parcial)
    let liquido = 0;
    let matched = 0;
    let salesCount = 0;
    for (const l of allTicketLots) {
      const comp = competenciaByLot[l.id];
      if (!comp) continue;
      count++;
      salesCount += comp.count;

      const items = allItemsByLot[l.id] ?? [];
      const { subtotal: lotSubtotal, totalDesc, liquido: lotLiquido } = computedLot(l, items);
      const isParcial = items.length > comp.count;

      subtotal += comp.valor;

      if (!isParcial) {
        // 100% no mês — usa valores totais do lote
        descontos += totalDesc;
        liquido += lotLiquido;
      } else {
        countParcial++;
        const ovr = overrideByLot.get(l.id);
        if (ovr) {
          descontos += Number(ovr.taxa_competencia);
          liquido += comp.valor - Number(ovr.taxa_competencia);
        } else {
          countAguardando++;
          // não contribui pra KPI até input manual
        }
      }
      if (l.bb_deposit_id) matched++;
    }
    const taxaPct = subtotal > 0 ? (descontos / subtotal) * 100 : 0;
    return { count, countParcial, countAguardando, salesCount, subtotal, descontos, liquido, matched, taxaPct };
  }, [allTicketLots, competenciaByLot, allItemsByLot, overrideByLot]);

  // Cross-check Maquinona × Ticket: vendas Maquinona no mês vs items de lote
  // Ticket que caem no mês (por data_transacao). Devem bater em count e bruto.
  const crossCheck = useMemo(() => {
    const maqCount = maquinonaTicket.length;
    const maqBruto = maquinonaTicket.reduce((s, m) => s + Number(m.gross_amount || 0), 0);
    let ticketCount = 0;
    let ticketBruto = 0;
    for (const items of Object.values(allItemsByLot)) {
      for (const it of items) {
        if (it.data_transacao >= competenciaIni && it.data_transacao < competenciaFim) {
          ticketCount++;
          ticketBruto += Number(it.valor || 0);
        }
      }
    }
    const diffCount = maqCount - ticketCount;
    const diffBruto = Math.round((maqBruto - ticketBruto) * 100) / 100;
    return { maqCount, maqBruto, ticketCount, ticketBruto, diffCount, diffBruto };
  }, [maquinonaTicket, allItemsByLot, competenciaIni, competenciaFim]);

  // Depósitos BB filtrados pela janela do mês de competência (até +60 dias) e categoria.
  const filteredDeposits = useMemo(() => {
    let arr = deposits.filter(d => d.deposit_date >= competenciaIni && d.deposit_date < bbWindowFim);
    if (categoryFilter !== 'todos') arr = arr.filter(d => d.category === categoryFilter);
    return arr;
  }, [deposits, categoryFilter, competenciaIni, bbWindowFim]);

  // Numeração #N por depósito BB DENTRO da categoria (na janela do mês). Usado
  // pra exibir "operação N - data" no resumo do lote pareado.
  const depositNumberById = useMemo(() => {
    const map = new Map<string, { n: number; deposit: BankDeposit }>();
    const byCat: Record<string, BankDeposit[]> = {};
    for (const d of deposits) {
      if (d.deposit_date < competenciaIni || d.deposit_date >= bbWindowFim) continue;
      const cat = d.category ?? 'outro';
      if (!byCat[cat]) byCat[cat] = [];
      byCat[cat].push(d);
    }
    for (const cat of Object.keys(byCat)) {
      byCat[cat].sort((a, b) => a.deposit_date.localeCompare(b.deposit_date));
      byCat[cat].forEach((d, idx) => map.set(d.id, { n: idx + 1, deposit: d }));
    }
    return map;
  }, [deposits, competenciaIni, bbWindowFim]);


  const handleAutoMatch = async () => {
    if (!period) return;
    setMatching(true);
    try {
      const { data, error } = await supabase.functions.invoke('match-vouchers', {
        body: { audit_period_id: period.id, operadora: 'ticket', reset: false },
      });
      if (error) throw new Error(error.message);
      if (!data?.success) throw new Error(data?.error || 'Falha no match');
      const ambig = (data.ambiguous ?? []) as string[];
      toast.success(data.message ?? `${data.matched} pareados`, {
        description: ambig.length > 0 ? `${ambig.length} ambíguos (resolva manualmente)` : 'OK',
      });
      if (ambig.length > 0) console.warn('Match ambíguos:', ambig);
      await refresh(period.id);
    } catch (e: any) {
      toast.error('Erro no auto-match', { description: e?.message ?? 'Erro inesperado' });
    } finally {
      setMatching(false);
    }
  };

  const setLotMatch = async (lotId: string, depositId: string | null) => {
    const update = depositId
      ? { bb_deposit_id: depositId, status: 'matched', manual: true,
          diff: (() => {
            const lot = lots.find(l => l.id === lotId);
            const dep = deposits.find(d => d.id === depositId);
            return lot && dep ? Number(dep.amount) - Number(lot.valor_liquido) : null;
          })() }
      : { bb_deposit_id: null, status: 'pending', manual: false, diff: null };
    const { error } = await supabase.from('audit_voucher_lots').update(update).eq('id', lotId);
    if (error) {
      toast.error('Erro ao atualizar match', { description: error.message });
      return;
    }
    toast.success(depositId ? 'Match atualizado' : 'Match removido');
    if (period) await refresh(period.id);
  };

  const saveOverride = async (lotId: string, taxaCompetencia: number, note: string | null) => {
    const existing = overrides.find(o => o.lot_id === lotId && o.year === year && o.month === month);
    if (existing) {
      const { error } = await supabase
        .from('audit_voucher_lot_competencia_overrides')
        .update({ taxa_competencia: taxaCompetencia, note, updated_by: null })
        .eq('id', existing.id);
      if (error) { toast.error('Erro ao salvar', { description: error.message }); return; }
    } else {
      const { error } = await supabase
        .from('audit_voucher_lot_competencia_overrides')
        .insert({ lot_id: lotId, year, month, taxa_competencia: taxaCompetencia, note });
      if (error) { toast.error('Erro ao salvar', { description: error.message }); return; }
    }
    toast.success('Taxa da competência salva');
    if (period) await refresh(period.id);
  };

  const deleteOverride = async (lotId: string) => {
    const existing = overrides.find(o => o.lot_id === lotId && o.year === year && o.month === month);
    if (!existing) return;
    const { error } = await supabase
      .from('audit_voucher_lot_competencia_overrides')
      .delete()
      .eq('id', existing.id);
    if (error) { toast.error('Erro ao remover', { description: error.message }); return; }
    toast.success('Override removido');
    if (period) await refresh(period.id);
  };

  if (roleLoading || loading) {
    return (
      <AppLayout title="Vouchers" subtitle="Auditoria de Taxas (Estágio 2)">
        <div className="flex items-center justify-center py-20">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      </AppLayout>
    );
  }

  if (!isAdmin) {
    return (
      <AppLayout title="Vouchers">
        <Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito a administradores.</CardContent></Card>
      </AppLayout>
    );
  }

  return (
    <AppLayout title="Vouchers" subtitle="Auditoria de Taxas (Estágio 2)">
      <div className="space-y-4">
        <Breadcrumb>
          <BreadcrumbList>
            <BreadcrumbItem>
              <BreadcrumbLink onClick={() => navigate('/admin/auditoria')} className="cursor-pointer">
                Auditoria
              </BreadcrumbLink>
            </BreadcrumbItem>
            <BreadcrumbSeparator />
            <BreadcrumbItem><BreadcrumbPage>Vouchers</BreadcrumbPage></BreadcrumbItem>
          </BreadcrumbList>
        </Breadcrumb>

        <Card className="border-amber-500/30 bg-amber-500/5">
          <CardContent className="py-3 text-sm">
            <strong>Em construção (Estágio 2).</strong> Esta aba é independente da auditoria iFood/Cresol.
            Por enquanto apenas <strong>Ticket</strong> está habilitado. Match BB ↔ lote ainda não conectado.
          </CardContent>
        </Card>

        {/* Seletor de período */}
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Mês</span>
              <Select value={String(month)} onValueChange={v => setMonth(Number(v))}>
                <SelectTrigger className="w-[140px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {MONTHS.map((m, i) => (
                    <SelectItem key={i + 1} value={String(i + 1)}>{m}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Ano</span>
              <Select value={String(year)} onValueChange={v => setYear(Number(v))}>
                <SelectTrigger className="w-[110px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {[year - 1, year, year + 1].map(y => (
                    <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {period ? (
              <Badge variant="outline" className="font-medium">
                Período {MONTHS[period.month - 1]} {period.year} — {period.status}
              </Badge>
            ) : (
              <Badge variant="secondary">Sem período (será criado no primeiro upload)</Badge>
            )}
          </CardContent>
        </Card>

        {/* Cards de upload */}
        <div className="grid gap-4 md:grid-cols-2">
          <UploadBBCard period={period} ensurePeriod={ensurePeriod} onAfter={() => period && refresh(period.id)} />
          <UploadTicketCard period={period} ensurePeriod={ensurePeriod} onAfter={() => period && refresh(period.id)} />
        </div>

        {/* Cross-check Maquinona × Ticket */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Cross-check Maquinona × Ticket — vendas em {MONTHS[month - 1]} {year}</CardTitle>
            <p className="text-xs text-muted-foreground mt-1">
              Vendas Ticket no extrato Maquinona devem ter o mesmo total das vendas listadas no PDF Ticket
              (data_transacao no mês). Se diferir, falta importar Maquinona ou um lote do portal Ticket.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-5 text-sm">
              <Stat label="Maquinona Ticket" value={fmt(crossCheck.maqBruto)} hint={`${crossCheck.maqCount} vendas`} />
              <Stat label="Portal Ticket (lotes)" value={fmt(crossCheck.ticketBruto)} hint={`${crossCheck.ticketCount} vendas`} />
              <Stat
                label="Diferença"
                value={fmt(crossCheck.diffBruto)}
                hint={`${crossCheck.diffCount > 0 ? '+' : ''}${crossCheck.diffCount} venda(s)`}
                className={Math.abs(crossCheck.diffBruto) < 0.05 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}
              />
              <div className="md:col-span-2 flex items-center">
                {crossCheck.maqCount === 0 && crossCheck.ticketCount === 0 ? (
                  <Badge variant="outline" className="text-muted-foreground">Sem dados</Badge>
                ) : Math.abs(crossCheck.diffBruto) < 0.05 && crossCheck.diffCount === 0 ? (
                  <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">✓ Vendas batem</Badge>
                ) : (
                  <Badge className="bg-rose-500/15 text-rose-700 dark:text-rose-400">⚠ Divergência</Badge>
                )}
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stats Ticket */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap space-y-0">
            <div>
              <CardTitle className="text-base">Ticket — Competência {MONTHS[month - 1]} {year}</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Vendas Ticket no mês selecionado. Lotes podem ter sido pagos no BB em meses seguintes.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {allTicketLots.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={handleAutoMatch}
                  disabled={matching || !period}
                  className="gap-2"
                >
                  {matching ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                  Auto-match BB
                </Button>
              )}
              {allTicketLots.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setShowAllLots(s => !s)}
                >
                  {showAllLots
                    ? `Mostrar só competência (${ticketLotsCompetencia.length})`
                    : `Ver todos os lotes (${allTicketLots.length})`}
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid gap-3 grid-cols-2 md:grid-cols-6 mb-4 text-sm">
              <Stat label="Lotes" value={`${ticketStats.count} (${ticketStats.salesCount} vendas)`}
                hint={ticketStats.countParcial > 0 ? `${ticketStats.countParcial} parcial(is)` : undefined} />
              <Stat label="Vendido (bruto)" value={fmt(ticketStats.subtotal)} />
              <Stat label="Descontos"
                value={fmt(ticketStats.descontos)}
                className="text-amber-700 dark:text-amber-400"
                hint={ticketStats.countAguardando > 0 ? `${ticketStats.countAguardando} aguardando manual` : undefined} />
              <Stat label="Líquido" value={fmt(ticketStats.liquido)} className="text-emerald-700 dark:text-emerald-400" />
              <Stat label="Taxa efetiva"
                value={fmtPct(ticketStats.taxaPct)}
                className="text-rose-700 dark:text-rose-400"
                hint={ticketStats.countAguardando > 0 ? 'parciais sem override fora do total' : undefined} />
              <Stat label="Pareados c/ BB" value={`${ticketStats.matched} / ${ticketStats.count}`} />
            </div>

            {visibleTicketLots.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">
                {allTicketLots.length === 0
                  ? 'Nenhum lote Ticket importado neste período.'
                  : `Nenhum lote com vendas em ${MONTHS[month - 1]}/${year}. Use "Ver todos os lotes" pra inspecionar os ${allTicketLots.length} importados.`}
              </p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-8"></TableHead>
                    <TableHead>Reembolso</TableHead>
                    <TableHead>Produto</TableHead>
                    <TableHead>Corte</TableHead>
                    <TableHead>Crédito BB</TableHead>
                    <TableHead>Vendas no mês</TableHead>
                    <TableHead className="text-right">Subtotal</TableHead>
                    <TableHead className="text-right">Descontos</TableHead>
                    <TableHead className="text-right">Líquido</TableHead>
                    <TableHead>Match BB</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {visibleTicketLots.map(l => {
                    const expanded = expandedLot === l.id;
                    const comp = competenciaByLot[l.id];
                    const allItems = allItemsByLot[l.id] ?? [];
                    const totalItems = allItems.length;
                    const inCompetencia = comp?.count ?? 0;
                    const isParcial = inCompetencia > 0 && inCompetencia < totalItems;
                    const { subtotal, totalDesc, liquido } = computedLot(l, allItems);
                    return (
                      <Fragment key={l.id}>
                        <TableRow className="cursor-pointer hover:bg-muted/30" onClick={() => loadItems(l.id)}>
                          <TableCell>
                            {expanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-mono text-xs">{l.numero_reembolso}</TableCell>
                          <TableCell>
                            <Badge variant="outline" className="font-mono">{l.produto ?? '—'}</Badge>
                          </TableCell>
                          <TableCell>{fmtDate(l.data_corte)}</TableCell>
                          <TableCell>{fmtDate(l.data_credito)}</TableCell>
                          <TableCell className="text-xs">
                            {inCompetencia === 0 ? (
                              <span className="text-muted-foreground">— / {totalItems}</span>
                            ) : inCompetencia === totalItems ? (
                              <Badge variant="outline" className="font-mono">{inCompetencia} / {totalItems}</Badge>
                            ) : (
                              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400 font-mono" title="Lote parcial — taxa precisa input manual">
                                {inCompetencia} / {totalItems} ⚠
                              </Badge>
                            )}
                          </TableCell>
                          <TableCell className="text-right">{fmt(subtotal)}</TableCell>
                          <TableCell className="text-right text-amber-700 dark:text-amber-400">{fmt(totalDesc)}</TableCell>
                          <TableCell className="text-right font-medium">{fmt(liquido)}</TableCell>
                          <TableCell>
                            {l.bb_deposit_id ? (() => {
                              const dep = depositNumberById.get(l.bb_deposit_id);
                              return (
                                <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">
                                  ✓ {dep ? `#${dep.n} ${fmtDate(dep.deposit_date)}` : 'Pareado'}
                                  {l.manual && <span className="ml-1 text-[10px]">(M)</span>}
                                </Badge>
                              );
                            })() : (
                              <Badge variant="outline" className="text-muted-foreground">Pendente</Badge>
                            )}
                          </TableCell>
                        </TableRow>
                        {expanded && (
                          <TableRow className="bg-muted/20 hover:bg-muted/20">
                            <TableCell colSpan={10} className="p-0">
                              <LotDetail
                                lot={l}
                                items={itemsByLot[l.id] ?? allItemsByLot[l.id] ?? []}
                                competenciaIni={competenciaIni}
                                competenciaFim={competenciaFim}
                                deposits={deposits}
                                depositNumberById={depositNumberById}
                                override={overrideByLot.get(l.id) ?? null}
                                onSetMatch={(depId) => setLotMatch(l.id, depId)}
                                onSaveOverride={(taxa, note) => saveOverride(l.id, taxa, note)}
                                onDeleteOverride={() => deleteOverride(l.id)}
                                month={month}
                                year={year}
                              />
                            </TableCell>
                          </TableRow>
                        )}
                      </Fragment>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Depósitos BB */}
        <Card>
          <CardHeader className="pb-3 flex flex-row items-center justify-between gap-2 flex-wrap space-y-0">
            <div>
              <CardTitle className="text-base">Depósitos BB — janela {MONTHS[month - 1]} {year} + 60d</CardTitle>
              <p className="text-xs text-muted-foreground mt-1">
                Inclui pagamentos de vendas do mês que cairam até 60 dias depois (defasagem Ticket).
              </p>
            </div>
            <Select value={categoryFilter} onValueChange={setCategoryFilter}>
              <SelectTrigger className="w-[160px] h-9"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="todos">Todas categorias</SelectItem>
                <SelectItem value="ticket">Ticket</SelectItem>
                <SelectItem value="alelo">Alelo</SelectItem>
                <SelectItem value="pluxee">Pluxee</SelectItem>
                <SelectItem value="vr">VR</SelectItem>
                <SelectItem value="brendi">Brendi</SelectItem>
                <SelectItem value="outro">Outros</SelectItem>
              </SelectContent>
            </Select>
          </CardHeader>
          <CardContent>
            {filteredDeposits.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Nenhum depósito BB nesta categoria.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-12">#</TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead>Descrição</TableHead>
                    <TableHead>Detalhe</TableHead>
                    <TableHead className="text-right">Valor</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredDeposits.map(d => {
                    const numbered = depositNumberById.get(d.id);
                    return (
                      <TableRow key={d.id}>
                        <TableCell className="font-mono text-xs">{numbered ? `#${numbered.n}` : '—'}</TableCell>
                        <TableCell>{fmtDate(d.deposit_date)}</TableCell>
                        <TableCell>
                          <Badge variant="outline">{d.category ? (CATEGORY_LABELS[d.category] ?? d.category) : '—'}</Badge>
                        </TableCell>
                        <TableCell className="max-w-[280px] truncate text-xs">{d.description ?? '—'}</TableCell>
                        <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">{d.detail ?? '—'}</TableCell>
                        <TableCell className="text-right font-medium">{fmt(Number(d.amount))}</TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        {/* Histórico de imports */}
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-base">Histórico de imports</CardTitle></CardHeader>
          <CardContent>
            {imports.length === 0 ? (
              <p className="text-sm text-muted-foreground py-4">Sem imports voucher neste período.</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Data</TableHead>
                    <TableHead>Tipo</TableHead>
                    <TableHead>Arquivo</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Linhas</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {imports.map(i => (
                    <TableRow key={i.id}>
                      <TableCell>{fmtDateTime(i.created_at)}</TableCell>
                      <TableCell><Badge variant="outline">{i.file_type}</Badge></TableCell>
                      <TableCell className="max-w-[300px] truncate text-xs">{i.file_name}</TableCell>
                      <TableCell>
                        {i.status === 'completed' ? (
                          <Badge className="bg-green-500/15 text-green-700 dark:text-green-400">completed</Badge>
                        ) : i.status === 'error' ? (
                          <Badge variant="destructive">error</Badge>
                        ) : (
                          <Badge variant="outline">{i.status}</Badge>
                        )}
                      </TableCell>
                      <TableCell className="text-right font-mono text-xs">
                        {i.imported_rows} / {i.total_rows}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>

        <Button variant="outline" onClick={() => navigate('/admin/auditoria')} className="gap-2">
          <ArrowLeft className="h-4 w-4" /> Voltar à Auditoria principal
        </Button>
      </div>
    </AppLayout>
  );
}

function Stat({ label, value, className, hint }: { label: string; value: string; className?: string; hint?: string }) {
  return (
    <div className="rounded-md border bg-card px-3 py-2">
      <div className="text-[10px] uppercase text-muted-foreground tracking-wide">{label}</div>
      <div className={`text-base font-semibold ${className ?? ''}`}>{value}</div>
      {hint && <div className="text-[10px] text-muted-foreground mt-0.5">{hint}</div>}
    </div>
  );
}

function LotDetail({
  lot, items, competenciaIni, competenciaFim,
  deposits, depositNumberById, override,
  onSetMatch, onSaveOverride, onDeleteOverride,
  month, year,
}: {
  lot: Lot;
  items: LotItem[];
  competenciaIni: string;
  competenciaFim: string;
  deposits: BankDeposit[];
  depositNumberById: Map<string, { n: number; deposit: BankDeposit }>;
  override: CompOverride | null;
  onSetMatch: (depositId: string | null) => Promise<void>;
  onSaveOverride: (taxa: number, note: string | null) => Promise<void>;
  onDeleteOverride: () => Promise<void>;
  month: number;
  year: number;
}) {
  const descontos = lot.descontos ?? {};
  const descKeys = Object.keys(descontos);
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.data_transacao.localeCompare(b.data_transacao)),
    [items],
  );
  const { subtotal, totalDesc, liquido } = computedLot(lot, items);
  const liquidoTeorico = subtotal - totalDesc;
  const taxaPct = subtotal > 0 ? (totalDesc / subtotal) * 100 : 0;
  const itensComp = sortedItems.filter(it => it.data_transacao >= competenciaIni && it.data_transacao < competenciaFim);
  const isParcial = itensComp.length > 0 && itensComp.length < sortedItems.length;
  const compValor = itensComp.reduce((s, i) => s + Number(i.valor), 0);
  const matchedDep = lot.bb_deposit_id ? depositNumberById.get(lot.bb_deposit_id) : null;

  // Candidatos pra match manual: BB Ticket dentro da janela do mês (+60d)
  const ticketCategoryMatch = lot.operadora;
  const matchCandidates = useMemo(() => {
    return deposits
      .filter(d => d.category === ticketCategoryMatch)
      .filter(d => depositNumberById.has(d.id))
      .sort((a, b) => a.deposit_date.localeCompare(b.deposit_date));
  }, [deposits, ticketCategoryMatch, depositNumberById]);

  return (
    <div className="px-4 py-3 space-y-3">
      <div className="grid gap-3 md:grid-cols-2">
        <div>
          <div className="text-xs uppercase text-muted-foreground mb-1">Vendas do lote ({items.length})</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Data</TableHead>
                <TableHead>Doc</TableHead>
                <TableHead>Cartão</TableHead>
                <TableHead className="text-right">Valor</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sortedItems.map(it => {
                const inComp = it.data_transacao >= competenciaIni && it.data_transacao < competenciaFim;
                return (
                  <TableRow key={it.id} className={inComp ? '' : 'opacity-60'}>
                    <TableCell className="text-xs">
                      {fmtDate(it.data_transacao)}
                      {!inComp && <span className="ml-1 text-[10px] text-muted-foreground">(fora)</span>}
                    </TableCell>
                    <TableCell className="font-mono text-xs">{it.numero_documento ?? '—'}</TableCell>
                    <TableCell className="font-mono text-xs">{it.numero_cartao_mascarado ?? '—'}</TableCell>
                    <TableCell className="text-right text-xs">{fmt(Number(it.valor))}</TableCell>
                  </TableRow>
                );
              })}
              <TableRow className="bg-muted/30">
                <TableCell colSpan={3} className="text-xs font-semibold">Total das vendas</TableCell>
                <TableCell className="text-right text-xs font-semibold">{fmt(subtotal)}</TableCell>
              </TableRow>
              {isParcial && (
                <TableRow>
                  <TableCell colSpan={3} className="text-[10px] text-muted-foreground">Vendas na competência ({itensComp.length})</TableCell>
                  <TableCell className="text-right text-[10px] text-muted-foreground">{fmt(compValor)}</TableCell>
                </TableRow>
              )}
            </TableBody>
          </Table>
        </div>
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Resumo do lote</div>
            <div className="rounded border bg-card divide-y">
              <ResumoLine label="Total das vendas" value={fmt(subtotal)} />
              <ResumoLine label="Total de descontos" value={fmt(totalDesc)} valueClass="text-amber-700 dark:text-amber-400" />
              <ResumoLine label="Taxa efetiva" value={fmtPct(taxaPct)} valueClass="text-rose-700 dark:text-rose-400" />
              <ResumoLine label="Líquido teórico" value={fmt(liquidoTeorico)} valueClass="text-emerald-700 dark:text-emerald-400" hint="subtotal − descontos" />
              <ResumoLine
                label="Líquido recebido"
                value={fmt(liquido)}
                valueClass={Math.abs(liquidoTeorico - liquido) < 0.05 ? 'text-emerald-700 dark:text-emerald-400' : 'text-rose-700 dark:text-rose-400'}
                hint={matchedDep
                  ? `operação #${matchedDep.n} — ${fmtDate(matchedDep.deposit.deposit_date)}${lot.manual ? ' (manual)' : ''}`
                  : Math.abs(liquidoTeorico - liquido) < 0.05 ? '(extrato Ticket) ✓ bate' : `(extrato Ticket) ✗ diff ${fmt(liquido - liquidoTeorico)}`
                }
              />
              {isParcial && (
                <ResumoLine
                  label="Taxa da competência"
                  value={override ? fmt(Number(override.taxa_competencia)) : '— preencher'}
                  valueClass={override ? 'text-amber-700 dark:text-amber-400' : 'text-muted-foreground italic'}
                  hint={`refere-se às ${itensComp.length} venda(s) de ${MONTHS[month - 1].toLowerCase()} (R$${compValor.toFixed(2)})`}
                />
              )}
            </div>
          </div>

          {/* Match BB */}
          <div>
            <div className="text-xs uppercase text-muted-foreground mb-1">Match Banco do Brasil</div>
            <MatchSelector
              currentDepositId={lot.bb_deposit_id}
              candidates={matchCandidates}
              expectedAmount={Number(lot.valor_liquido)}
              depositNumberById={depositNumberById}
              onSet={onSetMatch}
            />
          </div>

          {/* Override de taxa quando lote parcial */}
          {isParcial && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">
                Taxa referente às vendas da competência ({MONTHS[month - 1]} {year})
              </div>
              <CompetenciaOverrideInput
                override={override}
                onSave={onSaveOverride}
                onDelete={onDeleteOverride}
              />
              <p className="text-[11px] text-muted-foreground mt-1">
                Consulte o portal Ticket pra obter a taxa real desta(s) venda(s). O sistema usa este
                valor no KPI mensal em vez de ratear proporcional o desconto do lote inteiro.
              </p>
            </div>
          )}

          {descKeys.length > 0 && (
            <div>
              <div className="text-xs uppercase text-muted-foreground mb-1">Quebra de descontos</div>
              <Table>
                <TableBody>
                  {descKeys.map(k => (
                    <TableRow key={k}>
                      <TableCell className="text-xs py-1.5">{DISCOUNT_LABELS[k] ?? k}</TableCell>
                      <TableCell className="text-right text-xs py-1.5 text-amber-700 dark:text-amber-400">
                        {fmt(Number(descontos[k]))}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}

          <div className="grid grid-cols-2 gap-2 text-xs">
            <div className="rounded border px-2 py-1">
              <div className="text-muted-foreground">Contrato</div>
              <div className="font-mono">{lot.numero_contrato ?? '—'}</div>
            </div>
            <div className="rounded border px-2 py-1">
              <div className="text-muted-foreground">Crédito previsto BB</div>
              <div>{fmtDate(lot.data_credito)}</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function ResumoLine({ label, value, valueClass, hint }: { label: string; value: string; valueClass?: string; hint?: string }) {
  return (
    <div className="flex items-center justify-between px-3 py-1.5 text-xs gap-2">
      <div>
        <div>{label}</div>
        {hint && <div className="text-[10px] text-muted-foreground">{hint}</div>}
      </div>
      <div className={`font-semibold tabular-nums ${valueClass ?? ''}`}>{value}</div>
    </div>
  );
}

function MatchSelector({
  currentDepositId, candidates, expectedAmount, depositNumberById, onSet,
}: {
  currentDepositId: string | null;
  candidates: BankDeposit[];
  expectedAmount: number;
  depositNumberById: Map<string, { n: number; deposit: BankDeposit }>;
  onSet: (depositId: string | null) => Promise<void>;
}) {
  const [saving, setSaving] = useState(false);
  const handleChange = async (val: string) => {
    setSaving(true);
    try {
      await onSet(val === '__none__' ? null : val);
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="flex items-center gap-2">
      <Select value={currentDepositId ?? '__none__'} onValueChange={handleChange} disabled={saving}>
        <SelectTrigger className="h-9 text-xs">
          <SelectValue placeholder="Selecionar depósito BB" />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="__none__">— Sem match (pendente)</SelectItem>
          {candidates.map(d => {
            const num = depositNumberById.get(d.id);
            const diff = Number(d.amount) - expectedAmount;
            const exact = Math.abs(diff) < 0.05;
            return (
              <SelectItem key={d.id} value={d.id}>
                #{num?.n ?? '?'} — {fmtDate(d.deposit_date)} — {fmt(Number(d.amount))}
                {exact ? ' ✓' : ` (diff ${diff > 0 ? '+' : ''}${fmt(diff)})`}
              </SelectItem>
            );
          })}
        </SelectContent>
      </Select>
      {saving && <Loader2 className="h-4 w-4 animate-spin" />}
    </div>
  );
}

function CompetenciaOverrideInput({
  override, onSave, onDelete,
}: {
  override: CompOverride | null;
  onSave: (taxa: number, note: string | null) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [value, setValue] = useState<string>(override ? String(override.taxa_competencia) : '');
  const [note, setNote] = useState<string>(override?.note ?? '');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setValue(override ? String(override.taxa_competencia) : '');
    setNote(override?.note ?? '');
  }, [override]);

  const handleSave = async () => {
    const num = Number(value.replace(',', '.'));
    if (!isFinite(num) || num < 0) {
      toast.error('Valor inválido');
      return;
    }
    setSaving(true);
    try {
      await onSave(num, note.trim() || null);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex-1 min-w-[120px]">
        <input
          type="text"
          inputMode="decimal"
          placeholder="Ex: 13,85"
          className="w-full h-9 rounded-md border bg-background px-2 text-xs"
          value={value}
          onChange={e => setValue(e.target.value)}
        />
      </div>
      <div className="flex-1 min-w-[180px]">
        <input
          type="text"
          placeholder="Nota (opcional)"
          className="w-full h-9 rounded-md border bg-background px-2 text-xs"
          value={note}
          onChange={e => setNote(e.target.value)}
        />
      </div>
      <Button size="sm" variant="default" onClick={handleSave} disabled={saving || !value}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
        Salvar
      </Button>
      {override && (
        <Button size="sm" variant="outline" onClick={onDelete} disabled={saving}>
          Remover
        </Button>
      )}
    </div>
  );
}

// =====================================================
// Cards de upload
// =====================================================

function UploadBBCard({
  period, ensurePeriod, onAfter,
}: {
  period: AuditPeriod | null;
  ensurePeriod: () => Promise<AuditPeriod | null>;
  onAfter: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const xlsx = files.filter(f => f.name.toLowerCase().endsWith('.xlsx'));
    const invalid = files.length - xlsx.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .xlsx é aceito`);
    if (xlsx.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: xlsx.length });
    const totalBreakdown: Record<string, number> = {};
    let totalImported = 0;
    let totalDuplicates = 0;
    const failures: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < xlsx.length; i++) {
        const file = xlsx[i];
        setProgress({ current: i + 1, total: xlsx.length });
        try {
          const buf = await file.arrayBuffer();
          const workbook = XLSX.read(buf, { type: 'array', cellDates: true });
          const sheetName = workbook.SheetNames[0];
          if (!sheetName) throw new Error('Arquivo sem abas');
          const sheet = workbook.Sheets[sheetName];
          const rows = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1, defval: null, raw: true });
          if (!rows.length) throw new Error('Arquivo vazio');

          const { data, error } = await supabase.functions.invoke('import-bb', {
            body: { audit_period_id: p.id, rows, file_name: file.name },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha na importação');

          totalImported += Number(data.imported_rows ?? 0);
          totalDuplicates += Number(data.duplicate_rows ?? 0);
          for (const [k, n] of Object.entries(data.breakdown_by_category ?? {})) {
            totalBreakdown[k] = (totalBreakdown[k] ?? 0) + Number(n);
          }
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      const breakdown = Object.entries(totalBreakdown)
        .filter(([, n]) => Number(n) > 0)
        .map(([k, n]) => `${k}=${n}`).join(', ') || '—';
      if (failures.length === 0) {
        toast.success(`${totalImported} créditos importados de ${xlsx.length} arquivo(s)`, {
          description: `${totalDuplicates} duplicados ignorados. Categorias: ${breakdown}`,
        });
      } else {
        toast.error(`${failures.length} de ${xlsx.length} falharam`, {
          description: failures.join(' | '),
        });
      }
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <Landmark className="h-5 w-5 text-blue-600" />
        <CardTitle className="text-base">Extrato BB (.xlsx)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          Extrato Banco do Brasil — depósitos voucher categorizados automaticamente
          por descrição (alelo / ticket / pluxee / vr / brendi / outros).
          Para cobrir defasagem, importe <strong>2 meses</strong> (mês competência + posterior).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button
          variant="default"
          className="gap-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar XLSX (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}

function UploadTicketCard({
  period, ensurePeriod, onAfter,
}: {
  period: AuditPeriod | null;
  ensurePeriod: () => Promise<AuditPeriod | null>;
  onAfter: () => Promise<void> | void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [progress, setProgress] = useState<{ current: number; total: number } | null>(null);

  const handleFiles = async (files: File[]) => {
    const pdfs = files.filter(f => f.name.toLowerCase().endsWith('.pdf'));
    const invalid = files.length - pdfs.length;
    if (invalid > 0) toast.error(`${invalid} arquivo(s) ignorado(s) — apenas .pdf é aceito`);
    if (pdfs.length === 0) return;

    setUploading(true);
    setProgress({ current: 0, total: pdfs.length });
    let totalLots = 0;
    let totalItems = 0;
    const failures: string[] = [];
    const allWarnings: string[] = [];
    const allIntegrity: string[] = [];

    try {
      const p = await ensurePeriod();
      if (!p) return;

      for (let i = 0; i < pdfs.length; i++) {
        const file = pdfs[i];
        setProgress({ current: i + 1, total: pdfs.length });
        try {
          const rawText = await extractPdfText(file);
          const { data, error } = await supabase.functions.invoke('import-ticket-pdf', {
            body: { audit_period_id: p.id, file_name: file.name, raw_text: rawText },
          });
          if (error) throw new Error(error.message);
          if (!data?.success) throw new Error(data?.error || 'Falha no import Ticket');

          totalLots += Number(data.inserted_lots ?? 0) + Number(data.updated_lots ?? 0);
          totalItems += Number(data.inserted_items ?? 0);
          for (const w of (data.warnings ?? []) as string[]) allWarnings.push(`${file.name}: ${w}`);
          for (const e of (data.integrity_errors ?? []) as string[]) allIntegrity.push(`${file.name}: ${e}`);
        } catch (e: any) {
          failures.push(`${file.name}: ${e?.message ?? 'erro'}`);
        }
      }

      if (failures.length === 0) {
        toast.success(`${totalLots} lotes / ${totalItems} vendas de ${pdfs.length} arquivo(s)`, {
          description: allIntegrity.length > 0
            ? `⚠ ${allIntegrity.length} divergências de integridade (veja console)`
            : allWarnings.length > 0
              ? `${allWarnings.length} warnings (não crítico)`
              : 'Sem divergências',
        });
      } else {
        toast.error(`${failures.length} de ${pdfs.length} falharam`, {
          description: failures.join(' | '),
        });
      }
      if (allIntegrity.length > 0) console.warn('Integrity:', allIntegrity);
      if (allWarnings.length > 0) console.info('Warnings:', allWarnings);
      await onAfter();
    } finally {
      setUploading(false);
      setProgress(null);
      if (inputRef.current) inputRef.current.value = '';
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3 flex flex-row items-center gap-2 space-y-0">
        <FileText className="h-5 w-5 text-amber-600" />
        <CardTitle className="text-base">Reembolsos Ticket (.pdf)</CardTitle>
      </CardHeader>
      <CardContent className="space-y-2">
        <p className="text-xs text-muted-foreground">
          PDF "Extrato de Reembolsos Detalhado" do portal Ticket Edenred.
          Cada Nº Reembolso vira 1 lote = 1 depósito esperado no BB.
          Pode selecionar mais de 1 PDF (ex: meses separados).
        </p>
        <input
          ref={inputRef}
          type="file"
          accept=".pdf"
          multiple
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files ?? []);
            if (files.length > 0) handleFiles(files);
          }}
        />
        <Button
          variant="default"
          className="gap-2"
          disabled={uploading}
          onClick={() => inputRef.current?.click()}
        >
          {uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <UploadCloud className="h-4 w-4" />}
          {uploading
            ? (progress ? `Importando ${progress.current}/${progress.total}…` : 'Importando…')
            : 'Selecionar PDF (1 ou mais)'}
        </Button>
      </CardContent>
    </Card>
  );
}
