import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { useAvatarEmoji } from '@/hooks/useAvatarEmoji';
import { useTheme } from '@/hooks/useTheme';
import { Bike, LogOut, X, Users, Store, LayoutDashboard, Truck, ChevronsLeft, ChevronsRight, CreditCard, Calculator, Brain, Headphones, Sun, Moon, Banknote } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import vigiaLogo from '@/assets/vigia-logo.png';

interface AppSidebarProps {
  open?: boolean;
  onClose?: () => void;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}

export default function AppSidebar({ open = true, onClose, collapsed = false, onToggleCollapse }: AppSidebarProps) {
  const { user, signOut } = useAuth();
  const { role, isAdmin, isCaixaTele, isCaixaSalao, isLider } = useUserRole();
  const { hasPermission } = useUserPermissions();
  const { emoji, updateEmoji, EMOJI_OPTIONS } = useAvatarEmoji();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [emojiPickerOpen, setEmojiPickerOpen] = useState(false);

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
      navItems.push({ icon: CreditCard, label: 'Maquininhas', path: '/admin/maquininhas', permission: 'dashboard' });
      navItems.push({ icon: Calculator, label: 'Auditoria de Taxas', path: '/admin/auditoria-v2', permission: 'dashboard' });
      navItems.push({ icon: Banknote, label: 'Fluxo de Caixa', path: '/admin/fluxo-caixa', permission: 'dashboard' });
      navItems.push({ icon: Brain, label: 'Memória da Clau', path: '/admin/clau/memoria', permission: 'dashboard' });
      // { icon: Headphones, label: 'Sofia', path: '/admin/sofia', permission: 'dashboard' },
      navItems.push({ icon: Users, label: 'Usuários', path: '/users', permission: 'users' });
    }
  }

  const isActive = (path: string) => {
    if (path === '/') return location.pathname === '/';
    // exact match or descendant path (so /admin/auditoria doesn't claim /admin/auditoria-v2)
    return location.pathname === path || location.pathname.startsWith(path + '/');
  };

  const handleNav = (path: string) => {
    navigate(path);
    onClose?.();
  };

  const userName =
    (user?.user_metadata?.full_name as string | undefined) ||
    (user?.user_metadata?.name as string | undefined) ||
    user?.email?.split('@')[0] ||
    'Usuário';

  const roleLabel = (() => {
    if (role === 'admin') return 'Administrador';
    if (role === 'caixa_tele') return 'Caixa Tele';
    if (role === 'caixa_salao') return 'Caixa Salão';
    if (role === 'entregador') return 'Entregador';
    return 'Usuário';
  })();

  const sidebarWidth = collapsed ? 'w-16' : 'w-56';

  const NavButton = ({ item }: { item: typeof navItems[0] }) => {
    const active = isActive(item.path);
    const button = (
      <button
        onClick={() => handleNav(item.path)}
        className={`relative w-full flex items-center ${collapsed ? 'justify-center' : 'gap-3'} px-3 py-2.5 rounded-lg text-sm font-medium row-transition ${
          active
            ? 'bg-sidebar-accent text-sidebar-accent-foreground'
            : 'text-sidebar-foreground hover:bg-sidebar-accent/60 hover:text-sidebar-accent-foreground'
        }`}
      >
        {active && (
          <span className="absolute left-0 top-1/2 -translate-y-1/2 h-6 w-[3px] rounded-r bg-gold-500" aria-hidden="true" />
        )}
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
        {/* Close button mobile */}
        {isMobile && (
          <div className="flex justify-end px-3 pt-3">
            <button onClick={onClose} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Logo header — the image already contains the brand name + tagline */}
        {!collapsed ? (
          <div className="flex flex-col items-center px-4 pt-5 pb-4 border-b border-sidebar-border">
            <div className="bg-marfim rounded-2xl p-2 shadow-card">
              <img
                src={vigiaLogo}
                alt="VIGIA"
                className="w-[140px] h-[140px] object-contain"
              />
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-center px-2 pt-5 pb-4 border-b border-sidebar-border">
            <div className="bg-marfim rounded-xl p-1.5 shadow-card">
              <img
                src={vigiaLogo}
                alt="VIGIA"
                className="h-8 w-8 object-contain"
              />
            </div>
          </div>
        )}

        {/* Nav */}
        <nav className={`flex-1 overflow-y-auto py-3 ${collapsed ? 'px-1.5' : 'px-3'} space-y-0.5`}>
          {navItems.map((item) => (
            <NavButton key={item.path} item={item} />
          ))}
        </nav>

        {/* Footer */}
        <div className={`border-t border-sidebar-border ${collapsed ? 'px-1.5' : 'px-3'} py-3 space-y-2`}>
          {/* User chip */}
          {!collapsed ? (
            <div className="px-2 py-2 bg-sidebar-accent/50 rounded-lg flex items-center gap-2.5">
              <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                <PopoverTrigger asChild>
                  <button className="h-8 w-8 shrink-0 rounded-full bg-sidebar-accent flex items-center justify-center text-lg hover:scale-110 transition-transform cursor-pointer" title="Trocar emoji">
                    {emoji}
                  </button>
                </PopoverTrigger>
                <PopoverContent side="right" className="w-64 p-2" align="start">
                  <p className="text-xs font-medium text-muted-foreground mb-2">Escolha seu avatar</p>
                  <div className="grid grid-cols-6 gap-1">
                    {EMOJI_OPTIONS.map((e, i) => (
                      <button
                        key={`${e}-${i}`}
                        onClick={() => { updateEmoji(e); setEmojiPickerOpen(false); }}
                        className={`text-xl p-1.5 rounded-md hover:bg-accent transition-colors ${emoji === e ? 'bg-accent ring-1 ring-primary' : ''}`}
                      >
                        {e}
                      </button>
                    ))}
                  </div>
                </PopoverContent>
              </Popover>
              <div className="min-w-0">
                <p className="text-xs font-semibold text-sidebar-accent-foreground truncate">
                  {userName}
                </p>
                <p className="text-[10px] text-sidebar-foreground/60 truncate">
                  {roleLabel}
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center justify-center">
              <Tooltip>
                <TooltipTrigger asChild>
                  <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
                    <PopoverTrigger asChild>
                      <button className="h-8 w-8 rounded-full bg-sidebar-accent flex items-center justify-center text-base cursor-pointer hover:scale-110 transition-transform" title="Trocar emoji">
                        {emoji}
                      </button>
                    </PopoverTrigger>
                    <PopoverContent side="right" className="w-64 p-2" align="start">
                      <p className="text-xs font-medium text-muted-foreground mb-2">Escolha seu avatar</p>
                      <div className="grid grid-cols-6 gap-1">
                        {EMOJI_OPTIONS.map((e, i) => (
                          <button
                            key={`${e}-${i}`}
                            onClick={() => { updateEmoji(e); setEmojiPickerOpen(false); }}
                            className={`text-xl p-1.5 rounded-md hover:bg-accent transition-colors ${emoji === e ? 'bg-accent ring-1 ring-primary' : ''}`}
                          >
                            {e}
                          </button>
                        ))}
                      </div>
                    </PopoverContent>
                  </Popover>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{userName}</TooltipContent>
              </Tooltip>
            </div>
          )}

          {/* Theme + collapse toggles */}
          <div className={`flex items-center ${collapsed ? 'flex-col gap-1' : 'justify-center gap-1'}`}>
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
              <TooltipContent side="right" className="text-xs">
                {theme === 'light' ? 'Tema escuro' : 'Tema claro'}
              </TooltipContent>
            </Tooltip>

            {!isMobile && onToggleCollapse && (
              <Tooltip>
                <TooltipTrigger asChild>
                  <button
                    onClick={onToggleCollapse}
                    className="p-2 rounded-lg text-sidebar-foreground/70 hover:text-sidebar-accent-foreground hover:bg-sidebar-accent row-transition"
                    aria-label={collapsed ? 'Expandir' : 'Minimizar'}
                  >
                    {collapsed ? <ChevronsRight className="h-4 w-4" /> : <ChevronsLeft className="h-4 w-4" />}
                  </button>
                </TooltipTrigger>
                <TooltipContent side="right" className="text-xs">{collapsed ? 'Expandir' : 'Minimizar'}</TooltipContent>
              </Tooltip>
            )}
          </div>

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

          {/* Signature */}
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
