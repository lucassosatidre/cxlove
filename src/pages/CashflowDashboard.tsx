// Fluxo de Caixa — Visão Geral simples + abas de detalhe.

import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SaldoDeHoje from '@/components/cashflow/SaldoDeHoje';
import ProjecaoAlertas from '@/components/cashflow/ProjecaoAlertas';
import ImportacoesCashflow from '@/components/cashflow/ImportacoesCashflow';
import FluxoMensal from '@/components/cashflow/FluxoMensal';
import ParaOndeFoi from '@/components/cashflow/ParaOndeFoi';
import ProximosPagamentos from '@/components/cashflow/ProximosPagamentos';
import PagamentosDeHoje from '@/components/cashflow/PagamentosDeHoje';
import DescontadoNaFonte from '@/components/cashflow/DescontadoNaFonte';
import ExtratosPorConta from '@/components/cashflow/ExtratosPorConta';
import ConferenciaSaiposBanco from '@/components/cashflow/ConferenciaSaiposBanco';

export default function CashflowDashboard() {
  return (
    <AppLayout title="Fluxo de Caixa">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fluxo de Caixa</h1>
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
            <PagamentosDeHoje />
            <ProximosPagamentos />
            {/* DescontadoNaFonte desativado por solicitacao (2026-06-30) */}
            {/* <DescontadoNaFonte /> */}
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
