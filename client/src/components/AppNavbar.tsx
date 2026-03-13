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
  LayoutDashboard, Table2, ShoppingCart, MapPin, FileText, Menu,
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

  const navItems: Array<{ path: string; label: string; icon: typeof Shield; show: boolean }> = [
    { path: '/super-admin', label: 'Super Admin', icon: Shield, show: isSuperAdmin },
    { path: '/admin', label: 'Gestione Team', icon: Users, show: isAdminOrSuper },
    { path: '/dashboard-gara-reale', label: 'Dashboard', icon: LayoutDashboard, show: true },
    { path: '/preventivatore', label: 'Simulatore', icon: FileText, show: true },
    { path: '/tabelle-calcolo', label: 'Tabelle Calcolo', icon: Table2, show: isAdminOrSuper },
    { path: '/vendite-bisuite', label: 'Vendite BiSuite', icon: ShoppingCart, show: true },
    { path: '/mappatura-bisuite', label: 'Mappatura', icon: MapPin, show: isSuperAdmin },
  ];

  const visibleItems = navItems.filter(item => item.show);

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
            {visibleItems.map((item) => {
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
                {visibleItems.map((item) => (
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
