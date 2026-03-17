import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
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
  ChevronDown,
} from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

interface AppNavbarProps {
  title?: string;
  children?: React.ReactNode;
}

export function AppNavbar({ title = "Incentive W3", children }: AppNavbarProps) {
  const [location, setLocation] = useLocation();
  const { user, profile, organization, signOut } = useAuth();
  const { toast } = useToast();

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

  const adminItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    ...(isSuperAdmin ? [{ path: '/super-admin', label: 'Super Admin', icon: Shield }] : []),
    ...(isAdminOrSuper ? [{ path: '/admin', label: 'Gestione Team', icon: Users }] : []),
  ];

  const garaItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    { path: '/dashboard-gara-reale', label: 'Dashboard', icon: LayoutDashboard },
    ...(isAdminOrSuper ? [{ path: '/configurazione-gara', label: 'Configurazione', icon: Trophy }] : []),
    { path: '/vendite-bisuite', label: 'Vendite BiSuite', icon: ShoppingCart },
    ...(isSuperAdmin ? [{ path: '/mappatura-bisuite', label: 'Mappatura', icon: MapPin }] : []),
  ];

  const simulatoreItems: Array<{ path: string; label: string; icon: typeof Shield }> = [
    { path: '/preventivatore', label: 'Preventivatore', icon: FileText },
    { path: '/dashboard', label: 'Dashboard Sim.', icon: LayoutDashboard },
    ...(isAdminOrSuper ? [{ path: '/tabelle-calcolo', label: 'Tabelle Calcolo', icon: Table2 }] : []),
  ];

  return (
    <header className="sticky top-0 z-50 border-b bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
      <div className="container mx-auto px-2 sm:px-4 py-2 sm:py-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 sm:gap-3 min-w-0">
          <h1
            className="text-base sm:text-lg font-bold text-foreground truncate cursor-pointer"
            onClick={() => setLocation('/')}
            data-testid="text-app-title"
          >
            {title}
          </h1>

          <nav className="hidden md:flex items-center gap-1 ml-2">
            {adminItems.map((item) => {
              const isActive = location === item.path;
              return (
                <Button
                  key={item.path}
                  variant={isActive ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-8"
                  onClick={() => setLocation(item.path)}
                  data-testid={`nav-${item.path.replace(/\//g, '')}`}
                >
                  <item.icon className="h-3.5 w-3.5 mr-1" />
                  {item.label}
                </Button>
              );
            })}

            {adminItems.length > 0 && <div className="w-px h-5 bg-border mx-1" />}

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={garaItems.some(i => location === i.path) ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-8"
                  data-testid="nav-gara-menu"
                >
                  <Trophy className="h-3.5 w-3.5 mr-1" />
                  Gara
                  <ChevronDown className="h-3 w-3 ml-0.5" />
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

            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant={simulatoreItems.some(i => location === i.path) ? "secondary" : "ghost"}
                  size="sm"
                  className="text-xs h-8"
                  data-testid="nav-simulatore-menu"
                >
                  <FileText className="h-3.5 w-3.5 mr-1" />
                  Simulatore
                  <ChevronDown className="h-3 w-3 ml-0.5" />
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
          </nav>
        </div>

        <div className="flex items-center gap-2">
          {children}

          <div className="md:hidden">
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="ghost" size="icon" data-testid="button-mobile-menu">
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
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Gara</DropdownMenuLabel>
                {garaItems.map((item) => (
                  <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)}>
                    <item.icon className="mr-2 h-4 w-4" />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">Simulatore</DropdownMenuLabel>
                {simulatoreItems.map((item) => (
                  <DropdownMenuItem key={item.path} onClick={() => setLocation(item.path)}>
                    <item.icon className="mr-2 h-4 w-4" />
                    <span>{item.label}</span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => setLocation('/profile')}>
                  <Settings className="mr-2 h-4 w-4" />
                  <span>Impostazioni</span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" className="relative h-9 w-9 rounded-full" data-testid="button-user-menu">
                <Avatar className="h-9 w-9">
                  <AvatarFallback className="bg-primary text-primary-foreground text-xs">
                    {getInitials()}
                  </AvatarFallback>
                </Avatar>
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent className="w-56" align="end" forceMount>
              <DropdownMenuLabel className="font-normal">
                <div className="flex flex-col space-y-1">
                  <p className="text-sm font-medium leading-none">{profile?.full_name || 'Utente'}</p>
                  <p className="text-xs leading-none text-muted-foreground">{user?.email}</p>
                </div>
              </DropdownMenuLabel>
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => setLocation('/profile')}>
                <Settings className="mr-2 h-4 w-4" />
                <span>Impostazioni</span>
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
              <DropdownMenuItem onClick={handleSignOut}>
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
