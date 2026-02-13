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
import { Loader2, ArrowLeft, Plus, Users, Trash2, Pencil, Eye, EyeOff } from 'lucide-react';
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

const createOperatoreSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(6, 'La password deve avere almeno 6 caratteri'),
  fullName: z.string().min(2, 'Il nome deve avere almeno 2 caratteri'),
});

const updateUserSchema = z.object({
  fullName: z.string().min(2, 'Il nome deve avere almeno 2 caratteri'),
  email: z.string().email('Email non valida'),
});

interface Profile {
  id: string;
  full_name: string | null;
  email: string | null;
  role: string;
  organization_id: string | null;
}

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const { profile, organization, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [teamMembers, setTeamMembers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<Profile | null>(null);
  
  // Form state for create
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  
  // Form state for edit
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');

  useEffect(() => {
    if (profile && !['super_admin', 'admin'].includes(profile.role)) {
      setLocation('/');
    }
  }, [profile, setLocation]);

  useEffect(() => {
    if (profile && ['super_admin', 'admin'].includes(profile.role)) {
      fetchTeamMembers();
    }
  }, [profile]);

  const fetchTeamMembers = async () => {
    setLoading(true);
    
    try {
      const res = await fetch('/api/admin/team-members', { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data);
      }
    } catch (err) {
      console.error('Error fetching team members:', err);
    }
    
    setLoading(false);
  };

  const handleCreateOperatore = async (e: React.FormEvent) => {
    e.preventDefault();
    
    const validation = createOperatoreSchema.safeParse({ email, password, fullName });
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
        role: 'operatore',
        organizationId: profile?.organization_id,
      }),
    });
    const data = await res.json();

    setLoading(false);

    if (!res.ok || data?.error) {
      toast({
        title: 'Errore',
        description: data?.error || 'Errore nella creazione dell\'operatore',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Operatore creato',
        description: `Operatore ${email} creato con successo`,
      });
      setEmail('');
      setPassword('');
      setFullName('');
      setDialogOpen(false);
      fetchTeamMembers();
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
        description: 'L\'operatore è stato eliminato con successo',
      });
      fetchTeamMembers();
    }
  };

  const openEditDialog = (user: Profile) => {
    setEditingUser(user);
    setEditFullName(user.full_name || '');
    setEditEmail(user.email || '');
    setEditDialogOpen(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!editingUser) return;

    const validation = updateUserSchema.safeParse({ fullName: editFullName, email: editEmail });
    if (!validation.success) {
      toast({
        title: 'Errore di validazione',
        description: validation.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    
    const res = await fetch('/api/admin/update-user', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({
        userId: editingUser.id,
        fullName: editFullName,
        email: editEmail,
      }),
    });
    const data = await res.json();

    setLoading(false);

    if (!res.ok || data?.error) {
      toast({
        title: 'Errore',
        description: data?.error || 'Errore nell\'aggiornamento dell\'utente',
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Utente aggiornato',
        description: 'Le modifiche sono state salvate',
      });
      setEditDialogOpen(false);
      setEditingUser(null);
      fetchTeamMembers();
    }
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

  const canDeleteUser = (user: Profile) => {
    if (user.id === profile?.id) return false;
    if (profile?.role === 'super_admin') return true;
    if (profile?.role === 'admin' && user.role === 'operatore') return true;
    return false;
  };

  const canEditUser = (user: Profile) => {
    if (profile?.role === 'super_admin') return true;
    if (profile?.role === 'admin') {
      if (user.id === profile?.id) return true;
      if (user.role === 'operatore') return true;
    }
    return false;
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  if (!profile || !['super_admin', 'admin'].includes(profile.role)) {
    return null;
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-3 sm:p-4">
      <div className="max-w-4xl mx-auto space-y-4 sm:space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => setLocation('/')}
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna al simulatore
        </Button>

        {/* Edit Dialog */}
        <Dialog open={editDialogOpen} onOpenChange={setEditDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Modifica Utente</DialogTitle>
              <DialogDescription>
                Modifica i dati di {editingUser?.email}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleUpdateUser} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="edit-name">Nome</Label>
                <Input
                  id="edit-name"
                  placeholder="Nome Cognome"
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input
                  id="edit-email"
                  type="email"
                  placeholder="email@esempio.com"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </div>
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Salvataggio...
                  </>
                ) : (
                  'Salva modifiche'
                )}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Card>
          <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Users className="h-5 w-5" />
                <span className="truncate">Team di {organization?.name}</span>
              </CardTitle>
              <CardDescription>
                Gestisci gli operatori della tua organizzazione
              </CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="shrink-0">
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Aggiungi Operatore</span>
                  <span className="sm:hidden">Aggiungi</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuovo Operatore</DialogTitle>
                  <DialogDescription>
                    Aggiungi un nuovo operatore al team di {organization?.name}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateOperatore} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="op-name">Nome</Label>
                    <Input
                      id="op-name"
                      placeholder="Nome Cognome"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="op-email">Email</Label>
                    <Input
                      id="op-email"
                      type="email"
                      placeholder="operatore@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="op-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="op-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="••••••••"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        required
                        className="pr-10"
                      />
                      <button
                        type="button"
                        onClick={() => setShowPassword(!showPassword)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                  </div>
                  <Button type="submit" className="w-full" disabled={loading}>
                    {loading ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Creazione...
                      </>
                    ) : (
                      'Crea Operatore'
                    )}
                  </Button>
                </form>
              </DialogContent>
            </Dialog>
          </CardHeader>
          <CardContent>
            {loading && teamMembers.length === 0 ? (
              <div className="flex justify-center py-4">
                <Loader2 className="h-6 w-6 animate-spin" />
              </div>
            ) : (
              <div className="overflow-x-auto -mx-4 sm:mx-0">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Nome</TableHead>
                    <TableHead className="hidden sm:table-cell">Email</TableHead>
                    <TableHead>Ruolo</TableHead>
                    <TableHead className="w-[80px]">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMembers.map((member) => (
                    <TableRow key={member.id}>
                      <TableCell>
                        <div className="font-medium">{member.full_name || '-'}</div>
                        <div className="text-xs text-muted-foreground sm:hidden">{member.email}</div>
                      </TableCell>
                      <TableCell className="hidden sm:table-cell">{member.email}</TableCell>
                      <TableCell>
                        <Badge variant={getRoleBadgeVariant(member.role)}>
                          {getRoleLabel(member.role)}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <div className="flex gap-1">
                          {canEditUser(member) && (
                            <Button 
                              variant="ghost" 
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => openEditDialog(member)}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                          )}
                          {canDeleteUser(member) && (
                            <AlertDialog>
                              <AlertDialogTrigger asChild>
                                <Button 
                                  variant="ghost" 
                                  size="icon"
                                  className="h-8 w-8 text-destructive hover:text-destructive"
                                  disabled={deletingId === member.id}
                                >
                                  {deletingId === member.id ? (
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
                                    Sei sicuro di voler eliminare <strong>{member.full_name || member.email}</strong>?
                                    L'azione è irreversibile.
                                  </AlertDialogDescription>
                                </AlertDialogHeader>
                                <AlertDialogFooter>
                                  <AlertDialogCancel>Annulla</AlertDialogCancel>
                                  <AlertDialogAction
                                    onClick={() => handleDeleteUser(member.id)}
                                    className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
                                  >
                                    Elimina
                                  </AlertDialogAction>
                                </AlertDialogFooter>
                              </AlertDialogContent>
                            </AlertDialog>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
