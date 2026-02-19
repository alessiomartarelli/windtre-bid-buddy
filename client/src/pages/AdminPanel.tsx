import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from "@/lib/basePath";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { Switch } from '@/components/ui/switch';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Plus, Users, Trash2, Pencil, Eye, EyeOff, KeyRound, UserX, UserCheck } from 'lucide-react';
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

interface TeamMember {
  id: string;
  full_name: string | null;
  fullName?: string | null;
  email: string | null;
  role: string;
  organization_id: string | null;
  organizationId?: string | null;
  is_active?: boolean;
  isActive?: boolean;
}

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const { profile, organization, loading: authLoading } = useAuth();
  const { toast } = useToast();
  
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [passwordDialogOpen, setPasswordDialogOpen] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [editingUser, setEditingUser] = useState<TeamMember | null>(null);
  const [passwordUser, setPasswordUser] = useState<TeamMember | null>(null);
  
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [createRole, setCreateRole] = useState<'operatore' | 'admin'>('operatore');
  const [showPassword, setShowPassword] = useState(false);
  
  const [editFullName, setEditFullName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editRole, setEditRole] = useState<'operatore' | 'admin'>('operatore');

  const [newPassword, setNewPassword] = useState('');
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [currentPasswordSelf, setCurrentPasswordSelf] = useState('');
  const [showCurrentPasswordSelf, setShowCurrentPasswordSelf] = useState(false);

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
      const res = await fetch(apiUrl('/api/admin/team-members'), { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setTeamMembers(data);
      }
    } catch (err) {
      console.error('Error fetching team members:', err);
    }
    setLoading(false);
  };

  const getMemberName = (m: TeamMember) => m.full_name || m.fullName || '-';
  const getMemberActive = (m: TeamMember) => m.is_active !== undefined ? m.is_active : (m.isActive !== undefined ? m.isActive : true);

  const handleCreateOperatore = async (e: React.FormEvent) => {
    e.preventDefault();
    const validation = createOperatoreSchema.safeParse({ email, password, fullName });
    if (!validation.success) {
      toast({ title: 'Errore di validazione', description: validation.error.errors[0].message, variant: 'destructive' });
      return;
    }
    setLoading(true);
    const res = await fetch(apiUrl('/api/admin/create-user'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ email, password, fullName, role: createRole, organizationId: profile?.organization_id }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok || data?.error) {
      toast({ title: 'Errore', description: data?.error || 'Errore nella creazione dell\'utente', variant: 'destructive' });
    } else {
      toast({ title: 'Utente creato', description: `${createRole === 'admin' ? 'Admin' : 'Operatore'} ${email} creato con successo` });
      setEmail(''); setPassword(''); setFullName(''); setCreateRole('operatore');
      setDialogOpen(false);
      fetchTeamMembers();
    }
  };

  const handleDeleteUser = async (userId: string) => {
    setDeletingId(userId);
    const res = await fetch(apiUrl('/api/admin/delete-entity'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ type: 'user', id: userId }),
    });
    const data = await res.json();
    setDeletingId(null);
    if (!res.ok || data?.error) {
      toast({ title: 'Errore', description: data?.error || 'Errore nell\'eliminazione dell\'utente', variant: 'destructive' });
    } else {
      toast({ title: 'Utente eliminato', description: 'L\'operatore e stato eliminato con successo' });
      fetchTeamMembers();
    }
  };

  const openEditDialog = (user: TeamMember) => {
    setEditingUser(user);
    setEditFullName(getMemberName(user));
    setEditEmail(user.email || '');
    setEditRole((user.role === 'admin' ? 'admin' : 'operatore') as 'operatore' | 'admin');
    setEditDialogOpen(true);
  };

  const handleUpdateUser = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingUser) return;
    const validation = updateUserSchema.safeParse({ fullName: editFullName, email: editEmail });
    if (!validation.success) {
      toast({ title: 'Errore di validazione', description: validation.error.errors[0].message, variant: 'destructive' });
      return;
    }
    setLoading(true);
    const res = await fetch(apiUrl('/api/admin/update-user'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: editingUser.id, fullName: editFullName, email: editEmail, role: editRole }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok || data?.error) {
      toast({ title: 'Errore', description: data?.error || 'Errore nell\'aggiornamento dell\'utente', variant: 'destructive' });
    } else {
      toast({ title: 'Utente aggiornato', description: 'Le modifiche sono state salvate' });
      setEditDialogOpen(false); setEditingUser(null);
      fetchTeamMembers();
    }
  };

  const openPasswordDialog = (user: TeamMember) => {
    setPasswordUser(user);
    setNewPassword('');
    setShowNewPassword(false);
    setCurrentPasswordSelf('');
    setShowCurrentPasswordSelf(false);
    setPasswordDialogOpen(true);
  };

  const isSelfPasswordChange = passwordUser?.id === profile?.id;

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!passwordUser) return;
    if (newPassword.length < 6) {
      toast({ title: 'Errore', description: 'La password deve avere almeno 6 caratteri', variant: 'destructive' });
      return;
    }
    setLoading(true);
    let res;
    if (isSelfPasswordChange) {
      if (!currentPasswordSelf) {
        toast({ title: 'Errore', description: 'Inserisci la password attuale', variant: 'destructive' });
        setLoading(false);
        return;
      }
      res = await fetch(apiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: currentPasswordSelf, newPassword }),
      });
    } else {
      res = await fetch(apiUrl('/api/admin/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ userId: passwordUser.id, newPassword }),
      });
    }
    const data = await res.json();
    setLoading(false);
    if (!res.ok || data?.error) {
      toast({ title: 'Errore', description: data?.error || 'Errore nel cambio password', variant: 'destructive' });
    } else {
      toast({ title: 'Password aggiornata', description: isSelfPasswordChange ? 'La tua password e stata aggiornata' : `Password di ${getMemberName(passwordUser)} aggiornata con successo` });
      setPasswordDialogOpen(false); setPasswordUser(null); setNewPassword(''); setCurrentPasswordSelf('');
    }
  };

  const handleToggleActive = async (user: TeamMember) => {
    const currentActive = getMemberActive(user);
    const res = await fetch(apiUrl('/api/admin/toggle-active'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ userId: user.id, isActive: !currentActive }),
    });
    const data = await res.json();
    if (!res.ok || data?.error) {
      toast({ title: 'Errore', description: data?.error || 'Errore nell\'aggiornamento dello stato', variant: 'destructive' });
    } else {
      toast({
        title: !currentActive ? 'Utente attivato' : 'Utente disattivato',
        description: `${getMemberName(user)} e stato ${!currentActive ? 'attivato' : 'disattivato'}`,
      });
      fetchTeamMembers();
    }
  };

  const getRoleBadgeVariant = (role: string): "destructive" | "default" | "secondary" => {
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

  const canDeleteUser = (user: TeamMember) => {
    if (user.id === profile?.id) return false;
    if (profile?.role === 'super_admin') return true;
    if (profile?.role === 'admin') return true;
    return false;
  };

  const canEditUser = (user: TeamMember) => {
    if (profile?.role === 'super_admin') return true;
    if (profile?.role === 'admin') return true;
    return false;
  };

  const canChangePassword = (user: TeamMember) => {
    if (user.id === profile?.id) return true;
    if (profile?.role === 'super_admin') return true;
    if (profile?.role === 'admin') return true;
    return false;
  };

  const canToggleActive = (user: TeamMember) => {
    if (user.id === profile?.id) return false;
    if (profile?.role === 'super_admin') return true;
    if (profile?.role === 'admin') return true;
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
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => setLocation('/')}
          data-testid="button-back"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna al simulatore
        </Button>

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
                  data-testid="input-edit-name"
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
                  data-testid="input-edit-email"
                  type="email"
                  placeholder="email@esempio.com"
                  value={editEmail}
                  onChange={(e) => setEditEmail(e.target.value)}
                  required
                />
              </div>
              {editingUser && editingUser.role !== 'super_admin' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Ruolo</Label>
                  <Select value={editRole} onValueChange={(v) => setEditRole(v as 'operatore' | 'admin')}>
                    <SelectTrigger data-testid="select-edit-role">
                      <SelectValue placeholder="Seleziona ruolo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operatore">Operatore</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-edit">
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</>
                ) : 'Salva modifiche'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isSelfPasswordChange ? 'Cambia la tua Password' : 'Cambia Password'}</DialogTitle>
              <DialogDescription>
                {isSelfPasswordChange
                  ? 'Inserisci la password attuale e la nuova password'
                  : `Imposta una nuova password per ${passwordUser ? getMemberName(passwordUser) : ''}`}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {isSelfPasswordChange && (
                <div className="space-y-2">
                  <Label htmlFor="current-password-self">Password attuale</Label>
                  <div className="relative">
                    <Input
                      id="current-password-self"
                      data-testid="input-current-password-self"
                      type={showCurrentPasswordSelf ? 'text' : 'password'}
                      placeholder="Inserisci la password attuale"
                      value={currentPasswordSelf}
                      onChange={(e) => setCurrentPasswordSelf(e.target.value)}
                      required
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setShowCurrentPasswordSelf(!showCurrentPasswordSelf)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      {showCurrentPasswordSelf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password">Nuova Password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    data-testid="input-new-password"
                    type={showNewPassword ? 'text' : 'password'}
                    placeholder="Minimo 6 caratteri"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPassword(!showNewPassword)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-password">
                {loading ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</>
                ) : 'Imposta nuova password'}
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
                Gestisci gli utenti della tua organizzazione
              </CardDescription>
            </div>
            <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
              <DialogTrigger asChild>
                <Button size="sm" className="shrink-0" data-testid="button-add-user">
                  <Plus className="mr-2 h-4 w-4" />
                  <span className="hidden sm:inline">Aggiungi Utente</span>
                  <span className="sm:hidden">Aggiungi</span>
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Nuovo Utente</DialogTitle>
                  <DialogDescription>
                    Aggiungi un nuovo utente al team di {organization?.name}
                  </DialogDescription>
                </DialogHeader>
                <form onSubmit={handleCreateOperatore} className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="op-name">Nome</Label>
                    <Input
                      id="op-name"
                      data-testid="input-create-name"
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
                      data-testid="input-create-email"
                      type="email"
                      placeholder="utente@email.com"
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      required
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="op-role">Ruolo</Label>
                    <Select value={createRole} onValueChange={(v) => setCreateRole(v as 'operatore' | 'admin')}>
                      <SelectTrigger data-testid="select-create-role">
                        <SelectValue placeholder="Seleziona ruolo" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="operatore">Operatore</SelectItem>
                        <SelectItem value="admin">Admin</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="op-password">Password</Label>
                    <div className="relative">
                      <Input
                        id="op-password"
                        data-testid="input-create-password"
                        type={showPassword ? 'text' : 'password'}
                        placeholder="Minimo 6 caratteri"
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
                  <Button type="submit" className="w-full" disabled={loading} data-testid="button-create-user">
                    {loading ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creazione...</>
                    ) : 'Crea Utente'}
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
                    <TableHead>Stato</TableHead>
                    <TableHead className="w-[140px]">Azioni</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {teamMembers.map((member) => {
                    const isActive = getMemberActive(member);
                    return (
                      <TableRow key={member.id} className={!isActive ? 'opacity-60' : ''} data-testid={`row-user-${member.id}`}>
                        <TableCell>
                          <div className="font-medium">{getMemberName(member)}</div>
                          <div className="text-xs text-muted-foreground sm:hidden">{member.email}</div>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell">{member.email}</TableCell>
                        <TableCell>
                          <Badge variant={getRoleBadgeVariant(member.role)}>
                            {getRoleLabel(member.role)}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {canToggleActive(member) ? (
                            <div className="flex items-center gap-2">
                              <Switch
                                checked={isActive}
                                onCheckedChange={() => handleToggleActive(member)}
                                data-testid={`switch-active-${member.id}`}
                              />
                              <span className="text-xs text-muted-foreground hidden sm:inline">
                                {isActive ? 'Attivo' : 'Disattivato'}
                              </span>
                            </div>
                          ) : (
                            <Badge variant={isActive ? 'default' : 'secondary'}>
                              {isActive ? 'Attivo' : 'Disattivato'}
                            </Badge>
                          )}
                        </TableCell>
                        <TableCell>
                          <div className="flex gap-1">
                            {canEditUser(member) && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => openEditDialog(member)}
                                data-testid={`button-edit-${member.id}`}
                              >
                                <Pencil className="h-4 w-4" />
                              </Button>
                            )}
                            {canChangePassword(member) && (
                              <Button 
                                variant="ghost" 
                                size="icon"
                                onClick={() => openPasswordDialog(member)}
                                data-testid={`button-password-${member.id}`}
                              >
                                <KeyRound className="h-4 w-4" />
                              </Button>
                            )}
                            {canDeleteUser(member) && (
                              <AlertDialog>
                                <AlertDialogTrigger asChild>
                                  <Button 
                                    variant="ghost" 
                                    size="icon"
                                    className="text-destructive"
                                    disabled={deletingId === member.id}
                                    data-testid={`button-delete-${member.id}`}
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
                                      Sei sicuro di voler eliminare <strong>{getMemberName(member)}</strong>?
                                      L'azione e irreversibile.
                                    </AlertDialogDescription>
                                  </AlertDialogHeader>
                                  <AlertDialogFooter>
                                    <AlertDialogCancel>Annulla</AlertDialogCancel>
                                    <AlertDialogAction
                                      onClick={() => handleDeleteUser(member.id)}
                                      className="bg-destructive text-destructive-foreground"
                                      data-testid={`button-confirm-delete-${member.id}`}
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
                    );
                  })}
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
