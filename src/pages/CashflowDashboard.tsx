// Fluxo de Caixa — Visão Geral simples + abas de detalhe.

import { useQuery } from '@tanstack/react-query';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SaldoDeHoje from '@/components/cashflow/SaldoDeHoje';
import ProjecaoAlertas from '@/components/cashflow/ProjecaoAlertas';
import ImportacoesCashflow from '@/components/cashflow/ImportacoesCashflow';
import FluxoMensal from '@/components/cashflow/FluxoMensal';
import ParaOndeFoi from '@/components/cashflow/ParaOndeFoi';
import ProximosPagamentos from '@/components/cashflow/ProximosPagamentos';
import DescontadoNaFonte from '@/components/cashflow/DescontadoNaFonte';
import ExtratosPorConta from '@/components/cashflow/ExtratosPorConta';
import ConferenciaSaiposBanco from '@/components/cashflow/ConferenciaSaiposBanco';
import { supabase } from '@/integrations/supabase/client';

function useLastImportAt() {
  return useQuery({
    queryKey: ['cashflow', 'last-import-at'],
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('cashflow_imports')
        .select('created_at')
        .order('created_at', { ascending: false })
        .limit(1);
      if (error) throw error;
      return data?.[0]?.created_at ?? null;
    },
  });
}

function UpdateBadge() {
  const { data, isLoading } = useLastImportAt();
  if (isLoading) {
    return <p className="text-xs text-muted-foreground mt-1">Carregando última importação…</p>;
  }
  if (!data) {
    return (
      <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
        <span className="inline-block h-2 w-2 rounded-full bg-muted-foreground/40" />
        Sem importações ainda
      </div>
    );
  }
  const d = new Date(data);
  const now = new Date();
  const ageDays = Math.floor((now.getTime() - d.getTime()) / (1000 * 60 * 60 * 24));
  let dot = 'bg-emerald-500';
  if (ageDays > 4) dot = 'bg-destructive';
  else if (ageDays >= 2) dot = 'bg-amber-500';
  const fmt = `${String(d.getDate()).padStart(2, '0')}/${String(d.getMonth() + 1).padStart(2, '0')}/${d.getFullYear()} às ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return (
    <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground">
      <span className={`inline-block h-2 w-2 rounded-full ${dot}`} />
      Atualizado em {fmt}
    </div>
  );
}

export default function CashflowDashboard() {
  return (
    <AppLayout title="Fluxo de Caixa">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fluxo de Caixa</h1>
          <UpdateBadge />
        </div>

        <Tabs defaultValue="visao" className="space-y-6">
          <TabsList>
            <TabsTrigger value="visao">Visão Geral</TabsTrigger>
            <TabsTrigger value="extratos">Extratos</TabsTrigger>
            <TabsTrigger value="conferencia">Conferência</TabsTrigger>
            <TabsTrigger value="import">Importações</TabsTrigger>
            <TabsTrigger value="detalhes">Mais detalhes</TabsTrigger>
          </TabsList>

          <TabsContent value="visao" className="space-y-6">
            <SaldoDeHoje />
            <ProximosPagamentos />
          </TabsContent>

          <TabsContent value="extratos">
            <ExtratosPorConta />
          </TabsContent>

          <TabsContent value="conferencia">
            <ConferenciaSaiposBanco />
          </TabsContent>

          <TabsContent value="import">
            <ImportacoesCashflow />
          </TabsContent>

          <TabsContent value="detalhes" className="space-y-6">
            <div className="grid gap-4 lg:grid-cols-2">
              <FluxoMensal />
              <ParaOndeFoi />
            </div>
            <ProjecaoAlertas />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
