// Controladoria Financeira — módulo independente do Caixa.
// Duas abas: Notas (do Espião) e Contas a Pagar (isoladas em ctrl_contas_pagar).
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ControladoriaNotas from '@/components/controladoria/ControladoriaNotas';
import ControladoriaContasPagar from '@/components/controladoria/ControladoriaContasPagar';

export default function ControladoriaFinanceira() {
  return (
    <AppLayout title="Controladoria Financeira">
      <div className="space-y-6 p-4 md:p-6">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Controladoria Financeira</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Concilie notas fiscais em contas a pagar. Independente do Fluxo de Caixa.
          </p>
        </div>

        <Tabs defaultValue="notas" className="space-y-6">
          <TabsList>
            <TabsTrigger value="notas">Notas</TabsTrigger>
            <TabsTrigger value="contas">Contas a Pagar</TabsTrigger>
          </TabsList>

          <TabsContent value="notas">
            <ControladoriaNotas />
          </TabsContent>

          <TabsContent value="contas">
            <ControladoriaContasPagar />
          </TabsContent>
        </Tabs>
      </div>
    </AppLayout>
  );
}
