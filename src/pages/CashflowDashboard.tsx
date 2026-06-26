// Fluxo de Caixa — Visão Geral + Importações em abas.

import AppLayout from '@/components/AppLayout';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { TrendingUp, PieChart } from 'lucide-react';
import SaldoDeHoje from '@/components/cashflow/SaldoDeHoje';
import ProjecaoAlertas from '@/components/cashflow/ProjecaoAlertas';
import ImportacoesCashflow from '@/components/cashflow/ImportacoesCashflow';

const placeholders = [
  { icon: TrendingUp, title: 'Fluxo mensal', desc: 'Entrou, saiu e sobrou por mês, por conta e consolidado.' },
  { icon: PieChart, title: 'Para onde foi o dinheiro', desc: 'Saídas agrupadas por categoria.' },
];

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
            <div className="grid gap-4 md:grid-cols-2">
              {placeholders.map(({ icon: Icon, title, desc }) => (
                <Card key={title} className="border-border/60">
                  <CardHeader className="flex flex-row items-center gap-3 space-y-0">
                    <div className="rounded-lg bg-primary/10 p-2 text-primary">
                      <Icon className="h-5 w-5" />
                    </div>
                    <CardTitle className="text-base font-semibold">{title}</CardTitle>
                  </CardHeader>
                  <CardContent>
                    <p className="text-sm text-muted-foreground">{desc}</p>
                    <div className="mt-4 rounded-md border border-dashed border-border/60 px-3 py-6 text-center text-xs uppercase tracking-wider text-muted-foreground">
                      Em breve
                    </div>
                  </CardContent>
                </Card>
              ))}
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
