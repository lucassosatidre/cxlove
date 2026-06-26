// Fluxo de Caixa — Visão Geral + Importações em abas.

import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SaldoDeHoje from '@/components/cashflow/SaldoDeHoje';
import ProjecaoAlertas from '@/components/cashflow/ProjecaoAlertas';
import ImportacoesCashflow from '@/components/cashflow/ImportacoesCashflow';
import FluxoMensal from '@/components/cashflow/FluxoMensal';
import ParaOndeFoi from '@/components/cashflow/ParaOndeFoi';

export default function CashflowDashboard() {
  return (
    <AppLayout title="Fluxo de Caixa">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Fluxo de Caixa</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Estrela · Propósito · Prover — visão de caixa consolidada.
          </p>
        </div>

        <Tabs defaultValue="visao" className="space-y-6">
          <TabsList>
            <TabsTrigger value="visao">Visão Geral</TabsTrigger>
            <TabsTrigger value="import">Importações</TabsTrigger>
          </TabsList>

          <TabsContent value="visao" className="space-y-6">
            <SaldoDeHoje />
            <div className="grid gap-4 lg:grid-cols-2">
              <FluxoMensal />
              <ParaOndeFoi />
            </div>
            <ProjecaoAlertas />
          </TabsContent>

          <TabsContent value="import">
            <ImportacoesCashflow />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
