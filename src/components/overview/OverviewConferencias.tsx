import { useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  CalendarDays, Bike, Store, ChevronRight, CheckCircle2,
  AlertTriangle, ArrowRight, Activity,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { getOperationalDate } from '@/lib/operational-date';

interface ClosingRow {
  id: string;
  closing_date: string;
  status: string;
  reconciliation_status: string;
}
interface DayEntry { date: string; tele: ClosingRow | null; salon: ClosingRow | null; }

interface Props {
  days: DayEntry[];
  loading: boolean;
  isAdmin: boolean;
}

const fmtBRL = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n ?? 0);

const formatDate = (s: string) => { const [y, m, d] = s.split('-'); return `${d}/${m}/${y}`; };
const getWeekday = (s: string) => {
  const [y, m, d] = s.split('-');
  return new Date(+y, +m - 1, +d).toLocaleDateString('pt-BR', { weekday: 'short' });
};
const getProgress = (c: ClosingRow | null) => {
  if (!c) return 0;
  let p = 0;
  if (c.status === 'completed') p += 50;
  if (c.reconciliation_status === 'completed') p += 50;
  return p;
};
const dayProgress = (d: DayEntry) => {
  const parts: number[] = [];
  if (d.tele) parts.push(getProgress(d.tele));
  if (d.salon) parts.push(getProgress(d.salon));
  if (parts.length === 0) return 0;
  return Math.round(parts.reduce((a, b) => a + b, 0) / parts.length);
};

// ─── Sub-components ────────────────────────────────────

function ProgressRing({ value, size = 120, stroke = 10 }: { value: number; size?: number; stroke?: number }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const off = c - (value / 100) * c;
  return (
    <svg width={size} height={size} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} stroke="rgba(255,255,255,0.12)" strokeWidth={stroke} fill="none" />
      <circle
        cx={size / 2} cy={size / 2} r={r}
        stroke="hsl(var(--gold-500, 42 67% 49%))"
        strokeWidth={stroke} fill="none"
        strokeDasharray={c} strokeDashoffset={off}
        strokeLinecap="round"
        style={{ transition: 'stroke-dashoffset 0.6s ease' }}
      />
    </svg>
  );
}

function StatusChip({ label, ok, missing }: { label: string; ok: boolean; missing?: boolean }) {
  if (missing) {
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-white/5 border border-white/10 px-3 py-1 text-xs font-medium text-white/60">
        <span className="h-1.5 w-1.5 rounded-full bg-white/30" /> {label}: —
      </span>
    );
  }
  return (
    <span className={cn(
      'inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium border',
      ok
        ? 'bg-emerald-500/15 border-emerald-400/30 text-emerald-200'
        : 'bg-amber-500/15 border-amber-400/30 text-amber-200',
    )}>
      <span className={cn('h-1.5 w-1.5 rounded-full', ok ? 'bg-emerald-400' : 'bg-amber-400')} />
      {label}: {ok ? 'conferido' : 'a conferir'}
    </span>
  );
}

function StatBadge({ closing, label }: { closing: ClosingRow | null; label: string }) {
  if (!closing) return <Badge className="bg-muted text-muted-foreground text-[10px]">Sem {label}</Badge>;
  const done = closing.status === 'completed' && closing.reconciliation_status === 'completed';
  const partial = closing.status === 'completed' || closing.reconciliation_status === 'completed';
  if (done) return <Badge className="bg-emerald-500/15 text-emerald-600 border-emerald-500/30 text-[10px]">100%</Badge>;
  if (partial) return <Badge className="bg-amber-500/15 text-amber-700 border-amber-500/30 text-[10px]">50%</Badge>;
  return <Badge className="bg-muted text-muted-foreground text-[10px]">0%</Badge>;
}

function StatusDot({ closing }: { closing: ClosingRow | null }) {
  const p = getProgress(closing);
  const color = !closing ? 'bg-muted-foreground/30' : p === 100 ? 'bg-emerald-500' : p > 0 ? 'bg-amber-500' : 'bg-destructive/60';
  return <span className={cn('h-2.5 w-2.5 rounded-full', color)} />;
}

// ─── Main component ────────────────────────────────────

