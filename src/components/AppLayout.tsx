import { ReactNode, useState } from 'react';
import AppSidebar from './AppSidebar';
import { Menu } from 'lucide-react';
import { useIsMobile } from '@/hooks/use-mobile';

interface AppLayoutProps {
  children: ReactNode;
  title?: string;
  subtitle?: string;
  headerActions?: ReactNode;
}

export default function AppLayout({ children, title, subtitle, headerActions }: AppLayoutProps) {
  const isMobile = useIsMobile();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  return (
    <div className="min-h-screen bg-background">
      {/* Mobile overlay */}
      {isMobile && sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      <AppSidebar open={!isMobile || sidebarOpen} onClose={() => setSidebarOpen(false)} />

      <div className={isMobile ? '' : 'ml-56'}>
        {/* Mobile header with hamburger */}
        {isMobile && (
          <header className="sticky top-0 z-10 bg-sidebar px-4 py-3 flex items-center gap-3">
            <button onClick={() => setSidebarOpen(true)} className="text-sidebar-foreground">
              <Menu className="h-5 w-5" />
            </button>
            <span className="text-sm font-bold text-sidebar-accent-foreground">Conferência</span>
          </header>
        )}

        {title && (
          <header className="px-4 sm:px-8 pt-6 sm:pt-8 pb-2">
            <div className="flex items-center justify-between">
              <div>
                <h1 className="text-xl sm:text-2xl font-bold text-foreground">{title}</h1>
                {subtitle && <p className="text-sm text-muted-foreground mt-1">{subtitle}</p>}
              </div>
              {headerActions && <div className="flex items-center gap-3">{headerActions}</div>}
            </div>
          </header>
        )}
        <main className="px-4 sm:px-8 py-4 sm:py-6">{children}</main>
      </div>
    </div>
  );
}
