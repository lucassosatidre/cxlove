// Controladoria Financeira — módulo independente do Caixa.
import { useEffect, useState } from 'react';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import ControladoriaNotas from '@/components/controladoria/ControladoriaNotas';
import ControladoriaContasPagar from '@/components/controladoria/ControladoriaContasPagar';
import StarkBank from '@/components/controladoria/StarkBank';
import InterBank from '@/components/controladoria/InterBank';
import SaldoDeHoje from '@/components/controladoria/overview/SaldoDeHoje';
import PagamentosDeHoje from '@/components/controladoria/overview/PagamentosDeHoje';
import ProximosPagamentos from '@/components/controladoria/overview/ProximosPagamentos';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';

export default function ControladoriaFinanceira() {
  const { user } = useAuth();
  const [isFinance, setIsFinance] = useState(false);
  const [checked, setChecked] = useState(false);

  useEffect(() => {
    const email = user?.email;
    if (!email) { setIsFinance(false); setChecked(true); return; }
    supabase
      .from('finance_viewers')
      .select('email')
      .ilike('email', email)
      .maybeSingle()
      .then(({ data }) => { setIsFinance(!!data); setChecked(true); });
  }, [user?.email]);

  if (!checked) {
    return (
      <AppLayout
        title="Controladoria Financeira"
        subtitle="Concilie notas fiscais em contas a pagar. Independente do Fluxo de Caixa."
      >
        <div className="p-6" />
      </AppLayout>
    );
  }

  const defaultTab = isFinance ? 'fluxo' : 'notas';

  return (
    <AppLayout
      title="Controladoria Financeira"
      subtitle="Concilie notas fiscais em contas a pagar. Independente do Fluxo de Caixa."
    >
      <div className="space-y-6 p-4 md:p-6">
        <Tabs defaultValue={defaultTab} className="space-y-6">
          <TabsList>
            {isFinance && <TabsTrigger value="fluxo">Fluxo de Caixa</TabsTrigger>}
            <TabsTrigger value="notas">Notas</TabsTrigger>
            <TabsTrigger value="contas">Contas a Pagar</TabsTrigger>
            {isFinance && <TabsTrigger value="stark">Stark Bank</TabsTrigger>}
            {isFinance && <TabsTrigger value="inter">Inter</TabsTrigger>}
          </TabsList>

          {isFinance && (
            <TabsContent value="fluxo">
              <div className="space-y-6">
                <div className="grid gap-6 lg:grid-cols-2">
                  <SaldoDeHoje />
                  <PagamentosDeHoje />
                </div>
                <ProximosPagamentos />
              </div>
            </TabsContent>
          )}
          <TabsContent value="notas"><ControladoriaNotas /></TabsContent>
          <TabsContent value="contas"><ControladoriaContasPagar /></TabsContent>
          {isFinance && <TabsContent value="stark"><StarkBank /></TabsContent>}
          {isFinance && <TabsContent value="inter"><InterBank /></TabsContent>}
        </Tabs>
      </div>
    </AppLayout>
  );
}
