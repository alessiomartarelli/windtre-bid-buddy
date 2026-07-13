import { useLocation } from 'wouter';
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
import { Avatar, AvatarFallback } from '@/components/ui/avatar';
import {
  LogOut, User, Building2, Settings, Shield, Users,
  LayoutDashboard, Table2, ShoppingCart, MapPin, FileText, Menu, Trophy,
  ChevronDown, BookOpen, BarChart3, Route, Medal, Sun, Moon, Monitor,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { BisuiteSyncNotificationsBell } from '@/components/BisuiteSyncNotificationsBell';
import { BrandGlyph } from '@/components/BrandLogo';
import { useTheme, type Theme } from '@/hooks/useTheme';

const themeOptions: Array<{ value: Theme; label: string; icon: typeof Sun }> = [
  { value: 'light', label: 'Chiaro', icon: Sun },
  { value: 'dark', label: 'Scuro', icon: Moon },
  { value: 'system', label: 'Sistema', icon: Monitor },
];

function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme();
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-lg h-9 w-9"
          data-testid="button-theme-toggle"
          aria-label="Cambia tema"
        >
          {resolvedTheme === 'dark' ? (
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
            onClick={() => setTheme(opt.value)}
            className={theme === opt.value ? 'bg-accent' : ''}
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
  const { theme, setTheme } = useTheme();

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({ title: 'Errore', description: 'Errore durante il logout', variant: 'destructive' });
    } else {
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
    ...(isSuperAdmin ? [{ path: '/mappatura-bisuite', label: 'Mappatura', icon: MapPin }] : []),
    ...(isAdminOrSuper && isEnabled('mappatura_bisuite') ? [{ path: '/canvass-vodafone-fastweb', label: 'Canvass VF', icon: MapPin }] : []),
  ];

  const simulatoreItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    ...(isEnabled('simulatore') ? [{ path: '/simulatore', label: 'Simulatore', icon: FileText }] : []),
    ...(isEnabled('simulatore') ? [{ path: '/dashboard', label: 'Dashboard Sim.', icon: LayoutDashboard }] : []),
    ...(isAdminOrSuper && isEnabled('tabelle_calcolo') ? [{ path: '/tabelle-calcolo', label: 'Tabelle Calcolo', icon: Table2 }] : []),
  ];

  return (
    <header className="sticky top-0 z-50 glass-panel border-b-0" style={{ borderBottom: '1px solid hsl(var(--glass-border))' }}>
      <div className="container mx-auto px-3 sm:px-6 py-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
          <div
            className="flex items-center gap-2 cursor-pointer group"
            onClick={() => setLocation('/')}
            data-testid="text-app-title"
          >
            <div className="flex items-center justify-center h-8 w-8 rounded-lg bg-gradient-to-br from-indigo-500 to-indigo-600 shadow-sm group-hover:shadow-md transition-shadow">
              <BrandGlyph className="h-4 w-4 text-white" />
            </div>
            <h1 className="text-base sm:text-lg font-bold text-foreground truncate tracking-tight">
              {title}
            </h1>
          </div>

          <nav className="hidden lg:flex items-center gap-0.5 ml-1 min-w-0">
            {adminItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={adminItems.some(i => location === i.path) ? "secondary" : "ghost"}
                    size="sm"
                    className={`text-xs h-8 rounded-lg transition-all ${adminItems.some(i => location === i.path) ? 'shadow-sm' : ''}`}
                    data-testid="nav-admin-menu"
                  >
                    <Shield className="h-3.5 w-3.5 mr-1" />
                    Admin
                    <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {adminItems.map((item) => (
                    <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)} data-testid={`nav-${item.path.replace(/\//g, '')}`}>
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {adminItems.length > 0 && <div className="w-px h-5 bg-border/60 mx-1.5" />}

            {garaItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={garaItems.some(i => location === i.path) ? "secondary" : "ghost"}
                    size="sm"
                    className={`text-xs h-8 rounded-lg transition-all ${garaItems.some(i => location === i.path) ? 'shadow-sm' : ''}`}
                    data-testid="nav-gara-menu"
                  >
                    <Trophy className="h-3.5 w-3.5 mr-1" />
                    Performance
                    <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {garaItems.map((item) => (
                    <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)} data-testid={`nav-gara-${item.path.replace(/\//g, '')}`}>
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}

            {simulatoreItems.length > 0 && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant={(simulatoreItems.some(i => location === i.path) || location === '/preventivatore') ? "secondary" : "ghost"}
                    size="sm"
                    className={`text-xs h-8 rounded-lg transition-all ${(simulatoreItems.some(i => location === i.path) || location === '/preventivatore') ? 'shadow-sm' : ''}`}
                    data-testid="nav-simulatore-menu"
                  >
                    <FileText className="h-3.5 w-3.5 mr-1" />
                    Simulatore
                    <ChevronDown className="h-3 w-3 ml-0.5 opacity-50" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start">
                  {simulatoreItems.map((item) => (
                    <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)} data-testid={`nav-sim-${item.path.replace(/\//g, '')}`}>
                      <item.icon className="mr-2 h-4 w-4" />
                      <span>{item.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {children}

          <ThemeToggle />

          {isAdminOrSuper && <BisuiteSyncNotificationsBell />}

          {isAdminOrSuper && (
            <Button
              variant={location === '/admin' ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setLocation('/admin')}
              className={`hidden lg:inline-flex text-xs h-8 rounded-lg transition-all ${location === '/admin' ? 'shadow-sm' : ''}`}
              data-testid="nav-gestione-organizzazione"
            >
              <Building2 className="h-3.5 w-3.5 mr-1" />
              Gestione organizzazione
            </Button>
          )}

          <div className="lg:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" className="rounded-lg" data-testid="button-mobile-menu">
                  <Menu className="h-5 w-5" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
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
                    onClick={() => setTheme(opt.value)}
                    className={theme === opt.value ? 'bg-accent' : ''}
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
              <Button variant="ghost" className="relative h-9 w-9 rounded-full" data-testid="button-user-menu">
                <Avatar className="h-9 w-9 ring-2 ring-border/50 ring-offset-1 ring-offset-background">
                  <AvatarFallback className="bg-gradient-to-br from-indigo-500 to-indigo-600 text-white text-xs font-semibold">
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
  );
}
