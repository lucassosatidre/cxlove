import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
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

function RoleRedirect() {
  const { isAdmin, isCaixaTele, isCaixaSalao, loading } = useUserRole();
  if (loading) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="animate-spin h-8 w-8 border-4 border-primary border-t-transparent rounded-full" />
      </div>
    );
  }
  if (isCaixaTele) return <Navigate to="/tele" replace />;
  if (isCaixaSalao) return <Navigate to="/salon" replace />;
  return <Overview />;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthProvider>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/" element={<ProtectedRoute><RoleRedirect /></ProtectedRoute>} />
            <Route path="/tele" element={<ProtectedRoute><Dashboard /></ProtectedRoute>} />
            <Route path="/import" element={<ProtectedRoute><Import /></ProtectedRoute>} />
            <Route path="/tele/import" element={<ProtectedRoute><TeleImport /></ProtectedRoute>} />
            <Route path="/reconciliation/:id" element={<ProtectedRoute><Reconciliation /></ProtectedRoute>} />
            <Route path="/reconciliation-legacy/:id" element={<ProtectedRoute><ReconciliationLegacy /></ProtectedRoute>} />
            <Route path="/delivery-reconciliation/:id" element={<ProtectedRoute><DeliveryReconciliation /></ProtectedRoute>} />
            <Route path="/salon" element={<ProtectedRoute><SalonDashboard /></ProtectedRoute>} />
            <Route path="/salon/import" element={<ProtectedRoute><SalonImport /></ProtectedRoute>} />
            <Route path="/salon/closing/:id" element={<ProtectedRoute><SalonClosing /></ProtectedRoute>} />
            <Route path="/salon/reconciliation/:id" element={<ProtectedRoute><SalonReconciliation /></ProtectedRoute>} />
            <Route path="/cash-control" element={<ProtectedRoute><Navigate to="/" replace /></ProtectedRoute>} />
            <Route path="/users" element={<ProtectedRoute><UserManagement /></ProtectedRoute>} />
            {/* Redirect old test routes */}
            <Route path="/tele-teste" element={<Navigate to="/tele" replace />} />
            <Route path="/tele-teste/import" element={<Navigate to="/tele/import" replace />} />
            <Route path="/reconciliation-teste/:id" element={<Navigate to="/reconciliation/:id" replace />} />
            <Route path="/delivery-reconciliation-teste/:id" element={<Navigate to="/delivery-reconciliation/:id" replace />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </AuthProvider>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
