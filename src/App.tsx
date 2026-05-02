import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import ErrorBoundary from "@/components/ErrorBoundary";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider, useAuth } from "@/hooks/useAuth";
import { useUserRole } from "@/hooks/useUserRole";
import Login from "./pages/Login";
import Overview from "./pages/Overview";
import Dashboard from "./pages/Dashboard";
import Import from "./pages/Import";
import TeleImport from "./pages/TeleImport";
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
import AuditDashboard from "./pages/audit/AuditDashboard";
import AuditImport from "./pages/audit/AuditImport";
import AuditIfood from "./pages/audit/AuditIfood";
import AuditMatch from "./pages/audit/AuditMatch";
import AuditVouchers from "./pages/audit/AuditVouchers";
import AuditConciliacao from "./pages/audit/AuditConciliacao";
import AuditBrendi from "./pages/audit/AuditBrendi";
import ClauMemory from "./pages/ClauMemory";
import ClauChat from "@/components/clau/ClauChat";

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

// Sector guard: restricts caixa_tele to tele routes, caixa_salao to salon routes
function SectorGuard({ sector, children }: { sector: 'tele' | 'salon' | 'entregador'; children: React.ReactNode }) {
  const { isAdmin, isCaixaTele, isCaixaSalao, isEntregador, loading } = useUserRole();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  // Admin can access everything
  if (isAdmin) return <>{children}</>;
  // Entregador can only access entregador portal
  if (isEntregador && sector !== 'entregador') return <Navigate to="/entregador" replace />;
  // caixa_tele can only access tele
  if (isCaixaTele && sector !== 'tele') return <Navigate to="/tele" replace />;
  // caixa_salao can only access salon
  if (isCaixaSalao && sector !== 'salon') return <Navigate to="/salon" replace />;
  return <>{children}</>;
}

function RoleRedirect() {
  const { isAdmin, isCaixaTele, isCaixaSalao, isEntregador, loading } = useUserRole();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (isEntregador) return <Navigate to="/entregador" replace />;
  if (isCaixaTele) return <Navigate to="/tele" replace />;
  if (isCaixaSalao) return <Navigate to="/salon" replace />;
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
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><RoleRedirect /></ProtectedRoute>} />
            <Route path="/tele" element={<ProtectedRoute><SectorGuard sector="tele"><Dashboard /></SectorGuard></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><SectorGuard sector="tele"><Import /></SectorGuard></ProtectedRoute>} />
            <Route path="/tele/import" element={<ProtectedRoute><SectorGuard sector="tele"><TeleImport /></SectorGuard></ProtectedRoute>} />
            <Route path="/reconciliation/:id" element={<ProtectedRoute><SectorGuard sector="tele"><Reconciliation /></SectorGuard></ProtectedRoute>} />
            <Route path="/reconciliation-legacy/:id" element={<ProtectedRoute><SectorGuard sector="tele"><ReconciliationLegacy /></SectorGuard></ProtectedRoute>} />
            <Route path="/delivery-reconciliation/:id" element={<ProtectedRoute><SectorGuard sector="tele"><DeliveryReconciliation /></SectorGuard></ProtectedRoute>} />
            <Route path="/salon" element={<ProtectedRoute><SectorGuard sector="salon"><SalonDashboard /></SectorGuard></ProtectedRoute>} />
            <Route path="/salon/import" element={<ProtectedRoute><SectorGuard sector="salon"><SalonImport /></SectorGuard></ProtectedRoute>} />
            <Route path="/salon/closing/:id" element={<ProtectedRoute><SectorGuard sector="salon"><SalonClosing /></SectorGuard></ProtectedRoute>} />
            <Route path="/salon/reconciliation/:id" element={<ProtectedRoute><SectorGuard sector="salon"><SalonReconciliation /></SectorGuard></ProtectedRoute>} />
            <Route path="/entregador" element={<ProtectedRoute><SectorGuard sector="entregador"><EntregadorPortal /></SectorGuard></ProtectedRoute>} />
            <Route path="/cash-control" element={<ProtectedRoute><Navigate to="/" replace /></ProtectedRoute>} />
            <Route path="/admin/entregadores" element={<ProtectedRoute><SectorGuard sector="tele"><DriverManagement /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/escalas-entregadores" element={<Navigate to="/admin/entregadores?tab=escala" replace />} />
            <Route path="/etiquetas" element={<ProtectedRoute><SectorGuard sector="tele"><Etiquetas /></SectorGuard></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
            <Route path="/admin/maquininhas" element={<ProtectedRoute><SectorGuard sector="tele"><MachineRegistry /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/audit" element={<ProtectedRoute><SectorGuard sector="tele"><CheckinAudit /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria" element={<ProtectedRoute><SectorGuard sector="tele"><AuditDashboard /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria/importar" element={<ProtectedRoute><SectorGuard sector="tele"><AuditImport /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria/ifood" element={<ProtectedRoute><SectorGuard sector="tele"><AuditIfood /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria/match" element={<ProtectedRoute><SectorGuard sector="tele"><AuditMatch /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria/vouchers" element={<ProtectedRoute><SectorGuard sector="tele"><AuditVouchers /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria/auditar-mes" element={<Navigate to="/admin/auditoria/conciliacao" replace />} />
            <Route path="/admin/auditoria/conciliacao" element={<ProtectedRoute><SectorGuard sector="tele"><AuditConciliacao /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/auditoria/brendi" element={<ProtectedRoute><SectorGuard sector="tele"><AuditBrendi /></SectorGuard></ProtectedRoute>} />
            <Route path="/admin/clau/memoria" element={<ProtectedRoute><SectorGuard sector="tele"><ClauMemory /></SectorGuard></ProtectedRoute>} />
            {/* Redirect old test routes */}
            <Route path="/tele-teste" element={<Navigate to="/tele" replace />} />
            <Route path="/tele-teste/import" element={<Navigate to="/tele/import" replace />} />
            <Route path="/reconciliation-teste/:id" element={<Navigate to="/reconciliation/:id" replace />} />
            <Route path="/delivery-reconciliation-teste/:id" element={<Navigate to="/delivery-reconciliation/:id" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
          <ClauChat />
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
  </ErrorBoundary>
);

export default App;
