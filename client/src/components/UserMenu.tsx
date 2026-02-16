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
import { LogOut, User, Building2, Settings, Shield, Users, LayoutDashboard, Table2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export function UserMenu() {
  const [, setLocation] = useLocation();
  const { user, profile, organization, signOut } = useAuth();
  const { toast } = useToast();

  const handleSignOut = async () => {
    const { error } = await signOut();
    if (error) {
      toast({
        title: 'Errore',
        description: 'Errore durante il logout',
        variant: 'destructive',
      });
    } else {
      window.location.href = `${BASE_PATH}/auth`;
    }
  };

  const getInitials = () => {
    if (profile?.full_name) {
      return profile.full_name
        .split(' ')
        .map(n => n[0])
        .join('')
        .toUpperCase()
        .slice(0, 2);
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="ghost" className="relative h-10 w-10 rounded-full">
          <Avatar className="h-10 w-10">
            <AvatarFallback className="bg-primary text-primary-foreground">
              {getInitials()}
            </AvatarFallback>
          </Avatar>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent className="w-56" align="end" forceMount>
        <DropdownMenuLabel className="font-normal">
          <div className="flex flex-col space-y-1">
            <p className="text-sm font-medium leading-none">
              {profile?.full_name || 'Utente'}
            </p>
            <p className="text-xs leading-none text-muted-foreground">
              {user?.email}
            </p>
          </div>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        
        {profile?.role === 'super_admin' && (
          <DropdownMenuItem onClick={() => setLocation('/super-admin')}>
            <Shield className="mr-2 h-4 w-4" />
            <span>Pannello Super Admin</span>
          </DropdownMenuItem>
        )}
        
        {['super_admin', 'admin'].includes(profile?.role || '') && (
          <DropdownMenuItem onClick={() => setLocation('/admin')}>
            <Users className="mr-2 h-4 w-4" />
            <span>Gestione Team</span>
          </DropdownMenuItem>
        )}
        
        {['super_admin', 'admin'].includes(profile?.role || '') && (
          <DropdownMenuItem onClick={() => setLocation('/tabelle-calcolo')} data-testid="menu-tabelle-calcolo">
            <Table2 className="mr-2 h-4 w-4" />
            <span>Tabelle di Calcolo</span>
          </DropdownMenuItem>
        )}
        
        <DropdownMenuItem onClick={() => setLocation('/dashboard')}>
          <LayoutDashboard className="mr-2 h-4 w-4" />
          <span>Dashboard</span>
        </DropdownMenuItem>
        
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
  );
}
