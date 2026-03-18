import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { LayoutDashboard, Upload, LogOut, X, Users } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import propositoLogo from '@/assets/proposito-logo.png';

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function AppSidebar({ open = true, onClose }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const { isAdmin } = useUserRole();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Upload, label: 'Importar', path: '/import' },
    ...(isAdmin ? [{ icon: Users, label: 'Usuários', path: '/users' }] : []),
  ];

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
      {/* Propósito logo + close */}
      <div className="px-4 pt-4 pb-1 flex items-center justify-between">
        <img src={propositoLogo} alt="Propósito Soluções" className="h-8 object-contain" />
        {isMobile && (
          <button onClick={onClose} className="text-sidebar-foreground">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* Client name */}
      <div className="px-4 pb-3 border-b border-white/5">
        <p className="text-sm font-bold text-sidebar-accent-foreground leading-tight">Pizzaria Estrela da Ilha</p>
      </div>

      {/* User badge */}
      <div className="mx-3 mt-3 mb-4 px-3 py-2.5 bg-sidebar-accent rounded-lg">
        <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground font-medium">Usuário</p>
        <p className="text-xs font-semibold text-sidebar-accent-foreground truncate mt-0.5">
          {userName}
        </p>
      </div>

      {/* Navigation */}
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

      {/* Footer */}
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
