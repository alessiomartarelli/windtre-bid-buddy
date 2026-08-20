import { useLocation } from 'wouter';
import { useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useEnabledModules } from '@/hooks/useEnabledModules';
import { BASE_PATH } from '@/lib/basePath';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/avatar';
import {
  LogOut, User, Building2, Settings, Shield,
  LayoutDashboard, Table2, ShoppingCart, MapPin, FileText, Menu, Trophy,
  BookOpen, BarChart3, Route, Medal, Sun, Moon, Monitor, CalendarClock, Sparkles,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { BisuiteSyncNotificationsBell } from '@/components/BisuiteSyncNotificationsBell';
import { BrandGlyph } from '@/components/BrandLogo';
import { useTheme, type Theme } from '@/hooks/useTheme';

type AppearanceMode = Theme | 'prisma-light';

const themeOptions: Array<{ value: AppearanceMode; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Chiaro', icon: Sun },
  { value: 'dark', label: 'Scuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
  // Task #453 — variante editoriale "Prisma Light" della Dashboard Gara Reale.
  { value: 'prisma-light', label: 'Prisma Light', icon: Sparkles },
];

function ThemeToggle() {
  const {
    theme,
    resolvedTheme,
    setTheme,
    dashboardStyle,
    setDashboardStyle,
  } = useTheme();
  const chooseAppearance = (mode: AppearanceMode) => {
    if (mode === 'prisma-light') {
      setDashboardStyle('prisma-light');
    } else {
      setDashboardStyle('standard');
      setTheme(mode);
    }
  };
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-lg h-11 w-11 lg:h-9 lg:w-9"
          data-testid="button-theme-toggle"
          aria-label="Cambia tema"
        >
          {dashboardStyle === 'prisma-light' ? (
            <Sparkles className="h-4 w-4" />
          ) : resolvedTheme === 'dark' ? (
            <Moon className="h-4 w-4" />
          ) : (
            <Sun className="h-4 w-4" />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">
          Tema
        </DropdownMenuLabel>
        {themeOptions.map((opt) => (
          <DropdownMenuItem
            key={opt.value}
            onClick={() => chooseAppearance(opt.value)}
            className={
              (opt.value === 'prisma-light'
                ? dashboardStyle === 'prisma-light'
                : dashboardStyle === 'standard' && theme === opt.value)
                ? 'bg-accent'
                : ''
            }
            data-testid={`theme-option-${opt.value}`}
          >
            <opt.icon className="mr-2 h-4 w-4" />
            <span>{opt.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

interface AppNavbarProps {
  title?: string;
  children?: React.ReactNode;
}

export function AppNavbar({ title = "MyStoreDesk", children }: AppNavbarProps) {
  const [location, setLocation] = useLocation();
  const { user, profile, organization, signOut } = useAuth();
  const { toast } = useToast();
  const {
    theme,
    resolvedTheme,
    setTheme,
    dashboardStyle,
    setDashboardStyle,
  } = useTheme();

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({ title: 'Errore', description: 'Errore durante il logout', variant: 'destructive' });
    } else {
      // Le preferenze sono per-utente: prima di passare alla schermata auth
      // rimuovi il mirror locale, così l'account successivo non riceve il
      // pre-paint (anche solo per un frame) dell'utente uscente.
      try {
        localStorage.removeItem('mystoredesk-theme');
        localStorage.removeItem('mystoredesk-accent');
        localStorage.removeItem('mystoredesk-dashboard-style');
        localStorage.removeItem('mystoredesk-prefs-user');
      } catch {
        // Storage non disponibile: il logout server resta comunque valido.
      }
      window.location.href = `${BASE_PATH}/auth`;
    }
  };

  const getInitials = () => {
    if (profile?.full_name) {
      return profile.full_name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
    }
    return user?.email?.[0]?.toUpperCase() || 'U';
  };

  const getRoleLabel = () => {
    switch (profile?.role) {
      case 'super_admin': return 'Super Admin';
      case 'admin': return 'Amministratore';
      case 'operatore': return 'Operatore';
      default: return 'Utente';
    }
  };

  const isAdminOrSuper = ['super_admin', 'admin'].includes(profile?.role || '');
  const isSuperAdmin = profile?.role === 'super_admin';
  const { isEnabled } = useEnabledModules();

  const adminItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    ...(isSuperAdmin ? [{ path: '/super-admin', label: 'Super Admin', icon: Shield }] : []),
    ...(isAdminOrSuper && (isEnabled('amministrazione') || isEnabled('controllo_gestione')) ? [{ path: '/amministrazione', label: 'Amministrazione', icon: BookOpen }] : []),
    ...(isAdminOrSuper && isEnabled('drms_commissioning') ? [{ path: '/drms-commissioning', label: 'DRMS Commissioning', icon: BarChart3 }] : []),
  ];

  const garaItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    ...(isEnabled('gara_dashboard') ? [{ path: '/dashboard-gara-reale', label: 'Dashboard', icon: LayoutDashboard }] : []),
    ...(isAdminOrSuper && isEnabled('gara_configurazione') ? [{ path: '/configurazione-gara', label: 'Configurazione', icon: Trophy }] : []),
    ...(isEnabled('vendite_bisuite') ? [{ path: '/vendite-bisuite', label: 'Vendite BiSuite', icon: ShoppingCart }] : []),
    ...(isEnabled('customer_journey') ? [{ path: '/customer-journey', label: 'Customer Journey', icon: Route }] : []),
    ...(isEnabled('incentivazione_interna') ? [{ path: '/incentivazione-interna', label: 'Incentivazione interna', icon: Medal }] : []),
    ...(isEnabled('gestione_dts') ? [{ path: '/gestione-dts', label: 'Gestione DTS', icon: CalendarClock }] : []),
    ...(isSuperAdmin ? [{ path: '/mappatura-bisuite', label: 'Mappatura', icon: MapPin }] : []),
    ...(isAdminOrSuper && isEnabled('mappatura_bisuite') ? [{ path: '/canvass-vodafone-fastweb', label: 'Canvass VF', icon: MapPin }] : []),
  ];

  const simulatoreItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    ...(isEnabled('simulatore') ? [{ path: '/simulatore', label: 'Simulatore', icon: FileText }] : []),
    ...(isEnabled('simulatore') ? [{ path: '/dashboard', label: 'Dashboard Sim.', icon: LayoutDashboard }] : []),
    ...(isAdminOrSuper && isEnabled('tabelle_calcolo') ? [{ path: '/tabelle-calcolo', label: 'Tabelle Calcolo', icon: Table2 }] : []),
  ];

  const chooseAppearance = (mode: AppearanceMode) => {
    if (mode === 'prisma-light') {
      setDashboardStyle('prisma-light');
    } else {
      setDashboardStyle('standard');
      setTheme(mode);
    }
  };

  const isPrismaDashboard =
    dashboardStyle === 'prisma-light' && location === '/dashboard-gara-reale';
  const prismaMobileItems = garaItems
    .filter((item) => [
      '/dashboard-gara-reale',
      '/configurazione-gara',
      '/vendite-bisuite',
    ].includes(item.path))
    .slice(0, 3);

  useEffect(() => {
    if (isPrismaDashboard) {
      document.documentElement.setAttribute('data-skin', 'prisma-light');
      // Prisma è sempre light soltanto su questa route; non modifica né
      // persiste il tema base scelto dall'utente.
      document.documentElement.classList.remove('dark');
    } else {
      document.documentElement.removeAttribute('data-skin');
      document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    }
    return () => {
      document.documentElement.removeAttribute('data-skin');
      document.documentElement.classList.toggle('dark', resolvedTheme === 'dark');
    };
  }, [isPrismaDashboard, resolvedTheme]);

  useEffect(() => {
    document.body.classList.add('desktop-sidebar-layout');
    return () => document.body.classList.remove('desktop-sidebar-layout');
  }, []);

  const sidebarItemClass = (active: boolean) =>
    `w-full justify-start h-9 px-3 text-sm rounded-lg transition-all ${
      active
        ? 'bg-primary text-primary-foreground shadow-sm hover:bg-primary/90 hover:text-primary-foreground'
        : 'text-muted-foreground hover:bg-accent hover:text-accent-foreground'
    }`;

  return (
    <>
    <aside
      className="hidden lg:flex fixed inset-y-0 left-0 z-50 w-64 flex-col border-r border-border/70 bg-background/95 backdrop-blur-xl"
      data-testid="desktop-sidebar"
      aria-label="Navigazione principale"
    >
      <div className="flex h-[61px] shrink-0 items-center border-b border-border/70 px-5">
        <button
          type="button"
          className="flex min-w-0 items-center gap-2 text-left group"
          onClick={() => setLocation('/')}
          data-testid="desktop-sidebar-title"
        >
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-gradient-to-br from-primary/90 to-primary shadow-sm transition-shadow group-hover:shadow-md">
            <BrandGlyph className="h-4 w-4 text-white" />
          </span>
          <span className="truncate text-base font-bold tracking-tight text-foreground">{title}</span>
        </button>
      </div>

      <nav className="sidebar-nav-scrollbar flex-1 space-y-5 overflow-y-auto px-3 py-4">
        {adminItems.length > 0 && (
          <section>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="nav-admin-menu">
              Amministrazione
            </p>
            <div className="space-y-1">
              {adminItems.map((item) => (
                <Button
                  key={item.path}
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation(item.path)}
                  className={sidebarItemClass(location === item.path)}
                  data-testid={`nav-${item.path.replace(/\//g, '')}`}
                >
                  <item.icon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Button>
              ))}
            </div>
          </section>
        )}

        {isAdminOrSuper && (
          <section>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Organizzazione
            </p>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setLocation('/admin')}
              className={sidebarItemClass(location === '/admin')}
              data-testid="nav-gestione-organizzazione"
            >
              <Building2 className="mr-2 h-4 w-4 shrink-0" />
              <span className="truncate">Gestione organizzazione</span>
            </Button>
          </section>
        )}

        {garaItems.length > 0 && (
          <section>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="nav-gara-menu">
              Performance
            </p>
            <div className="space-y-1">
              {garaItems.map((item) => (
                <Button
                  key={item.path}
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation(item.path)}
                  className={sidebarItemClass(location === item.path)}
                  data-testid={`nav-gara-${item.path.replace(/\//g, '')}`}
                >
                  <item.icon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Button>
              ))}
            </div>
          </section>
        )}

        {simulatoreItems.length > 0 && (
          <section>
            <p className="mb-1.5 px-3 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground" data-testid="nav-simulatore-menu">
              Simulatore
            </p>
            <div className="space-y-1">
              {simulatoreItems.map((item) => (
                <Button
                  key={item.path}
                  variant="ghost"
                  size="sm"
                  onClick={() => setLocation(item.path)}
                  className={sidebarItemClass(location === item.path)}
                  data-testid={`nav-sim-${item.path.replace(/\//g, '')}`}
                >
                  <item.icon className="mr-2 h-4 w-4 shrink-0" />
                  <span className="truncate">{item.label}</span>
                </Button>
              ))}
            </div>
          </section>
        )}
      </nav>

      <div className="flex shrink-0 items-center gap-1 border-t border-border/70 px-4 py-3">
        <ThemeToggle />
        {isAdminOrSuper && <BisuiteSyncNotificationsBell />}
      </div>
    </aside>

    <header
      className="sticky top-0 z-40 glass-panel border-b-0"
      style={{ borderBottom: '1px solid hsl(var(--glass-border))', paddingTop: 'env(safe-area-inset-top)' }}
    >
      <div className="container mx-auto px-3 sm:px-6 py-2.5 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0 lg:hidden">
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setLocation('/')}
            data-testid="text-app-title"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-gradient-to-br from-primary/90 to-primary shadow-sm group-hover:shadow-md transition-shadow">
              <BrandGlyph className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-foreground truncate tracking-tight">
              {title}
            </h1>
          </div>

        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-2 min-w-0">
          {children}

          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-lg h-11 w-11" data-testid="button-mobile-menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-60 max-h-[75dvh] overflow-y-auto [&_[role=menuitem]]:min-h-11">
                {adminItems.length > 0 && (
                  <>
                    {adminItems.map((item) => (
                      <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)}>
                        <item.icon className="mr-2 h-4 w-4" />
                        <span>{item.label}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {isAdminOrSuper && (
                  <>
                    <DropdownMenuItem onClick={() => setLocation('/admin')}>
                      <Building2 className="mr-2 h-4 w-4" />
                      <span>Gestione organizzazione</span>
                    </DropdownMenuItem>
                    <DropdownMenuSeparator />
                  </>
                )}
                {garaItems.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Performance</DropdownMenuLabel>
                    {garaItems.map((item) => (
                      <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)}>
                        <item.icon className="mr-2 h-4 w-4" />
                        <span>{item.label}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                {simulatoreItems.length > 0 && (
                  <>
                    <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Simulatore</DropdownMenuLabel>
                    {simulatoreItems.map((item) => (
                      <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)}>
                        <item.icon className="mr-2 h-4 w-4" />
                        <span>{item.label}</span>
                      </DropdownMenuItem>
                    ))}
                    <DropdownMenuSeparator />
                  </>
                )}
                <DropdownMenuItem onClick={() => setLocation('/profile')}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Impostazioni</span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-[10px] uppercase tracking-wider text-muted-foreground font-medium">Tema</DropdownMenuLabel>
                {themeOptions.map((opt) => (
                  <DropdownMenuItem
                    key={opt.value}
                    onClick={() => chooseAppearance(opt.value)}
                    className={
                      (opt.value === 'prisma-light'
                        ? dashboardStyle === 'prisma-light'
                        : dashboardStyle === 'standard' && theme === opt.value)
                        ? 'bg-accent'
                        : ''
                    }
                    data-testid={`theme-option-mobile-${opt.value}`}
                  >
                    <opt.icon className="mr-2 h-4 w-4" />
                    <span>{opt.label}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-11 w-11 lg:h-9 lg:w-9 rounded-full" data-testid="button-user-menu">
                <Avatar key={profile?.profileImageUrl ? 'avatar-image' : 'avatar-fallback'} className="h-9 w-9 ring-2 ring-border/50 ring-offset-1 ring-offset-background">
                  {profile?.profileImageUrl && (
                    <AvatarImage src={profile.profileImageUrl} alt="" data-testid="avatar-user-image" />
                  )}
                  <AvatarFallback className="bg-gradient-to-br from-primary/90 to-primary text-white text-xs font-semibold" data-testid="avatar-user-fallback">
                    {getInitials()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-semibold leading-none">{profile?.full_name || 'Utente'}</p>
                  <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation('/profile')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Impostazioni utente</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem disabled>
                <User className="mr-2 h-4 w-4" />
                <span>{getRoleLabel()}</span>
              </DropdownMenuItem>
              <DropdownMenuItem disabled>
                <Building2 className="mr-2 h-4 w-4" />
                <span className="truncate">{organization?.name || 'Organizzazione'}</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={handleSignOut} className="text-red-600 focus:text-red-600">
                <LogOut className="mr-2 h-4 w-4" />
                <span>Esci</span>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
    {isPrismaDashboard && prismaMobileItems.length > 0 && (
      <nav
        className="pl-mobile-bottom lg:hidden"
        aria-label="Navigazione rapida"
        data-testid="prisma-mobile-bottom-bar"
      >
        {prismaMobileItems.map((item) => {
          const active = location === item.path;
          return (
            <button
              key={item.path}
              type="button"
              className={`pl-mobile-bottom-item ${active ? 'is-active' : ''}`}
              onClick={() => setLocation(item.path)}
              aria-current={active ? 'page' : undefined}
              data-testid={`prisma-mobile-nav-${item.path.replace(/\//g, '')}`}
            >
              <item.icon className="h-5 w-5" />
              <span>{item.label.replace(' BiSuite', '')}</span>
            </button>
          );
        })}
      </nav>
    )}
    </>
  );
}
