import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import { PermissionsProvider, usePermissions } from "@/contexts/PermissionsContext";
import PermissionGate from "@/components/PermissionGate";
import { MENU_KEY_TO_ROUTE } from "@/lib/menu-config";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import TeleImport from "./pages/TeleImport";
import PickNGoImport from "./pages/PickNGoImport";
import Reconciliation from "./pages/Reconciliation";
import ReconciliationLegacy from "./pages/ReconciliationLegacy";
import DeliveryReconciliation from "./pages/DeliveryReconciliation";
import UserManagement from "./pages/UserManagement";
import SalonDashboard from "./pages/SalonDashboard";
import SalonImport from "./pages/SalonImport";
import SalonClosing from "./pages/SalonClosing";
import SalonReconciliation from "./pages/SalonReconciliation";
import NotFound from "./pages/NotFound";
import EntregadorPortal from "./pages/EntregadorPortal";
import DriverManagement from "./pages/DriverManagement";
// DriverShifts merged into DriverManagement
import Etiquetas from "./pages/Etiquetas";
import MachineRegistry from "./pages/MachineRegistry";
import CheckinAudit from "./pages/CheckinAudit";
import AuditEntryV2 from "./pages/audit-v2/AuditEntryV2";
import AuditDashboardV2 from "./pages/audit-v2/AuditDashboardV2";
import AuditVouchersV2 from "./pages/audit-v2/AuditVouchersV2";
import AuditBrendiV2 from "./pages/audit-v2/AuditBrendiV2";
import AuditIfoodMarketplaceV2 from "./pages/audit-v2/AuditIfoodMarketplaceV2";
import AuditImportacoesV2 from "./pages/audit-v2/AuditImportacoesV2";
import AuditRelatoriosV2 from "./pages/audit-v2/AuditRelatoriosV2";
import CashflowDashboard from "./pages/CashflowDashboard";
import NfseDocuments from "./pages/NfseDocuments";
import ClauMemory from "./pages/ClauMemory";
import ClauChat from "@/components/clau/ClauChat";
import Profile from "./pages/Profile";
// import Sofia from "./pages/Sofia";

const queryClient = new QueryClient();

function ProtectedRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  return user ? <>{children}</> : <Navigate to="/login" replace />;
}

// Mantido só para o portal do entregador (continua por papel)
function SectorGuard({ sector, children }: { sector: 'tele' | 'salon' | 'entregador'; children: React.ReactNode }) {
  const { isAdmin, isCaixaTele, isCaixaSalao, isEntregador, loading } = useUserRole();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (isAdmin) return <>{children}</>;
  if (isEntregador && sector !== 'entregador') return <Navigate to="/entregador" replace />;
  if (isCaixaTele && sector !== 'tele') return <Navigate to="/tele" replace />;
  if (isCaixaSalao && sector !== 'salon') return <Navigate to="/salon" replace />;
  return <>{children}</>;
}

