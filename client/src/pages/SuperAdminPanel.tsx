import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Users, Building2, Trash2 } from 'lucide-react';
import { BiSuiteConnectionForm } from '@/components/BiSuiteConnectionForm';
import { BiSuiteSalesTest } from '@/components/BiSuiteSalesTest';
import { z } from 'zod';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';

const createAdminSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(6, 'La password deve avere almeno 6 caratteri'),
  fullName: z.string().min(2, 'Il nome deve avere almeno 2 caratteri'),
  organizationName: z.string().min(2, 'Il nome organizzazione deve avere almeno 2 caratteri'),
});

interface Organization {
  id: string;
  name: string;
  created_at: string;
}

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  organization_id: string | null;
}

export default function SuperAdminPanel() {
  const [, setLocation] = useLocation();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [allProfiles, setAllProfiles] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  
  // Form state
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');

  useEffect(() => {
    if (profile && profile.role !== 'super_admin') {
      setLocation('/');
    }
  }, [profile, setLocation]);

  useEffect(() => {
    if (profile?.role === 'super_admin') {
      fetchData();
    }
  }, [profile]);

  const fetchData = async () => {
    setLoading(true);
    
    try {
      const [orgsRes, profilesRes] = await Promise.all([
        fetch('/api/admin/organizations', { credentials: 'include' }),
        fetch('/api/admin/profiles', { credentials: 'include' }),
      ]);

      if (orgsRes.ok) {
        const orgsData = await orgsRes.json();
        setOrganizations(orgsData);
      }
      if (profilesRes.ok) {
        const profilesData = await profilesRes.json();
        setAllProfiles(profilesData);
      }
    } catch (err) {
      console.error('Error fetching data:', err);
    }
    
    setLoading(false);
  };

  const handleCreateAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = createAdminSchema.safeParse({ email, password, fullName, organizationName });
    if (!validation.success) {
      toast({
        title: 'Errore di validazione',
        description: validation.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    
    const res = await fetch('/api/admin/create-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        email,
        password,
        fullName,
        role: 'admin',
        organizationName,
      }),
    });
    const data = await res.json();

    setLoading(false);

    if (!res.ok || data?.error) {
      toast({
        title: 'Errore',
        description: data?.error || 'Errore nella creazione dell\'admin',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Admin creato',
        description: `Admin ${email} creato con successo per ${organizationName}`,
      });
      setEmail('');
      setPassword('');
      setFullName('');
      setOrganizationName('');
      setDialogOpen(false);
      fetchData();
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeletingId(userId);
    
    const res = await fetch('/api/admin/delete-entity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'user', id: userId }),
    });
    const data = await res.json();

    setDeletingId(null);

    if (!res.ok || data?.error) {
      toast({
        title: 'Errore',
        description: data?.error || 'Errore nell\'eliminazione dell\'utente',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Utente eliminato',
        description: 'L\'utente è stato eliminato con successo',
      });
      fetchData();
    }
  };

  const handleDeleteOrganization = async (orgId: string) => {
    setDeletingId(orgId);
    
    const res = await fetch('/api/admin/delete-entity', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'organization', id: orgId }),
    });
    const data = await res.json();

    setDeletingId(null);

    if (!res.ok || data?.error) {
      toast({
        title: 'Errore',
        description: data?.error || 'Errore nell\'eliminazione dell\'organizzazione',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Organizzazione eliminata',
        description: 'L\'organizzazione e tutti i suoi utenti sono stati eliminati',
      });
      fetchData();
    }
  };

  const getUserCountForOrg = (orgId: string) => {
    return allProfiles.filter(p => p.organization_id === orgId).length;
  };

  const isMyOrganization = (orgId: string) => {
    return profile?.organization_id === orgId;
  };

  const getRoleBadgeVariant = (role: string) => {
    switch (role) {
      case 'super_admin': return 'destructive';
      case 'admin': return 'default';
      default: return 'secondary';
    }
  };

  const getRoleLabel = (role: string) => {
    switch (role) {
      case 'super_admin': return 'Super Admin';
      case 'admin': return 'Admin';
      case 'operatore': return 'Operatore';
      default: return role;
    }
  };

  const getOrgName = (orgId: string | null) => {
    if (!orgId) return '-';
    const org = organizations.find(o => o.id === orgId);
    return org?.name || '-';
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (profile?.role !== 'super_admin') {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-4">
      <div className="max-w-6xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <Button 
            variant="ghost" 
            onClick={() => setLocation('/')}
          >
            <ArrowLeft className="mr-2 h-4 w-4" />
            Torna al simulatore
          </Button>
          
          <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
            <DialogTrigger asChild>
              <Button>
                <Plus className="mr-2 h-4 w-4" />
                Crea Admin + Organizzazione
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>Crea nuovo Admin</DialogTitle>
                <DialogDescription>
                  Crea una nuova organizzazione con il suo amministratore
                </DialogDescription>
              </DialogHeader>
              <form onSubmit={handleCreateAdmin} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="org-name">Nome Organizzazione</Label>
                  <Input
                    id="org-name"
                    placeholder="Nome azienda"
                    value={organizationName}
                    onChange={(e) => setOrganizationName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-name">Nome Admin</Label>
                  <Input
                    id="admin-name"
                    placeholder="Mario Rossi"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-email">Email Admin</Label>
                  <Input
                    id="admin-email"
                    type="email"
                    placeholder="admin@azienda.com"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="admin-password">Password</Label>
                  <Input
                    id="admin-password"
                    type="password"
                    placeholder="••••••••"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Creazione...
                    </>
                  ) : (
                    'Crea Admin'
                  )}
                </Button>
              </form>
            </DialogContent>
          </Dialog>
        </div>

        <div className="grid gap-6 md:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Organizzazioni ({organizations.length})
              </CardTitle>
              <CardDescription>
                Tutte le organizzazioni registrate
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>ID</TableHead>
                      <TableHead>Utenti</TableHead>
                      <TableHead>Creata il</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {organizations.map((org) => (
                      <TableRow key={org.id}>
                        <TableCell className="font-medium">{org.name}</TableCell>
                        <TableCell>
                          <code className="text-xs bg-muted px-1.5 py-0.5 rounded font-mono">
                            {org.id}
                          </code>
                        </TableCell>
                        <TableCell>{getUserCountForOrg(org.id)}</TableCell>
                        <TableCell>
                          {new Date(org.created_at).toLocaleDateString('it-IT')}
                        </TableCell>
                        <TableCell>
                          {!isMyOrganization(org.id) && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  disabled={deletingId === org.id}
                                >
                                  {deletingId === org.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Elimina organizzazione</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Sei sicuro di voler eliminare <strong>{org.name}</strong>?
                                    Questa azione eliminerà anche tutti i {getUserCountForOrg(org.id)} utenti associati.
                                    L'azione è irreversibile.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteOrganization(org.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Elimina
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                Utenti ({allProfiles.length})
              </CardTitle>
              <CardDescription>
                Tutti gli utenti registrati
              </CardDescription>
            </CardHeader>
            <CardContent>
              {loading ? (
                <div className="flex justify-center py-4">
                  <Loader2 className="h-6 w-6 animate-spin" />
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Nome</TableHead>
                      <TableHead>Ruolo</TableHead>
                      <TableHead>Org</TableHead>
                      <TableHead className="w-[50px]"></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {allProfiles.map((p) => (
                      <TableRow key={p.id}>
                        <TableCell>
                          <div>
                            <p className="font-medium">{p.full_name || '-'}</p>
                            <p className="text-xs text-muted-foreground">{p.email}</p>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(p.role)}>
                            {getRoleLabel(p.role)}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-sm">
                          {getOrgName(p.organization_id)}
                        </TableCell>
                        <TableCell>
                          {p.role !== 'super_admin' && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  disabled={deletingId === p.id}
                                >
                                  {deletingId === p.id ? (
                                    <Loader2 className="h-4 w-4 animate-spin" />
                                  ) : (
                                    <Trash2 className="h-4 w-4" />
                                  )}
                                </Button>
                              </AlertDialogTrigger>
                              <AlertDialogContent>
                                <AlertDialogHeader>
                                  <AlertDialogTitle>Elimina utente</AlertDialogTitle>
                                  <AlertDialogDescription>
                                    Sei sicuro di voler eliminare <strong>{p.full_name || p.email}</strong>?
                                    L'azione è irreversibile.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteUser(p.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Elimina
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </div>

        {/* BiSuite API Connection */}
        <BiSuiteConnectionForm 
          organizations={organizations}
          onCredentialsSaved={() => {
            console.log('BiSuite credentials saved');
          }}
        />

        {/* BiSuite Sales Test */}
        <BiSuiteSalesTest organizations={organizations} />
      </div>
    </div>
  );
}
