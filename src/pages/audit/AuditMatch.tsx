import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { supabase } from '@/integrations/supabase/client';
import { useUserRole } from '@/hooks/useUserRole';
import { toast } from '@/hooks/use-toast';
import { ChevronRight, ChevronDown, Download, Loader2, Search } from 'lucide-react';

type MatchRow = {
  sale_date: string;
  categoria: string;
  total_vendas: number;
  bruto_vendido: number;
  liquido_vendido: number;
  taxa_declarada: number;
  total_depositos: number;
  total_recebido: number;
  primeira_data_dep: string | null;
  ultima_data_dep: string | null;
  lag_medio_dias: number | null;
  taxa_efetiva: number;
  status: string;
};

type DetailRow = {
  source: 'venda' | 'deposito';
  data: string;
  hora: string | null;
  valor: number;
  descricao: string | null;
  doc: string | null;
  match_status: string | null;
  match_reason: string | null;
};

const CATEGORIA_LABELS: Record<string, string> = {
  credito_debito: 'Crédito/Débito',
  pix: 'Pix',
  alelo: 'Alelo',
  ticket: 'Ticket',
  pluxee: 'Pluxee',
  vr: 'VR',
};

const CATEGORIA_BADGE: Record<string, string> = {
  credito_debito: 'bg-blue-500/15 text-blue-700 dark:text-blue-400',
  pix: 'bg-emerald-500/15 text-emerald-700 dark:text-emerald-400',
  alelo: 'bg-orange-500/15 text-orange-700 dark:text-orange-400',
  ticket: 'bg-amber-500/15 text-amber-700 dark:text-amber-400',
  pluxee: 'bg-violet-500/15 text-violet-700 dark:text-violet-400',
  vr: 'bg-pink-500/15 text-pink-700 dark:text-pink-400',
};

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtDate = (iso: string | null) => iso ? new Date(iso + 'T00:00:00').toLocaleDateString('pt-BR') : '—';