export default function OverviewConferencias({ days, loading, isAdmin }: Props) {
  const navigate = useNavigate();
  const todayStr = useMemo(() => getOperationalDate(), []);
  const prevStr = useMemo(() => {
    const [y, m, d] = todayStr.split('-').map(Number);
    const dt = new Date(y, m - 1, d);
    dt.setDate(dt.getDate() - 1);
    const yyyy = dt.getFullYear();
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${yyyy}-${mm}-${dd}`;
  }, [todayStr]);

  const target = useMemo(() => {
    const exact = days.find((d) => d.date === prevStr);
    if (exact) return exact;
    return days.find((d) => d.date < todayStr) ?? null;
  }, [days, prevStr, todayStr]);

  const targetProgress = target ? dayProgress(target) : 0;
  const targetBoxes = (target?.tele ? 1 : 0) + (target?.salon ? 1 : 0);
  const targetDoneBoxes =
    (target?.tele && getProgress(target.tele) === 100 ? 1 : 0) +
    (target?.salon && getProgress(target.salon) === 100 ? 1 : 0);

  const handleConferirTarget = () => {
    if (!target) return;
    if (target.tele && getProgress(target.tele) < 100) navigate(`/reconciliation/${target.tele.id}`);
    else if (target.salon && getProgress(target.salon) < 100) navigate(`/salon/closing/${target.salon.id}`);
    else navigate('/tele');
  };

  // ── Pendências ──
  const pending = days
    .filter((d) => dayProgress(d) < 100)
    .slice(0, 5)
    .map((d) => {
      const ageDays = Math.floor((Date.now() - new Date(d.date + 'T00:00:00').getTime()) / 86400000);
      const tone = ageDays > 3 ? 'destructive' : 'warning';
      const parts: string[] = [];
      if (d.tele && getProgress(d.tele) < 100) parts.push('Tele');
      if (d.salon && getProgress(d.salon) < 100) parts.push('Salão');
      return { day: d, tone, ageDays, label: parts.join(' e ') };
    });

  // ── Mini chart (últimos 14 dias) ──
  const last14 = useMemo(() => {
    const arr: { date: string; pct: number }[] = [];
    for (let i = 13; i >= 0; i--) {
      const dt = new Date(); dt.setDate(dt.getDate() - i);
      const s = dt.toISOString().slice(0, 10);
      const entry = days.find((d) => d.date === s);
      arr.push({ date: s, pct: entry ? dayProgress(entry) : 0 });
    }
    return arr;
  }, [days]);

  const chartW = 600, chartH = 110, padX = 8, padY = 8;
  const barW = (chartW - padX * 2) / last14.length - 4;

  // ─── Render ───
  return (
    <div className="space-y-6">
      {/* ═══ 1. HOJE ═══ */}
      <div className="relative overflow-hidden rounded-2xl border border-[hsl(var(--gold-500,42_67%_49%))]/20 shadow-xl"
        style={{ background: 'linear-gradient(135deg, #061A33 0%, #0B2545 60%, #061A33 100%)' }}>
        <div className="absolute inset-0 opacity-20 pointer-events-none"
          style={{ background: 'radial-gradient(circle at 85% 20%, rgba(201,151,46,0.4), transparent 60%)' }} />
        <div className="relative grid md:grid-cols-[1fr_auto] gap-6 p-6 md:p-8 text-white">
          <div className="space-y-4">
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-[hsl(var(--gold-300,42_85%_72%))]/80">A conferir</p>
              <h2 className="font-serif text-2xl md:text-3xl mt-1 capitalize">
                {target
                  ? `${getWeekday(target.date)}, ${formatDate(target.date)}`
                  : `${getWeekday(prevStr)}, ${formatDate(prevStr)}`}
              </h2>
              <p className="text-sm text-white/60 mt-1">
                {!target
                  ? 'Nenhum caixa anterior registrado.'
                  : targetProgress === 100
                    ? 'Caixa do dia anterior conferido.'
                    : 'Caixa do dia anterior — pronto para conferir.'}
              </p>
            </div>

            {target && (
              <div className="flex flex-wrap gap-2">
                <StatusChip label="Tele" ok={getProgress(target.tele) === 100} missing={!target.tele} />
                <StatusChip label="Salão" ok={getProgress(target.salon) === 100} missing={!target.salon} />
                <StatusChip
                  label="Conciliação"
                  ok={
                    (!target.tele || target.tele.reconciliation_status === 'completed') &&
                    (!target.salon || target.salon.reconciliation_status === 'completed')
                  }
                />
              </div>
            )}

            <div>
              <Button
                onClick={target ? handleConferirTarget : () => navigate('/tele')}
                className="bg-[hsl(var(--gold-500,42_67%_49%))] hover:bg-[hsl(var(--gold-700,32_72%_31%))] text-[#061A33] font-semibold gap-2"
              >
                {target ? 'Conferir agora' : 'Abrir caixas'} <ArrowRight className="h-4 w-4" />
              </Button>
            </div>
          </div>

          <div className="flex items-center gap-4 md:gap-6 md:justify-end">
            <div className="relative">
              <ProgressRing value={targetProgress} />
              <div className="absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-3xl font-bold tabular-nums">{targetProgress}%</span>
                <span className="text-[10px] uppercase tracking-wider text-white/60 mt-0.5">Conferido</span>
              </div>
            </div>
            <div className="text-sm text-white/70 max-w-[140px]">
              {target
                ? <>
                    <span className="text-white font-medium tabular-nums">{targetDoneBoxes}</span> de{' '}
                    <span className="text-white font-medium tabular-nums">{targetBoxes}</span> caixas do dia
                  </>
                : 'Sem caixa anterior registrado'}
            </div>
          </div>
        </div>
      </div>

      {/* ═══ 2 + 3. Ação + Mini-gráfico ═══ */}
      <div className="grid lg:grid-cols-2 gap-4">
        {/* Precisa de ação */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Precisa de ação</h3>
            <AlertTriangle className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-3">
            {pending.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-10 text-center">
                <div className="h-12 w-12 rounded-full bg-emerald-500/15 flex items-center justify-center mb-3">
                  <CheckCircle2 className="h-6 w-6 text-emerald-600" />
                </div>
                <p className="font-medium text-foreground">Tudo em dia ✅</p>
                <p className="text-xs text-muted-foreground mt-1">Nenhuma conferência pendente.</p>
              </div>
            ) : (
              <ul className="space-y-2">
                {pending.map(({ day, tone, ageDays, label }) => (
                  <li key={day.date}>
                    <button
                      onClick={() => {
                        if (day.tele && getProgress(day.tele) < 100) navigate(`/reconciliation/${day.tele.id}`);
                        else if (day.salon && getProgress(day.salon) < 100) navigate(`/salon/closing/${day.salon.id}`);
                      }}
                      className="w-full flex items-center gap-3 rounded-xl border border-border bg-background hover:bg-muted/50 transition-colors p-3 text-left"
                    >
                      <span className={cn('h-10 w-1 rounded-full', tone === 'destructive' ? 'bg-destructive' : 'bg-amber-500')} />
                      <div className="flex-1 min-w-0">
                        <p className="text-sm font-medium text-foreground">
                          Conferência pendente — {formatDate(day.date)} ({label})
                        </p>
                        <p className="text-xs text-muted-foreground capitalize">
                          {getWeekday(day.date)} · {ageDays === 0 ? 'hoje' : `há ${ageDays} dia${ageDays === 1 ? '' : 's'}`}
                        </p>
                      </div>
                      <ChevronRight className="h-4 w-4 text-muted-foreground shrink-0" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        {/* Mini-gráfico últimos 14 dias */}
        <div className="rounded-2xl border border-border bg-card shadow-sm">
          <div className="flex items-center justify-between px-5 py-4 border-b border-border">
            <h3 className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">Conferência — últimos 14 dias</h3>
            <Activity className="h-4 w-4 text-muted-foreground" />
          </div>
          <div className="p-5">
            <svg viewBox={`0 0 ${chartW} ${chartH + 30}`} className="w-full h-auto">
              {/* baseline */}
              <line x1={padX} x2={chartW - padX} y1={chartH + padY} y2={chartH + padY} stroke="hsl(var(--border))" />
              {last14.map((b, i) => {
                const h = (b.pct / 100) * (chartH - padY * 2);
                const x = padX + i * (barW + 4);
                const y = chartH + padY - h;
                const isLast = i === last14.length - 1;
                const color = isLast
                  ? 'hsl(var(--gold-500, 42 67% 49%))'
                  : b.pct === 100 ? 'hsl(142 70% 38%)' : b.pct > 0 ? 'hsl(38 92% 50%)' : 'hsl(var(--muted))';
                return (
                  <g key={b.date}>
                    <rect x={x} y={y} width={barW} height={Math.max(h, 2)} fill={color} rx={3} />
                    <text x={x + barW / 2} y={chartH + padY + 14} textAnchor="middle"
                      fontSize="9" fill="hsl(var(--muted-foreground))">
                      {b.date.slice(8, 10)}
                    </text>
                  </g>
                );
              })}
            </svg>
            <p className="text-xs text-muted-foreground mt-2">% de conclusão por dia. Hoje destacado em dourado.</p>
          </div>
        </div>
      </div>

      {/* ═══ 5. TODOS OS DIAS ═══ */}
      <div className="bg-card rounded-2xl shadow-sm border border-border overflow-hidden">
        <div className="px-5 py-4 border-b border-border">
          <h2 className="text-base font-semibold text-foreground">Todos os Dias</h2>
        </div>
        {loading ? (
          <div className="flex justify-center py-12">
            <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
          </div>
        ) : days.length === 0 ? (
          <div className="text-center py-16">
            <CalendarDays className="h-12 w-12 text-muted-foreground mx-auto mb-4" />
            <h3 className="text-lg font-medium text-foreground mb-2">Nenhum dia registrado</h3>
            <p className="text-sm text-muted-foreground">Importe dados na aba Tele ou Salão para começar.</p>
          </div>
        ) : (
          <div className="divide-y divide-border">
            {days.map((day) => {
              const total = dayProgress(day);
              return (
                <div key={day.date} className="p-4 hover:bg-muted/30 transition-colors">
                  <div className="flex items-center justify-between mb-3">
                    <div className="flex items-center gap-3">
                      <div className="h-10 w-10 rounded-xl bg-primary/10 flex items-center justify-center">
                        <CalendarDays className="h-5 w-5 text-primary" />
                      </div>
                      <div>
                        <p className="font-semibold text-foreground">{formatDate(day.date)}</p>
                        <p className="text-xs text-muted-foreground capitalize">{getWeekday(day.date)}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-semibold text-foreground tabular-nums">{total}%</span>
                      <div className="w-28 h-2 bg-muted rounded-full overflow-hidden">
                        <div
                          className="h-full rounded-full transition-all"
                          style={{
                            width: `${total}%`,
                            background: 'linear-gradient(90deg, hsl(var(--gold-300,42 85% 72%)), hsl(var(--gold-500,42 67% 49%)) 60%, hsl(var(--gold-700,32 72% 31%)))',
                          }}
                        />
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {day.tele && (
                      <button onClick={() => navigate(`/reconciliation/${day.tele!.id}`)}
                        className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors group text-left">
                        <div className="flex items-center gap-2">
                          <StatusDot closing={day.tele} />
                          <Bike className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-semibold text-foreground">Tele</p>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                              <span className={cn(day.tele.status === 'completed' ? 'text-emerald-600' : 'text-amber-600')}>
                                Conf {day.tele.status === 'completed' ? '✓' : '○'}
                              </span>
                              <span className={cn(day.tele.reconciliation_status === 'completed' ? 'text-emerald-600' : 'text-amber-600')}>
                                Conc {day.tele.reconciliation_status === 'completed' ? '✓' : '○'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatBadge closing={day.tele} label="Tele" />
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
                        </div>
                      </button>
                    )}
                    {day.salon && (
                      <button onClick={() => navigate(`/salon/closing/${day.salon!.id}`)}
                        className="flex items-center justify-between bg-muted/50 rounded-lg px-3 py-2.5 hover:bg-muted transition-colors group text-left">
                        <div className="flex items-center gap-2">
                          <StatusDot closing={day.salon} />
                          <Store className="h-4 w-4 text-muted-foreground" />
                          <div>
                            <p className="text-xs font-semibold text-foreground">Salão</p>
                            <div className="flex items-center gap-1.5 mt-0.5 text-[10px]">
                              <span className={cn(day.salon.status === 'completed' ? 'text-emerald-600' : 'text-amber-600')}>
                                Conf {day.salon.status === 'completed' ? '✓' : '○'}
                              </span>
                              <span className={cn(day.salon.reconciliation_status === 'completed' ? 'text-emerald-600' : 'text-amber-600')}>
                                Conc {day.salon.reconciliation_status === 'completed' ? '✓' : '○'}
                              </span>
                            </div>
                          </div>
                        </div>
                        <div className="flex items-center gap-2">
                          <StatBadge closing={day.salon} label="Salão" />
                          <ChevronRight className="h-3.5 w-3.5 text-muted-foreground group-hover:text-foreground" />
                        </div>
                      </button>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Indicator card ────────────────────────────────────
function IndicatorCard({
  accent, icon, label, value, footer,
}: { accent: string; icon: React.ReactNode; label: string; value: string; footer: string }) {
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border bg-card shadow-sm">
      <div className={cn('h-1 w-full', accent)} />
      <div className="p-5">
        <div className="flex items-center justify-between mb-3">
          <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
          <span className="text-muted-foreground">{icon}</span>
        </div>
        <p className="font-serif text-3xl text-foreground tabular-nums leading-none">{value}</p>
        <p className="text-xs text-muted-foreground mt-3">{footer}</p>
      </div>
    </div>
  );
}
