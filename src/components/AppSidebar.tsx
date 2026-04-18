import { useState } from 'react';
import { useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '@/hooks/useAuth';
import { useUserRole } from '@/hooks/useUserRole';
import { useUserPermissions } from '@/hooks/useUserPermissions';
import { useAvatarEmoji } from '@/hooks/useAvatarEmoji';
import { Bike, LogOut, X, Users, Store, LayoutDashboard, Truck, ChevronsLeft, ChevronsRight, CreditCard, Calculator } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import caixaLoveLogo from '@/assets/caixa-love-logo.png';

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
  const { emoji, updateEmoji, EMOJI_OPTIONS } = useAvatarEmoji();
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
      navItems.push({ icon: Calculator, label: 'Auditoria de Taxas', path: '/admin/auditoria', permission: 'dashboard' });
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
        {/* Close button mobile */}
        {isMobile && (
          <div className="flex justify-end px-3 pt-3">
            <button onClick={onClose} className="text-sidebar-foreground hover:text-sidebar-accent-foreground">
              <X className="h-5 w-5" />
            </button>
          </div>
        )}

        {/* Logo + branding */}
        {!collapsed ? (
          <div className="flex flex-col items-center px-4 pt-5 pb-2">
            <img
              src={caixaLoveLogo}
              alt="Caixa Love"
              className="w-[120px] object-contain"
              style={{ mixBlendMode: 'lighten' }}
            />
            <p className="text-sm font-bold text-sidebar-accent-foreground leading-tight mt-2">CAIXA LOVE</p>
            <p className="text-[10px] text-sidebar-foreground/60">Logística & Fechamento de Caixa</p>
          </div>
        ) : (
          <div className="flex items-center justify-center px-2 pt-5 pb-2">
            <img
              src={caixaLoveLogo}
              alt="Caixa Love"
              className="h-8 w-8 object-contain"
              style={{ mixBlendMode: 'lighten' }}
            />
          </div>
        )}

        {!collapsed && <div className="mx-3 mb-2 border-b border-sidebar-border" />}

        {/* User block */}
        {!collapsed ? (
          <div className="mx-3 mb-4 px-3 py-2 bg-sidebar-accent/50 rounded-lg flex items-center gap-2.5">
            <Popover open={emojiPickerOpen} onOpenChange={setEmojiPickerOpen}>
              <PopoverTrigger asChild>
                <button className="text-xl hover:scale-110 transition-transform cursor-pointer shrink-0" title="Trocar emoji">
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
            <p className="text-xs font-semibold text-sidebar-accent-foreground truncate">
              {userName}
            </p>
          </div>
        ) : (
          <div className="flex items-center justify-center mb-3">
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="text-lg cursor-default">{emoji}</span>
              </TooltipTrigger>
              <TooltipContent side="right" className="text-xs">{userName}</TooltipContent>
            </Tooltip>
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
