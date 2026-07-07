import { useState, useEffect } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useTheme } from '@/hooks/useTheme';
import { usePermissions } from '@/contexts/PermissionsContext';
import { supabase } from '@/integrations/supabase/client';
import { allMenuItems } from '@/lib/menu-tree';
import { LogOut, X, PanelLeft, PanelLeftClose, ChevronDown, Sun, Moon } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import vigiaLogo from '@/assets/vigia-logo.png';

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

const Avatar = ({ url, initials }: { url: string | null; initials: string }) =>
  url ? (
    <img src={url} alt="" className="h-8 w-8 shrink-0 rounded-full object-cover" />
  ) : (
    <div className="h-8 w-8 shrink-0 rounded-full bg-gold-500/15 flex items-center justify-center text-xs font-bold text-gold-500">
      {initials}
    </div>
  );

export default function AppSidebar({ open = true, onClose, collapsed = false, onToggleCollapse }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const { canView } = usePermissions();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [profile, setProfile] = useState<{ full_name: string | null; avatar_url: string | null }>({ full_name: null, avatar_url: null });
  const [openGroups, setOpenGroups] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (!user) return;
    supabase.from('profiles').select('full_name, avatar_url').eq('id', user.id).single()
      .then(({ data }) => { if (data) setProfile({ full_name: data.full_name, avatar_url: data.avatar_url }); });
  }, [user]);

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };
  const handleNav = (path: string) => { navigate(path); onClose?.(); };

  const modules = allMenuItems
    .map((m) => {
      const items = (m.children ?? []).flatMap((c) => {
        if (c.path && c.menuKey) return [c];
        if (c.children) return c.children.filter((sc) => sc.path && sc.menuKey);
        return [];
      }).filter((c) => c.menuKey && canView(c.menuKey));
      return { label: m.label, icon: m.icon, items };
    })
    .filter((m) => m.items.length > 0);
  const flatItems = modules.flatMap((m) => m.items);


  const userName =
    profile.full_name ||
    (user?.user_metadata?.full_name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Usuário';
  const initials = userName.split(' ').map((n) => n[0]).join('').substring(0, 2).toUpperCase();

  const sidebarWidth = collapsed ? 'w-16' : 'w-56';

  const NavButton = ({ item, nested }: { item: { icon: any; label: string; path: string }; nested?: boolean }) => {
    const active = isActive(item.path);
    const button = (
      <button
        onClick={() => handleNav(item.path)}
        className={`relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} ${nested && !collapsed ? 'pl-9 pr-3' : 'px-3'} py-2.5 rounded-lg text-sm font-medium row-transition ${
          active ? 'bg-sidebar-accent text-sidebar-accent-foreground' : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
        }`}
      >
        {active && <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r bg-gold-500" aria-hidden="true" />}
        <item.icon className={`h-4 w-4 shrink-0 ${active ? 'text-gold-500' : ''}`} />
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
        {isMobile && (
          <div className="flex justify-end px-3 pt-3">
            <button onClick={onClose} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Logo transparente (sem fundo branco) */}
        <div className={`flex items-center justify-center border-b border-sidebar-border ${collapsed ? 'px-2 pt-5 pb-4' : 'px-4 pt-5 pb-4'}`}>
          <img src={vigiaLogo} alt="VIGIA" className={collapsed ? 'h-12 w-12 object-contain' : 'w-[150px] object-contain'} />
        </div>

        {/* Navegação — grupos minimizáveis */}
        <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? 'px-1.5 space-y-0.5' : 'px-2'}`}>
          {collapsed
            ? flatItems.map((item) => <NavButton key={item.path} item={item as any} />)
            : modules.map((m) => {
                const isOpen = openGroups[m.label] ?? false;
                const GroupIcon = m.icon;
                return (
                  <div key={m.label} className="mb-1">
                    <button
                      onClick={() => setOpenGroups((p) => ({ ...p, [m.label]: !isOpen }))}
                      className="w-full flex items-center justify-between px-3 py-2 rounded-lg text-[11px] font-semibold uppercase tracking-wider text-sidebar-foreground/50 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent/40 transition-colors"
                    >
                      <span className="flex items-center gap-2"><GroupIcon className="h-3.5 w-3.5" />{m.label}</span>
                      <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isOpen ? '' : '-rotate-90'}`} />
                    </button>
                    {isOpen && (
                      <div className="mt-0.5 space-y-0.5">
                        {m.items.map((item) => <NavButton key={item.path} item={item as any} nested />)}
                      </div>
                    )}
                  </div>
                );
              })}
        </nav>

        {/* Footer */}
        <div className={`border-t border-sidebar-border ${collapsed ? 'px-1.5' : 'px-3'} py-3 space-y-2`}>
          {!collapsed ? (
            <button
              onClick={() => handleNav('/perfil')}
              className="w-full px-2 py-2 bg-sidebar-accent/50 rounded-lg flex items-center gap-2.5 hover:bg-sidebar-accent/70 transition-colors text-left"
            >
              <Avatar url={profile.avatar_url} initials={initials} />
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-sidebar-accent-foreground truncate">{userName}</p>
                <p className="text-[10px] text-sidebar-foreground/60 truncate">{user?.email ?? '—'}</p>
              </div>
            </button>
          ) : (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={() => handleNav('/perfil')} className="w-full flex items-center justify-center" aria-label="Meu perfil">
                  <Avatar url={profile.avatar_url} initials={initials} />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">{userName}</TooltipContent>
            </Tooltip>
          )}

          <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'gap-1 px-1'}`}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  onClick={toggleTheme}
                  className="p-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent row-transition"
                  aria-label={theme === 'light' ? 'Ativar tema escuro' : 'Ativar tema claro'}
                >
                  {theme === 'light' ? <Moon className="h-4 w-4" /> : <Sun className="h-4 w-4" />}
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">{theme === 'light' ? 'Tema escuro' : 'Tema claro'}</TooltipContent>
            </Tooltip>
            {!isMobile && onToggleCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleCollapse}
                    className="p-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent row-transition"
                    aria-label={collapsed ? 'Expandir' : 'Minimizar'}
                  >
                    {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{collapsed ? 'Expandir' : 'Minimizar'}</TooltipContent>
              </Tooltip>
            )}
          </div>

          {collapsed ? (
            <Tooltip>
              <TooltipTrigger asChild>
                <button onClick={signOut} className="w-full flex items-center justify-center px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground row-transition">
                  <LogOut className="h-4 w-4" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">Sair</TooltipContent>
            </Tooltip>
          ) : (
            <button onClick={signOut} className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground row-transition">
              <LogOut className="h-4 w-4" />
              Sair
            </button>
          )}

          {!collapsed && (
            <p className="font-title italic text-[10px] text-center pt-1">
              <span className="text-sidebar-foreground/50">by </span>
              <span className="text-gold-500">Propósito Soluções</span>
            </p>
          )}
        </div>
      </aside>
    </TooltipProvider>
  );
}
