import { useLocation } from "react-router-dom";
import { usePermissions } from "@/contexts/PermissionsContext";
import { ROUTE_TO_MENU_KEY } from "@/lib/menu-config";
import { ShieldX } from "lucide-react";

const PermissionGate = ({ children }: { children: React.ReactNode }) => {
  const { pathname } = useLocation();
  const { canView, loading } = usePermissions();

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  let menuKey = ROUTE_TO_MENU_KEY[pathname];
  if (!menuKey) {
    const segments = pathname.split("/").filter(Boolean);
    while (segments.length > 0 && !menuKey) {
      segments.pop();
      menuKey = ROUTE_TO_MENU_KEY["/" + segments.join("/")];
    }
  }
  if (!menuKey || menuKey === "dashboard") return <>{children}</>;

  const checkKey = canView(menuKey) ? menuKey : menuKey.split(".").slice(0, 2).join(".");
  if (!canView(checkKey)) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <ShieldX className="w-16 h-16 text-muted-foreground" />
        <h2 className="text-xl font-semibold text-foreground">Acesso Negado</h2>
        <p className="text-muted-foreground text-center max-w-md">
          Você não tem permissão para acessar esta página. Contate o administrador.
        </p>
      </div>
    );
  }
  return <>{children}</>;
};

export default PermissionGate;