function statusBadge(row: MatchRow): { label: string; className: string; icon: string } {
  if (row.status === 'nao_identificado') {
    return { label: 'Não identificado', className: 'bg-amber-500/15 text-amber-700 dark:text-amber-400', icon: '❓' };
  }
  if (row.status === 'fora_periodo') {
    return { label: 'Fora período', className: 'bg-muted text-muted-foreground', icon: '⚪' };
  }
  if (row.status === 'parcial') {
    return { label: 'Parcial', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400', icon: '🟡' };
  }
  // matched - escalate by tax + lag
  const taxa = Number(row.taxa_efetiva || 0);
  const lag = Number(row.lag_medio_dias || 0);
  if (taxa > 10) return { label: 'Crítico', className: 'bg-red-500/15 text-red-700 dark:text-red-400', icon: '🔴' };
  if (taxa > 5 || lag > 10) return { label: 'Alerta', className: 'bg-yellow-500/15 text-yellow-700 dark:text-yellow-400', icon: '🟡' };
  return { label: 'Matched', className: 'bg-green-500/15 text-green-700 dark:text-green-400', icon: '🟢' };
}

function rowKey(r: MatchRow) {
  return `${r.sale_date}__${r.categoria}`;
}

export default function AuditMatch() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { isAdmin, loading: roleLoading } = useUserRole();
  const periodId = searchParams.get('period');

  const [periodLabel, setPeriodLabel] = useState<string>('');
  const [periodStatus, setPeriodStatus] = useState<string | null>(null);
  const [rows, setRows] = useState<MatchRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [details, setDetails] = useState<Record<string, DetailRow[]>>({});
  const [loadingDetail, setLoadingDetail] = useState<Set<string>>(new Set());

  // Filters
  const [filterCategoria, setFilterCategoria] = useState<string>('todas');
  const [filterStatus, setFilterStatus] = useState<string>('todos');
  const [filterDia, setFilterDia] = useState<string>('');
  const [searchText, setSearchText] = useState<string>('');

  useEffect(() => {
    if (!periodId || !isAdmin) return;
    let active = true;
    (async () => {
      setLoading(true);
      const [{ data: per }, { data: bk, error }] = await Promise.all([
        supabase.from('audit_periods').select('month,year,status').eq('id', periodId).maybeSingle(),
        supabase.rpc('get_audit_match_breakdown' as any, { p_period_id: periodId }),
      ]);
      if (!active) return;
      if (error) {
        toast({ title: 'Erro ao carregar dados', description: error.message, variant: 'destructive' });
      }
      if (per) {
        const months = ['Janeiro','Fevereiro','Março','Abril','Maio','Junho','Julho','Agosto','Setembro','Outubro','Novembro','Dezembro'];
        setPeriodLabel(`${months[(per as any).month - 1]} ${(per as any).year}`);
        setPeriodStatus((per as any).status ?? null);
      }
      setRows(((bk as MatchRow[]) ?? []));
      setLoading(false);
    })();
    return () => { active = false; };
  }, [periodId, isAdmin]);

  const filteredRows = useMemo(() => {
    return rows.filter(r => {
      if (filterCategoria !== 'todas' && r.categoria !== filterCategoria) return false;
      if (filterStatus !== 'todos') {
        const sb = statusBadge(r);
        const lower = sb.label.toLowerCase();
        if (filterStatus === 'matched' && lower !== 'matched') return false;
        if (filterStatus === 'alerta' && lower !== 'alerta') return false;
        if (filterStatus === 'critico' && lower !== 'crítico') return false;
        if (filterStatus === 'fora_periodo' && r.status !== 'fora_periodo' && r.status !== 'parcial') return false;
        if (filterStatus === 'nao_identificado' && r.status !== 'nao_identificado') return false;
      }
      if (filterDia) {
        const d = new Date(r.sale_date + 'T00:00:00').getDate();
        if (d !== Number(filterDia)) return false;
      }
      if (searchText) {
        const s = searchText.toLowerCase();
        const hay = `${r.sale_date} ${r.categoria} ${r.bruto_vendido} ${r.total_recebido}`.toLowerCase();
        if (!hay.includes(s)) return false;
      }
      return true;
    });
  }, [rows, filterCategoria, filterStatus, filterDia, searchText]);

  const summary = useMemo(() => {
    const total = rows.length;
    if (total === 0) return null;
    const counts = { matched: 0, fora: 0, naoId: 0 };
    for (const r of rows) {
      if (r.status === 'matched') counts.matched++;
      else if (r.status === 'fora_periodo' || r.status === 'parcial') counts.fora++;
      else if (r.status === 'nao_identificado') counts.naoId++;
    }
    return {
      matched: Math.round(counts.matched / total * 100),
      fora: Math.round(counts.fora / total * 100),
      naoId: Math.round(counts.naoId / total * 100),
    };
  }, [rows]);

  const toggleExpand = async (r: MatchRow) => {
    const key = rowKey(r);
    const next = new Set(expanded);
    if (next.has(key)) {
      next.delete(key);
      setExpanded(next);
      return;
    }
    next.add(key);
    setExpanded(next);
    if (details[key]) return;
    const ld = new Set(loadingDetail);
    ld.add(key);
    setLoadingDetail(ld);
    const { data, error } = await supabase.rpc('get_audit_match_detail' as any, {
      p_period_id: periodId,
      p_sale_date: r.sale_date,
      p_categoria: r.categoria,
    });
    if (error) {
      toast({ title: 'Erro ao carregar detalhe', description: error.message, variant: 'destructive' });
    }
    setDetails(prev => ({ ...prev, [key]: (data as DetailRow[]) ?? [] }));
    const ld2 = new Set(loadingDetail);
    ld2.delete(key);
    setLoadingDetail(ld2);
  };

  const handleExportCsv = () => {
    if (filteredRows.length === 0) return;
    const header = [
      'Data','Categoria','Qtd Vendas','Bruto','Líquido','Taxa Declarada',
      'Qtd Depósitos','Total Recebido','Primeira Data Dep','Última Data Dep',
      'Lag Médio (dias)','Taxa Efetiva (%)','Status',
    ];
    const lines = filteredRows.map(r => {
      const sb = statusBadge(r);
      return [
        fmtDate(r.sale_date),
        CATEGORIA_LABELS[r.categoria] ?? r.categoria,
        r.total_vendas,
        Number(r.bruto_vendido).toFixed(2).replace('.', ','),
        Number(r.liquido_vendido).toFixed(2).replace('.', ','),
        Number(r.taxa_declarada).toFixed(2).replace('.', ','),
        r.total_depositos,
        Number(r.total_recebido).toFixed(2).replace('.', ','),
        fmtDate(r.primeira_data_dep),
        fmtDate(r.ultima_data_dep),
        r.lag_medio_dias != null ? Number(r.lag_medio_dias).toFixed(1).replace('.', ',') : '',
        Number(r.taxa_efetiva).toFixed(2).replace('.', ','),
        sb.label,
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(';');
    });
    const csv = '\uFEFF' + [header.join(';'), ...lines].join('\n');
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `auditoria-match-${periodLabel.replace(' ', '-').toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (roleLoading) return <AppLayout title="Auditoria do Match"><div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div></AppLayout>;
  if (!isAdmin) return <AppLayout title="Auditoria do Match"><Card><CardContent className="py-10 text-center text-muted-foreground">Acesso restrito.</CardContent></Card></AppLayout>;
  if (!periodId) {
    return (
      <AppLayout title="Auditoria do Match">
        <Card><CardContent className="py-10 text-center text-muted-foreground">
          Período não informado. <Button variant="link" onClick={() => navigate('/admin/auditoria')}>Voltar ao dashboard</Button>
        </CardContent></Card>
      </AppLayout>
    );
  }

  const conciliated = periodStatus === 'conciliado' || periodStatus === 'fechado';

  return (
    <AppLayout title="Auditoria do Match" subtitle={periodLabel}>
      <div className="space-y-4">
        {/* Breadcrumb + summary */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="text-sm text-muted-foreground">
            <button className="hover:text-foreground" onClick={() => navigate('/admin/auditoria')}>Auditoria</button>
            <span className="mx-2">›</span>
            <span className="text-foreground font-medium">Auditoria do Match</span>
          </div>
          {summary && (
            <div className="flex items-center gap-3 text-sm">
              <span className="text-muted-foreground">Casamento:</span>
              <Badge className="bg-green-500/15 text-green-700 dark:text-green-400" variant="secondary">🟢 {summary.matched}% matched</Badge>
              <Badge className="bg-muted text-muted-foreground" variant="secondary">⚪ {summary.fora}% fora</Badge>
              <Badge className="bg-amber-500/15 text-amber-700 dark:text-amber-400" variant="secondary">❓ {summary.naoId}% não-id</Badge>
            </div>
          )}
        </div>

        {!conciliated && (
          <Card className="border-yellow-500/50 bg-yellow-500/5">
            <CardContent className="py-3 text-sm">
              ⚠ Execute a conciliação no dashboard antes de auditar matches. Os dados podem estar incompletos.
            </CardContent>
          </Card>
        )}

        {/* Filters */}
        <Card>
          <CardContent className="py-4 flex flex-wrap items-center gap-3">
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Categoria</span>
              <Select value={filterCategoria} onValueChange={setFilterCategoria}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todas">Todas</SelectItem>
                  <SelectItem value="credito_debito">Crédito/Débito</SelectItem>
                  <SelectItem value="pix">Pix</SelectItem>
                  <SelectItem value="alelo">Alelo</SelectItem>
                  <SelectItem value="ticket">Ticket</SelectItem>
                  <SelectItem value="pluxee">Pluxee</SelectItem>
                  <SelectItem value="vr">VR</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Status</span>
              <Select value={filterStatus} onValueChange={setFilterStatus}>
                <SelectTrigger className="w-[170px] h-9"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="todos">Todos</SelectItem>
                  <SelectItem value="matched">🟢 Matched</SelectItem>
                  <SelectItem value="alerta">🟡 Alerta</SelectItem>
                  <SelectItem value="critico">🔴 Crítico</SelectItem>
                  <SelectItem value="fora_periodo">⚪ Fora período</SelectItem>
                  <SelectItem value="nao_identificado">❓ Não identificado</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-xs uppercase text-muted-foreground">Dia</span>
              <Input
                type="number"
                min={1}
                max={31}
                placeholder="1-31"
                value={filterDia}
                onChange={(e) => setFilterDia(e.target.value)}
                className="w-[90px] h-9"
              />
            </div>
            <div className="flex items-center gap-2 flex-1 min-w-[200px]">
              <Search className="h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Buscar valor ou texto..."
                value={searchText}
                onChange={(e) => setSearchText(e.target.value)}
                className="h-9"
              />
            </div>
            <Button variant="outline" size="sm" onClick={handleExportCsv} disabled={filteredRows.length === 0} className="gap-2">
              <Download className="h-4 w-4" /> Exportar CSV
            </Button>
          </CardContent>
        </Card>

        {/* Table */}
        <Card>
          <CardContent className="p-0">
            {loading ? (
              <div className="flex justify-center py-10"><Loader2 className="h-6 w-6 animate-spin" /></div>
            ) : filteredRows.length === 0 ? (
              <div className="py-10 text-center text-muted-foreground text-sm">
                {rows.length === 0
                  ? 'Sem dados para este período. Execute a conciliação no dashboard.'
                  : 'Nenhum casamento encontrado com os filtros aplicados.'}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-[40px]"></TableHead>
                    <TableHead>Data</TableHead>
                    <TableHead>Categoria</TableHead>
                    <TableHead className="text-right">Vendas</TableHead>
                    <TableHead className="text-right">Bruto / Líquido</TableHead>
                    <TableHead className="text-right">Casado com</TableHead>
                    <TableHead className="text-right">Lag</TableHead>
                    <TableHead className="text-right">Taxa efetiva</TableHead>
                    <TableHead>Status</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredRows.map(r => {
                    const key = rowKey(r);
                    const isOpen = expanded.has(key);
                    const sb = statusBadge(r);
                    const detail = details[key];
                    return (
                      <>
                        <TableRow key={key} className="cursor-pointer hover:bg-muted/50" onClick={() => toggleExpand(r)}>
                          <TableCell>
                            {isOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </TableCell>
                          <TableCell className="font-medium">{fmtDate(r.sale_date)}</TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={CATEGORIA_BADGE[r.categoria] ?? ''}>
                              {CATEGORIA_LABELS[r.categoria] ?? r.categoria}
                            </Badge>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">{r.total_vendas}</TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{fmt(Number(r.bruto_vendido))}</div>
                            <div className="text-xs text-muted-foreground">{fmt(Number(r.liquido_vendido))}</div>
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            <div>{r.total_depositos} dep · {fmt(Number(r.total_recebido))}</div>
                            {r.primeira_data_dep && (
                              <div className="text-xs text-muted-foreground">
                                {fmtDate(r.primeira_data_dep)}
                                {r.ultima_data_dep && r.ultima_data_dep !== r.primeira_data_dep ? ` → ${fmtDate(r.ultima_data_dep)}` : ''}
                              </div>
                            )}
                          </TableCell>
                          <TableCell className="text-right tabular-nums">
                            {r.lag_medio_dias != null ? `${Number(r.lag_medio_dias).toFixed(1)}d` : '—'}
                          </TableCell>
                          <TableCell className={`text-right tabular-nums ${Number(r.taxa_efetiva) > 10 ? 'text-red-600 dark:text-red-400 font-semibold' : Number(r.taxa_efetiva) > 5 ? 'text-yellow-700 dark:text-yellow-400' : ''}`}>
                            {Number(r.taxa_efetiva).toFixed(2).replace('.', ',')}%
                          </TableCell>
                          <TableCell>
                            <Badge variant="secondary" className={sb.className}>{sb.icon} {sb.label}</Badge>
                          </TableCell>
                        </TableRow>
                        {isOpen && (
                          <TableRow key={`${key}-detail`} className="bg-muted/30 hover:bg-muted/30">
                            <TableCell colSpan={9} className="py-4">
                              {loadingDetail.has(key) ? (
                                <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin" /></div>
                              ) : !detail || detail.length === 0 ? (
                                <p className="text-sm text-muted-foreground text-center py-2">Sem detalhes disponíveis.</p>
                              ) : (
                                <div className="space-y-4 px-2">
                                  <div>
                                    <h4 className="text-xs uppercase text-muted-foreground mb-2">Vendas na Maquinona</h4>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="h-8">Hora</TableHead>
                                          <TableHead className="h-8 text-right">Bruto</TableHead>
                                          <TableHead className="h-8">Descrição</TableHead>
                                          <TableHead className="h-8">NSU</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {detail.filter(d => d.source === 'venda').map((d, i) => (
                                          <TableRow key={`v-${i}`}>
                                            <TableCell className="py-2">{d.hora ?? '—'}</TableCell>
                                            <TableCell className="py-2 text-right tabular-nums">{fmt(Number(d.valor))}</TableCell>
                                            <TableCell className="py-2">{d.descricao}</TableCell>
                                            <TableCell className="py-2 text-xs text-muted-foreground">{d.doc ?? '—'}</TableCell>
                                          </TableRow>
                                        ))}
                                        {detail.filter(d => d.source === 'venda').length === 0 && (
                                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-2">—</TableCell></TableRow>
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                  <div>
                                    <h4 className="text-xs uppercase text-muted-foreground mb-2">Depósitos no banco</h4>
                                    <Table>
                                      <TableHeader>
                                        <TableRow>
                                          <TableHead className="h-8">Data</TableHead>
                                          <TableHead className="h-8 text-right">Valor</TableHead>
                                          <TableHead className="h-8">Histórico</TableHead>
                                          <TableHead className="h-8">Doc</TableHead>
                                        </TableRow>
                                      </TableHeader>
                                      <TableBody>
                                        {detail.filter(d => d.source === 'deposito').map((d, i) => (
                                          <TableRow key={`d-${i}`}>
                                            <TableCell className="py-2">{fmtDate(d.data)}</TableCell>
                                            <TableCell className="py-2 text-right tabular-nums">{fmt(Number(d.valor))}</TableCell>
                                            <TableCell className="py-2 text-xs">{d.descricao ?? '—'}</TableCell>
                                            <TableCell className="py-2 text-xs text-muted-foreground">{d.doc ?? '—'}</TableCell>
                                          </TableRow>
                                        ))}
                                        {detail.filter(d => d.source === 'deposito').length === 0 && (
                                          <TableRow><TableCell colSpan={4} className="text-center text-muted-foreground py-2">—</TableCell></TableRow>
                                        )}
                                      </TableBody>
                                    </Table>
                                  </div>
                                  <div className="bg-background border rounded-md p-3 text-sm space-y-1">
                                    <div className="font-medium mb-1">📊 Análise</div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Lag médio:</span><span className="tabular-nums">{r.lag_medio_dias != null ? `${Number(r.lag_medio_dias).toFixed(1)} dias` : '—'}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Diferença:</span><span className="tabular-nums">{fmt(Number(r.bruto_vendido) - Number(r.total_recebido))}</span></div>
                                    <div className="flex justify-between"><span className="text-muted-foreground">Taxa efetiva:</span><span className="tabular-nums">{Number(r.taxa_efetiva).toFixed(2).replace('.', ',')}%</span></div>
                                    {detail.find(d => d.source === 'deposito' && d.match_reason) && (
                                      <div className="text-xs text-muted-foreground italic pt-1 border-t mt-2">
                                        {detail.find(d => d.source === 'deposito' && d.match_reason)?.match_reason}
                                      </div>
                                    )}
                                  </div>
                                </div>
                              )}
                            </TableCell>
                          </TableRow>
                        )}
                      </>
                    );
                  })}
                </TableBody>
              </Table>
            )}
          </CardContent>
        </Card>
      </div>
    </AppLayout>
  );
}
