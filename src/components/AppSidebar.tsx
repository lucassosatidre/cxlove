import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { Bike, Upload, LogOut, X, Users, CreditCard, Truck, Store } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import propositoLogo from '@/assets/proposito-logo.png';
import estrelaLogo from '@/assets/estrela-logo.png';

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function AppSidebar({ open = true, onClose }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const { hasPermission } = useUserPermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const allNavItems = [
    { icon: Bike, label: 'Tele', path: '/', permission: 'dashboard' },
    { icon: Store, label: 'Salão', path: '/salon', permission: 'salon' },
    { icon: Upload, label: 'Importar', path: '/import', permission: 'import' },
  ];

  const navItems = allNavItems.filter(item => hasPermission(item.permission));

  // Admin-only items
  if (isAdmin) {
    navItems.push({ icon: Users, label: 'Usuários', path: '/users', permission: 'users' });
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNav = (path: string) => {
    navigate(path);
    onClose?.();
  };

  const userName = user?.email?.split('@')[0] || 'Usuário';

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 w-56 bg-sidebar flex flex-col z-30 transition-transform duration-200 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* App header with Propósito logo + app name */}
      <div className="px-4 pt-4 pb-2 flex items-start justify-between">
        <div className="flex items-center gap-3">
          <div className="h-10 w-10 rounded-lg bg-muted/10 border border-white/10 flex items-center justify-center p-1.5 shrink-0">
            <img src={propositoLogo} alt="Propósito Soluções" className="h-full w-full object-contain" />
          </div>
          <div>
            <p className="text-sm font-bold text-sidebar-accent-foreground leading-tight">CX Love</p>
            <p className="text-[10px] text-sidebar-foreground/60">Plataforma de finanças</p>
          </div>
        </div>
        {isMobile && (
          <button onClick={onClose} className="text-sidebar-foreground">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Cliente Ativo */}
      <div className="mx-3 mt-1 mb-3 px-3 py-2.5 bg-sidebar-accent rounded-lg flex items-center gap-2.5">
        <div className="h-8 w-8 rounded-md overflow-hidden shrink-0">
          <img src={estrelaLogo} alt="Pizzaria Estrela da Ilha" className="h-full w-full object-cover" />
        </div>
        <div>
          <p className="text-[9px] uppercase tracking-wider text-sidebar-foreground/60 font-semibold">Cliente Ativo</p>
          <p className="text-xs font-semibold text-sidebar-accent-foreground leading-tight">Pizzaria Estrela da Ilha</p>
        </div>
      </div>

      <div className="mx-3 mb-3 border-b border-white/5" />

      {/* User info */}
      <div className="mx-3 mb-3 px-3 py-2 bg-sidebar-accent/50 rounded-lg">
        <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/60 font-medium">Usuário</p>
        <p className="text-xs font-semibold text-sidebar-accent-foreground truncate mt-0.5">
          {userName}
        </p>
      </div>

      <div className="mx-3 mt-3 mb-4 px-3 py-2.5 bg-sidebar-accent rounded-lg">
        <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground font-medium">Usuário</p>
        <p className="text-xs font-semibold text-sidebar-accent-foreground truncate mt-0.5">
          {userName}
        </p>
      </div>

      <nav className="flex-1 px-3 space-y-1">
        {navItems.map((item) => {
          const active = isActive(item.path);
          return (
            <button
              key={item.path}
              onClick={() => handleNav(item.path)}
              className={`w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium row-transition ${
                active
                  ? 'bg-sidebar-primary text-sidebar-primary-foreground'
                  : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
              }`}
            >
              <item.icon className="h-4 w-4" />
              {item.label}
            </button>
          );
        })}
      </nav>

      <div className="px-3 pb-4 space-y-1">
        <button
          onClick={signOut}
          className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground row-transition"
        >
          <LogOut className="h-4 w-4" />
          Sair
        </button>
      </div>
    </aside>
  );
}