function RoleRedirect() {
  const { isEntregador, loading: roleLoading } = useUserRole();
  const { canView, loading: permLoading } = usePermissions();
  if (roleLoading || permLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (isEntregador) return <Navigate to="/entregador" replace />;
  if (canView("dashboard")) return <Overview />;
  const order = ["op.tele","op.salao","op.entregadores","op.maquininhas","audit.importacoes","audit.maquinona","audit.vouchers","audit.brendi","audit.ifood","audit.relatorios","fluxo_caixa","clau.memoria","config.usuarios"];
  for (const k of order) { if (canView(k)) return <Navigate to={MENU_KEY_TO_ROUTE[k]} replace />; }
  return <Overview />;
}

const App = () => (
  <ErrorBoundary>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <PermissionsProvider>
            <Routes>
              <Route path="/login" element={<Login />} />
              <Route path="/" element={<ProtectedRoute><RoleRedirect /></ProtectedRoute>} />
              <Route path="/tele" element={<ProtectedRoute><PermissionGate><Dashboard /></PermissionGate></ProtectedRoute>} />
              <Route path="/import" element={<ProtectedRoute><PermissionGate><Import /></PermissionGate></ProtectedRoute>} />
              <Route path="/tele/import" element={<ProtectedRoute><PermissionGate><TeleImport /></PermissionGate></ProtectedRoute>} />
              <Route path="/tele/pickngo" element={<ProtectedRoute><PermissionGate><PickNGoImport /></PermissionGate></ProtectedRoute>} />
              <Route path="/reconciliation/:id" element={<ProtectedRoute><PermissionGate><Reconciliation /></PermissionGate></ProtectedRoute>} />
              <Route path="/reconciliation-legacy/:id" element={<ProtectedRoute><PermissionGate><ReconciliationLegacy /></PermissionGate></ProtectedRoute>} />
              <Route path="/delivery-reconciliation/:id" element={<ProtectedRoute><PermissionGate><DeliveryReconciliation /></PermissionGate></ProtectedRoute>} />
              <Route path="/salon" element={<ProtectedRoute><PermissionGate><SalonDashboard /></PermissionGate></ProtectedRoute>} />
              <Route path="/salon/import" element={<ProtectedRoute><PermissionGate><SalonImport /></PermissionGate></ProtectedRoute>} />
              <Route path="/salon/closing/:id" element={<ProtectedRoute><PermissionGate><SalonClosing /></PermissionGate></ProtectedRoute>} />
              <Route path="/salon/reconciliation/:id" element={<ProtectedRoute><PermissionGate><SalonReconciliation /></PermissionGate></ProtectedRoute>} />
              <Route path="/entregador" element={<ProtectedRoute><SectorGuard sector="entregador"><EntregadorPortal /></SectorGuard></ProtectedRoute>} />
              <Route path="/cash-control" element={<ProtectedRoute><Navigate to="/" replace /></ProtectedRoute>} />
              <Route path="/admin/entregadores" element={<ProtectedRoute><PermissionGate><DriverManagement /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/escalas-entregadores" element={<Navigate to="/admin/entregadores?tab=escala" replace />} />
              <Route path="/etiquetas" element={<ProtectedRoute><PermissionGate><Etiquetas /></PermissionGate></ProtectedRoute>} />
              <Route path="/users" element={<ProtectedRoute><PermissionGate><UserManagement /></PermissionGate></ProtectedRoute>} />
              <Route path="/perfil" element={<ProtectedRoute><Profile /></ProtectedRoute>} />
              <Route path="/admin/maquininhas" element={<ProtectedRoute><PermissionGate><MachineRegistry /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/audit" element={<ProtectedRoute><PermissionGate><CheckinAudit /></PermissionGate></ProtectedRoute>} />
              {/* Auditoria v1 aposentada — redireciona tudo pra v2 */}
              <Route path="/admin/auditoria" element={<Navigate to="/admin/auditoria-v2" replace />} />
              <Route path="/admin/auditoria/maquinona" element={<Navigate to="/admin/auditoria-v2/maquinona" replace />} />
              <Route path="/admin/auditoria/importar" element={<Navigate to="/admin/auditoria-v2/importacoes" replace />} />
              <Route path="/admin/auditoria/ifood" element={<Navigate to="/admin/auditoria-v2/maquinona" replace />} />
              <Route path="/admin/auditoria/vouchers" element={<Navigate to="/admin/auditoria-v2/vouchers" replace />} />
              <Route path="/admin/auditoria/match" element={<Navigate to="/admin/auditoria-v2/importacoes" replace />} />
              <Route path="/admin/auditoria/conciliacao" element={<Navigate to="/admin/auditoria-v2/importacoes" replace />} />
              <Route path="/admin/auditoria/auditar-mes" element={<Navigate to="/admin/auditoria-v2/importacoes" replace />} />
              <Route path="/admin/auditoria/brendi" element={<Navigate to="/admin/auditoria-v2/brendi" replace />} />
              <Route path="/admin/auditoria/ifood-marketplace" element={<Navigate to="/admin/auditoria-v2/ifood-marketplace" replace />} />
              <Route path="/admin/auditoria/importacoes" element={<Navigate to="/admin/auditoria-v2/importacoes" replace />} />
              <Route path="/admin/auditoria/relatorios" element={<Navigate to="/admin/auditoria-v2/relatorios" replace />} />
              {/* Auditoria v2 — oficial */}
              <Route path="/admin/auditoria-v2" element={<ProtectedRoute><PermissionGate><AuditEntryV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/auditoria-v2/importacoes" element={<ProtectedRoute><PermissionGate><AuditImportacoesV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/auditoria-v2/maquinona" element={<ProtectedRoute><PermissionGate><AuditDashboardV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/auditoria-v2/conciliacao" element={<Navigate to="/admin/auditoria-v2/importacoes" replace />} />
              <Route path="/admin/auditoria-v2/vouchers" element={<ProtectedRoute><PermissionGate><AuditVouchersV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/auditoria-v2/brendi" element={<ProtectedRoute><PermissionGate><AuditBrendiV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/auditoria-v2/ifood-marketplace" element={<ProtectedRoute><PermissionGate><AuditIfoodMarketplaceV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/auditoria-v2/relatorios" element={<ProtectedRoute><PermissionGate><AuditRelatoriosV2 /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/clau/memoria" element={<ProtectedRoute><PermissionGate><ClauMemory /></PermissionGate></ProtectedRoute>} />
              {/* Fluxo de Caixa — admin */}
              <Route path="/admin/fluxo-caixa" element={<ProtectedRoute><PermissionGate><CashflowDashboard /></PermissionGate></ProtectedRoute>} />
              <Route path="/admin/notas-servicos" element={<ProtectedRoute><PermissionGate><NfseDocuments /></PermissionGate></ProtectedRoute>} />

              {/* Sofia desativada (migrada para outro sistema) — redireciona para Home */}
              <Route path="/admin/sofia" element={<Navigate to="/" replace />} />
              {/* <Route path="/admin/sofia" element={<ProtectedRoute><SectorGuard sector="tele"><Sofia /></SectorGuard></ProtectedRoute>} /> */}
              {/* Redirect old test routes */}
              <Route path="/tele-teste" element={<Navigate to="/tele" replace />} />
              <Route path="/tele-teste/import" element={<Navigate to="/tele/import" replace />} />
              <Route path="/reconciliation-teste/:id" element={<Navigate to="/reconciliation/:id" replace />} />
              <Route path="/delivery-reconciliation-teste/:id" element={<Navigate to="/delivery-reconciliation/:id" replace />} />
              <Route path="*" element={<NotFound />} />
            </Routes>
            <ClauChat />
          </PermissionsProvider>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
