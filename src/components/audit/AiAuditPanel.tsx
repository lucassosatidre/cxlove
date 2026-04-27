import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Loader2, RefreshCw, AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useToast } from '@/hooks/use-toast';

const fmtBRL = (v: number) => Number(v || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const fmtUSD = (v: number) => `US$ ${Number(v || 0).toFixed(4)}`;

interface Props {
  periodId: string;
  /** Optional initial result returned by run-audit-match (already includes ai_audits.voucher and .ifood). */
  initialResult?: any;
}

export default function AiAuditPanel({ periodId, initialResult }: Props) {
  const { toast } = useToast();
  const [voucher, setVoucher] = useState<any>(initialResult?.voucher ?? null);
  const [ifood, setIfood] = useState<any>(initialResult?.ifood ?? null);
  const [loadingVoucher, setLoadingVoucher] = useState(false);
  const [loadingIfood, setLoadingIfood] = useState(false);

  // Load latest cached audits + poll while results are missing
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null;
    let stopTimeout: ReturnType<typeof setTimeout> | null = null;
    let cancelled = false;

    const checkResults = async () => {
      const [{ data: v }, { data: i }] = await Promise.all([
        supabase.from('voucher_ai_audits')
          .select('result, cost_usd, total_recebido_competencia, total_taxa_real, items_matched, items_ambiguous, items_orphan, lots_matched_bb, created_at, error')
          .eq('audit_period_id', periodId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
        supabase.from('ifood_ai_audits')
          .select('status, summary, anomalies, recommendations, cost_usd, created_at, error')
          .eq('audit_period_id', periodId)
          .order('created_at', { ascending: false }).limit(1).maybeSingle(),
      ]);
      if (cancelled) return;
      if (v) setVoucher((prev: any) => prev?.results ? prev : { cached: true, ...v });
      if (i) setIfood((prev: any) => prev?.summary && !prev?.cached ? prev : { cached: true, ...i });
      if (v && i && interval) { clearInterval(interval); interval = null; }
    };

    // Initial load (always) — even if initialResult exists, fetch latest persisted version
    checkResults();

    // Poll only if we don't have full results yet
    interval = setInterval(checkResults, 15000);
    stopTimeout = setTimeout(() => { if (interval) { clearInterval(interval); interval = null; } }, 300000);

    return () => {
      cancelled = true;
      if (interval) clearInterval(interval);
      if (stopTimeout) clearTimeout(stopTimeout);
    };
  }, [periodId, initialResult]);

  const rerun = async (which: 'voucher' | 'ifood') => {
    const fnName = which === 'voucher' ? 'reconcile-vouchers-ai' : 'audit-ifood-ai';
    if (which === 'voucher') setLoadingVoucher(true); else setLoadingIfood(true);
    try {
      const { data, error } = await supabase.functions.invoke(fnName, {
        body: { period_id: periodId, force_refresh: true },
      });
      if (error) throw error;
      if ((data as any)?.error) throw new Error((data as any).error);
      if (which === 'voucher') setVoucher(data); else setIfood(data);
      toast({ title: '✓ Auditoria IA atualizada' });
    } catch (e: any) {
      toast({ title: 'Erro IA', description: e.message, variant: 'destructive' });
    } finally {
      if (which === 'voucher') setLoadingVoucher(false); else setLoadingIfood(false);
    }
  };

  const statusBadge = (s: string) => {
    if (s === 'critical') return <Badge variant="destructive">Crítico</Badge>;
    if (s === 'warnings') return <Badge className="bg-yellow-500/20 text-yellow-700 dark:text-yellow-400">Avisos</Badge>;
    return <Badge className="bg-green-500/20 text-green-700 dark:text-green-400">OK</Badge>;
  };

  return (
    <div className="grid gap-4 md:grid-cols-2">
      {/* Voucher AI */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Reconciliação IA Voucher</CardTitle>
          </div>
          <Button size="sm" variant="ghost" onClick={() => rerun('voucher')} disabled={loadingVoucher}>
            {loadingVoucher ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!voucher && (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Reconciliando vouchers com IA... aguarde ~2 min
            </p>
          )}
          {voucher?.error && <p className="text-destructive">Erro: {String(voucher.error)}</p>}
          {voucher && !voucher.error && (
            <>
              {voucher.cached && <Badge variant="outline" className="text-xs">cache</Badge>}
              {voucher.results && (
                <div className="space-y-1">
                  {Object.entries(voucher.results).map(([op, r]: [string, any]) => (
                    <div key={op} className="flex justify-between text-xs">
                      <span className="uppercase">{op}</span>
                      {r?.skipped ? <span className="text-muted-foreground">sem dados</span>
                        : r?.error ? <span className="text-destructive">erro</span>
                        : (
                          <span>
                            {(r.items_matched ?? []).length}m / {(r.items_ambiguous ?? []).length}a / {(r.items_orphan ?? []).length}o
                            {' · '}
                            {fmtBRL(r.summary?.total_recebido_competencia ?? 0)}
                            {' · '}
                            {Number(r.summary?.taxa_real_pct ?? 0).toFixed(2)}%
                          </span>
                        )}
                    </div>
                  ))}
                </div>
              )}
              {typeof voucher.total_cost_usd === 'number' && (
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Custo: {fmtUSD(voucher.total_cost_usd)} · {voucher.total_tokens ?? 0} tokens · {Math.round((voucher.duration_ms ?? 0)/1000)}s
                </p>
              )}
              {voucher.cost_usd != null && voucher.total_recebido_competencia != null && (
                <p className="text-xs text-muted-foreground pt-2 border-t">
                  Recebido competência: {fmtBRL(voucher.total_recebido_competencia)} · Taxa real: {Number(voucher.total_taxa_real ?? 0).toFixed(2)}% · {fmtUSD(voucher.cost_usd)}
                </p>
              )}
            </>
          )}
        </CardContent>
      </Card>

      {/* iFood AI */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-primary" />
            <CardTitle className="text-base">Auditoria IA iFood</CardTitle>
            {ifood?.status && statusBadge(ifood.status)}
          </div>
          <Button size="sm" variant="ghost" onClick={() => rerun('ifood')} disabled={loadingIfood}>
            {loadingIfood ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2 text-sm">
          {!ifood && (
            <p className="text-muted-foreground flex items-center gap-2">
              <Loader2 className="h-3 w-3 animate-spin" />
              Auditando iFood com IA... aguarde ~1 min
            </p>
          )}
          {ifood?.error && <p className="text-destructive">Erro: {String(ifood.error)}</p>}
          {ifood && !ifood.error && (
            <>
              {ifood.cached && <Badge variant="outline" className="text-xs">cache</Badge>}
              {ifood.summary && <p>{ifood.summary}</p>}
              {Array.isArray(ifood.anomalies) && ifood.anomalies.length > 0 && (
                <div className="space-y-1 pt-2 border-t">
                  <p className="text-xs font-semibold flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3 text-yellow-500" /> Anomalias ({ifood.anomalies.length})
                  </p>
                  {ifood.anomalies.slice(0, 5).map((a: any, idx: number) => (
                    <div key={idx} className="text-xs flex justify-between gap-2">
                      <span className="text-muted-foreground">{a.day} · {a.type}</span>
                      <span className="text-right">{a.description}</span>
                    </div>
                  ))}
                </div>
              )}
              {Array.isArray(ifood.anomalies) && ifood.anomalies.length === 0 && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <CheckCircle2 className="h-3 w-3 text-green-500" /> Nenhuma anomalia detectada.
                </p>
              )}
              {Array.isArray(ifood.recommendations) && ifood.recommendations.length > 0 && (
                <ul className="text-xs list-disc pl-4 pt-2 border-t space-y-0.5">
                  {ifood.recommendations.map((r: string, i: number) => <li key={i}>{r}</li>)}
                </ul>
              )}
              {ifood.cost_usd != null && (
                <p className="text-xs text-muted-foreground pt-2 border-t">Custo: {fmtUSD(ifood.cost_usd)}</p>
              )}
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
