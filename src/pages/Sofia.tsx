import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { Navigate } from 'react-router-dom';
import AppLayout from '@/components/AppLayout';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import SofiaPainel from '@/components/sofia/SofiaPainel';
import SofiaPedidos from '@/components/sofia/SofiaPedidos';
import SofiaCampanhas from '@/components/sofia/SofiaCampanhas';
import SofiaAssistentes from '@/components/sofia/SofiaAssistentes';

export default function Sofia() {
  const { user } = useAuth();
  const { isAdmin } = useUserRole();

  if (!user) return <Navigate to="/login" replace />;
  if (!isAdmin) return <Navigate to="/" replace />;

  return (
    <AppLayout title="Sofia · Atendimento por Voz" subtitle="Central de chamadas inbound e outbound via Sua SofIA">
      <Tabs defaultValue="painel" className="w-full">
        <TabsList>
          <TabsTrigger value="painel">Painel</TabsTrigger>
          <TabsTrigger value="pedidos">Pedidos por Telefone</TabsTrigger>
          <TabsTrigger value="campanhas">Campanhas</TabsTrigger>
          <TabsTrigger value="assistentes">Assistentes</TabsTrigger>
        </TabsList>
        <TabsContent value="painel" className="mt-4"><SofiaPainel /></TabsContent>
        <TabsContent value="pedidos" className="mt-4"><SofiaPedidos /></TabsContent>
        <TabsContent value="campanhas" className="mt-4"><SofiaCampanhas /></TabsContent>
        <TabsContent value="assistentes" className="mt-4"><SofiaAssistentes /></TabsContent>
      </Tabs>
    </AppLayout>
  );
}
