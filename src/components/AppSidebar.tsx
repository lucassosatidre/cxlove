import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { Bike, LogOut, X, Users, Store, LayoutDashboard, Truck, ChevronsLeft, ChevronsRight } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import propositoLogo from '@/assets/proposito-logo.png';
import estrelaLogo from '@/assets/estrela-logo.png';

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function AppSidebar({ open = true, onClose, collapsed = false, onToggleCollapse }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const { isAdmin, isCaixaTele, isCaixaSalao } = useUserRole();
  const { hasPermission } = useUserPermissions();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  let navItems: { icon: any; label: string; path: string; permission: string }[] = [];

  if (isCaixaTele) {
    navItems = [
      { icon: Bike, label: 'Tele', path: '/tele', permission: 'dashboard' },
    ];
  } else if (isCaixaSalao) {
    navItems = [
      { icon: Store, label: 'Salão', path: '/salon', permission: 'salon' },
    ];
  } else {
    const allNavItems = [
      { icon: LayoutDashboard, label: 'Painel', path: '/', permission: 'dashboard' },
      { icon: Bike, label: 'Tele', path: '/tele', permission: 'dashboard' },
      { icon: Store, label: 'Salão', path: '/salon', permission: 'salon' },
    ];
    navItems = allNavItems.filter(item => hasPermission(item.permission));
    if (isAdmin) {
      navItems.push({ icon: Truck, label: 'Entregadores', path: '/admin/entregadores', permission: 'dashboard' });
      // Etiquetas hidden — functionality moved to external script
      navItems.push({ icon: Users, label: 'Usuários', path: '/users', permission: 'users' });
    }
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

  const sidebarWidth = collapsed ? 'w-16' : 'w-56';

  const NavButton = ({ item }: { item: typeof navItems[0] }) => {
    const active = isActive(item.path);
    const button = (
      <button
        onClick={() => handleNav(item.path)}
        className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium row-transition ${
          active
            ? 'bg-primary text-primary-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground'
        }`}
      >
        <item.icon className="h-4 w-4 shrink-0" />
        {!collapsed && item.label}
      </button>
    );

    if (collapsed) {
      return (
        <Tooltip>
          <TooltipTrigger asChild>{button}</TooltipTrigger>
          <TooltipContent side="right" className="text-xs">{item.label}</TooltipContent>
        </Tooltip>
      );
    }
    return button;
  };

  return (
    <TooltipProvider delayDuration={100}>
      <aside
        className={`fixed left-0 top-0 bottom-0 ${sidebarWidth} bg-sidebar flex flex-col z-30 transition-all duration-300 ${
          open ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        {/* App header */}
        <div className={`px-4 pt-5 pb-2 flex items-start justify-between ${collapsed ? 'px-2' : ''}`}>
          <div className="flex items-center gap-3">
            <div className={`${collapsed ? 'h-8 w-8' : 'h-10 w-10'} rounded-lg bg-sidebar-accent border border-sidebar-border flex items-center justify-center p-1.5 shrink-0`}>
              <img src={propositoLogo} alt="Propósito Soluções" className="h-full w-full object-contain" />
            </div>
            {!collapsed && (
              <div>
                <p className="text-sm font-bold text-sidebar-accent-foreground leading-tight">CAIXA LOVE</p>
                <p className="text-[10px] text-sidebar-foreground/60">Gestão operacional</p>
              </div>
            )}
          </div>
          {isMobile && (
            <button onClick={onClose} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
              <X className="h-5 w-5" />
            </button>
          )}
        </div>

        {/* Cliente Ativo */}
        {!collapsed && (
          <div className="mx-3 mt-2 mb-3 px-3 py-2.5 bg-sidebar-accent rounded-lg flex items-center gap-2.5">
            <div className="h-8 w-8 rounded-md overflow-hidden shrink-0">
              <img src={estrelaLogo} alt="Pizzaria Estrela da Ilha" className="h-full w-full object-cover" />
            </div>
            <div>
              <p className="text-[9px] uppercase tracking-wider text-sidebar-foreground/50 font-semibold">Cliente Ativo</p>
              <p className="text-xs font-semibold text-sidebar-accent-foreground leading-tight">Pizzaria Estrela da Ilha</p>
            </div>
          </div>
        )}

        {!collapsed && <div className="mx-3 mb-3 border-b border-sidebar-border" />}

        {/* User info */}
        {!collapsed && (
          <div className="mx-3 mb-4 px-3 py-2 bg-sidebar-accent/50 rounded-lg">
            <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground/50 font-medium">Usuário</p>
            <p className="text-xs font-semibold text-sidebar-accent-foreground truncate mt-0.5">
              {userName}
            </p>
          </div>
        )}

        <nav className={`flex-1 ${collapsed ? 'px-1.5' : 'px-3'} space-y-0.5`}>
          {navItems.map((item) => (
            <NavButton key={item.path} item={item} />
          ))}
        </nav>

        <div className={`${collapsed ? 'px-1.5' : 'px-3'} pb-5 space-y-1`}>
          {/* Logout */}
          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={signOut}
                  className="w-full flex items-center justify-center px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground row-transition"
                >
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Sair</TooltipContent>
            </Tooltip>
          ) : (
            <button
              onClick={signOut}
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground row-transition"
            >
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          )}

          {/* Collapse toggle (desktop only) */}
          {!isMobile && onToggleCollapse && (
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={onToggleCollapse}
                  className={`w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2 rounded-lg text-xs text-sidebar-foreground/60 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground row-transition`}
                >
                  {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                  {!collapsed && 'Minimizar'}
                </button>
              </TooltipTrigger>
              {collapsed && <TooltipContent side="right" className="text-xs">Expandir</TooltipContent>}
            </Tooltip>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
