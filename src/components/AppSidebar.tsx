import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { ClipboardCheck, LayoutDashboard, Upload, LogOut, X } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
}

export default function AppSidebar({ open = true, onClose }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();

  const navItems = [
    { icon: LayoutDashboard, label: 'Dashboard', path: '/' },
    { icon: Upload, label: 'Importar', path: '/import' },
  ];

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname.startsWith(path);
  };

  const handleNav = (path: string) => {
    navigate(path);
    onClose?.();
  };

  return (
    <aside
      className={`fixed left-0 top-0 bottom-0 w-56 bg-sidebar flex flex-col z-30 transition-transform duration-200 ${
        open ? 'translate-x-0' : '-translate-x-full'
      }`}
    >
      {/* Logo + close on mobile */}
      <div className="px-5 py-6 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="h-9 w-9 rounded-xl bg-sidebar-primary flex items-center justify-center">
            <ClipboardCheck className="h-5 w-5 text-sidebar-primary-foreground" />
          </div>
          <div>
            <h1 className="text-sm font-bold text-sidebar-accent-foreground leading-tight">Conferência</h1>
            <p className="text-[10px] text-sidebar-foreground leading-tight">Saipos · Fechamento</p>
          </div>
        </div>
        {isMobile && (
          <button onClick={onClose} className="text-sidebar-foreground">
            <X className="h-5 w-5" />
          </button>
        )}
      </div>

      {/* User badge */}
      <div className="mx-3 mb-4 px-3 py-2.5 bg-sidebar-accent rounded-lg">
        <p className="text-[10px] uppercase tracking-wider text-sidebar-foreground font-medium">Usuário ativo</p>
        <p className="text-xs font-semibold text-sidebar-accent-foreground truncate mt-0.5">
          {user?.email?.split('@')[0]}
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

      {/* Logout */}
      <div className="px-3 pb-5">
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
