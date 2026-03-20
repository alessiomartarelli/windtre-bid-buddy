import { useState, useEffect, useCallback } from 'react';
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Users, Trash2, Pencil, Eye, EyeOff, KeyRound, Store, Building2, Download } from 'lucide-react';
import { AppNavbar } from '@/components/AppNavbar';
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

interface OrgPdv {
  codicePos: string;
  nome: string;
  ragioneSociale: string;
}

interface BiSuitePdvImport {
  codicePos: string;
  nomeNegozio: string;
  ragioneSociale: string;
  salesCount: number;
}

export default function AdminPanel() {
  const [, setLocation] = useLocation();
  const { profile, organization, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState("utenti");

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

  const [orgNameDialogOpen, setOrgNameDialogOpen] = useState(false);
  const [orgNameValue, setOrgNameValue] = useState('');
  const [currentPasswordSelf, setCurrentPasswordSelf] = useState('');
  const [showCurrentPasswordSelf, setShowCurrentPasswordSelf] = useState(false);

  const [ragioniSociali, setRagioniSociali] = useState<string[]>([]);
  const [puntiVendita, setPuntiVendita] = useState<OrgPdv[]>([]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configSaving, setConfigSaving] = useState(false);

  const [newRS, setNewRS] = useState('');
  const [editingRS, setEditingRS] = useState<{ index: number; value: string } | null>(null);

  const [pdvDialogOpen, setPdvDialogOpen] = useState(false);
  const [editingPdvIndex, setEditingPdvIndex] = useState<number | null>(null);
  const [pdvForm, setPdvForm] = useState({ codicePos: '', nome: '', ragioneSociale: '' });

  const [importDialogOpen, setImportDialogOpen] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [bisuiteRS, setBisuiteRS] = useState<string[]>([]);
  const [bisuitePDV, setBisuitePDV] = useState<BiSuitePdvImport[]>([]);
  const [selectedImportRS, setSelectedImportRS] = useState<Set<string>>(new Set());
  const [selectedImportPDV, setSelectedImportPDV] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (profile && !['super_admin', 'admin'].includes(profile.role)) {
      setLocation('/');
    }
  }, [profile, setLocation]);

  useEffect(() => {
    if (profile && ['super_admin', 'admin'].includes(profile.role)) {
      fetchTeamMembers();
      fetchOrgConfig();
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

  const fetchOrgConfig = async () => {
    setConfigLoading(true);
    try {
      const res = await fetch(apiUrl('/api/organization-config'), { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        if (data?.config) {
          setRagioniSociali(data.config.ragioniSociali || []);
          const pdvs = data.config.puntiVendita || [];
          setPuntiVendita(pdvs.map((p: any) => ({
            codicePos: p.codicePos || '',
            nome: p.nome || '',
            ragioneSociale: p.ragioneSociale || '',
          })));
        }
      }
    } catch (err) {
      console.error('Error fetching org config:', err);
    }
    setConfigLoading(false);
  };

  const saveOrgConfig = useCallback(async (rs: string[], pdv: OrgPdv[]) => {
    setConfigSaving(true);
    try {
      const configRes = await fetch(apiUrl('/api/organization-config'), { credentials: 'include' });
      const existing = configRes.ok ? await configRes.json() : null;
      const currentConfig = existing?.config || {};
      const updatedConfig = {
        ...currentConfig,
        ragioniSociali: rs,
        puntiVendita: pdv,
      };
      await fetch(apiUrl('/api/organization-config'), {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ config: updatedConfig, configVersion: '2.0' }),
      });
      toast({ title: 'Salvato', description: 'Configurazione aggiornata' });
    } catch (err) {
      toast({ title: 'Errore', description: 'Errore nel salvataggio', variant: 'destructive' });
    }
    setConfigSaving(false);
  }, [toast]);

  const handleAddRS = () => {
    const trimmed = newRS.trim();
    if (!trimmed) return;
    if (ragioniSociali.includes(trimmed)) {
      toast({ title: 'Duplicato', description: 'Questa ragione sociale esiste già', variant: 'destructive' });
      return;
    }
    const updated = [...ragioniSociali, trimmed];
    setRagioniSociali(updated);
    setNewRS('');
    saveOrgConfig(updated, puntiVendita);
  };

  const handleEditRS = () => {
    if (!editingRS) return;
    const trimmed = editingRS.value.trim();
    if (!trimmed) return;
    const oldName = ragioniSociali[editingRS.index];
    const updated = [...ragioniSociali];
    updated[editingRS.index] = trimmed;
    setRagioniSociali(updated);
    const updatedPdv = puntiVendita.map(p =>
      p.ragioneSociale === oldName ? { ...p, ragioneSociale: trimmed } : p
    );
    setPuntiVendita(updatedPdv);
    setEditingRS(null);
    saveOrgConfig(updated, updatedPdv);
  };

  const handleDeleteRS = (index: number) => {
    const updated = ragioniSociali.filter((_, i) => i !== index);
    setRagioniSociali(updated);
    saveOrgConfig(updated, puntiVendita);
  };

  const handleSavePdv = () => {
    if (!pdvForm.codicePos.trim() || !pdvForm.nome.trim()) {
      toast({ title: 'Errore', description: 'Codice POS e nome sono obbligatori', variant: 'destructive' });
      return;
    }
    let updated: OrgPdv[];
    if (editingPdvIndex !== null) {
      updated = [...puntiVendita];
      updated[editingPdvIndex] = { ...pdvForm };
    } else {
      if (puntiVendita.some(p => p.codicePos === pdvForm.codicePos.trim())) {
        toast({ title: 'Duplicato', description: 'Questo codice POS esiste già', variant: 'destructive' });
        return;
      }
      updated = [...puntiVendita, { ...pdvForm, codicePos: pdvForm.codicePos.trim() }];
    }
    setPuntiVendita(updated);
    setPdvDialogOpen(false);
    setEditingPdvIndex(null);
    setPdvForm({ codicePos: '', nome: '', ragioneSociale: '' });
    saveOrgConfig(ragioniSociali, updated);
  };

  const handleDeletePdv = (index: number) => {
    const updated = puntiVendita.filter((_, i) => i !== index);
    setPuntiVendita(updated);
    saveOrgConfig(ragioniSociali, updated);
  };

  const openEditPdv = (index: number) => {
    setEditingPdvIndex(index);
    setPdvForm({ ...puntiVendita[index] });
    setPdvDialogOpen(true);
  };

  const openAddPdv = () => {
    setEditingPdvIndex(null);
    setPdvForm({ codicePos: '', nome: '', ragioneSociale: '' });
    setPdvDialogOpen(true);
  };

  const handleFetchBiSuiteData = async () => {
    setImportLoading(true);
    try {
      const res = await fetch(apiUrl('/api/admin/bisuite-rs-pdv'), { credentials: 'include' });
      if (res.ok) {
        const data = await res.json();
        setBisuiteRS(data.ragioniSociali || []);
        setBisuitePDV(data.puntiVendita || []);
        const newRS = (data.ragioniSociali || []).filter((rs: string) => !ragioniSociali.includes(rs));
        setSelectedImportRS(new Set(newRS));
        const newPDV = (data.puntiVendita || []).filter((p: BiSuitePdvImport) => !puntiVendita.some(e => e.codicePos === p.codicePos));
        setSelectedImportPDV(new Set(newPDV.map((p: BiSuitePdvImport) => p.codicePos)));
        setImportDialogOpen(true);
      } else {
        toast({ title: 'Errore', description: 'Nessun dato BiSuite trovato', variant: 'destructive' });
      }
    } catch (err) {
      toast({ title: 'Errore', description: 'Errore nel caricamento dati BiSuite', variant: 'destructive' });
    }
    setImportLoading(false);
  };

  const handleImportConfirm = () => {
    const rsToAdd = Array.from(selectedImportRS).filter(rs => !ragioniSociali.includes(rs));
    const updatedRS = [...ragioniSociali, ...rsToAdd];
    const pdvToAdd = bisuitePDV
      .filter(p => selectedImportPDV.has(p.codicePos) && !puntiVendita.some(e => e.codicePos === p.codicePos))
      .map(p => ({ codicePos: p.codicePos, nome: p.nomeNegozio, ragioneSociale: p.ragioneSociale }));
    const updatedPDV = [...puntiVendita, ...pdvToAdd];
    setRagioniSociali(updatedRS);
    setPuntiVendita(updatedPDV);
    setImportDialogOpen(false);
    saveOrgConfig(updatedRS, updatedPDV);
    toast({ title: 'Importazione completata', description: `${rsToAdd.length} RS e ${pdvToAdd.length} PDV importati` });
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

  const handleRenameOrg = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!organization || !orgNameValue.trim()) return;
    setLoading(true);
    const res = await fetch(apiUrl('/api/admin/update-organization'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ organizationId: organization.id, name: orgNameValue.trim() }),
    });
    const data = await res.json();
    setLoading(false);
    if (!res.ok || data?.error) {
      toast({ title: 'Errore', description: data?.error || 'Errore nel cambio nome', variant: 'destructive' });
    } else {
      toast({ title: 'Nome aggiornato', description: 'Il nome dell\'organizzazione e stato aggiornato' });
      setOrgNameDialogOpen(false);
      window.location.reload();
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
    <div className="min-h-screen bg-gradient-to-br from-background to-muted">
      <AppNavbar title="Incentive W3" />
      <div className="max-w-5xl mx-auto space-y-4 sm:space-y-6 p-3 sm:p-4">

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
                <Input id="edit-name" data-testid="input-edit-name" placeholder="Nome Cognome" value={editFullName} onChange={(e) => setEditFullName(e.target.value)} required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit-email">Email</Label>
                <Input id="edit-email" data-testid="input-edit-email" type="email" placeholder="email@esempio.com" value={editEmail} onChange={(e) => setEditEmail(e.target.value)} required />
              </div>
              {editingUser && editingUser.role !== 'super_admin' && (
                <div className="space-y-2">
                  <Label htmlFor="edit-role">Ruolo</Label>
                  <Select value={editRole} onValueChange={(v) => setEditRole(v as 'operatore' | 'admin')}>
                    <SelectTrigger data-testid="select-edit-role"><SelectValue placeholder="Seleziona ruolo" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="operatore">Operatore</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-edit">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</> : 'Salva modifiche'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={passwordDialogOpen} onOpenChange={setPasswordDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{isSelfPasswordChange ? 'Cambia la tua Password' : 'Cambia Password'}</DialogTitle>
              <DialogDescription>
                {isSelfPasswordChange ? 'Inserisci la password attuale e la nuova password' : `Imposta una nuova password per ${passwordUser ? getMemberName(passwordUser) : ''}`}
              </DialogDescription>
            </DialogHeader>
            <form onSubmit={handleChangePassword} className="space-y-4">
              {isSelfPasswordChange && (
                <div className="space-y-2">
                  <Label htmlFor="current-password-self">Password attuale</Label>
                  <div className="relative">
                    <Input id="current-password-self" data-testid="input-current-password-self" type={showCurrentPasswordSelf ? 'text' : 'password'} placeholder="Inserisci la password attuale" value={currentPasswordSelf} onChange={(e) => setCurrentPasswordSelf(e.target.value)} required className="pr-10" />
                    <button type="button" onClick={() => setShowCurrentPasswordSelf(!showCurrentPasswordSelf)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {showCurrentPasswordSelf ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              )}
              <div className="space-y-2">
                <Label htmlFor="new-password">Nuova Password</Label>
                <div className="relative">
                  <Input id="new-password" data-testid="input-new-password" type={showNewPassword ? 'text' : 'password'} placeholder="Minimo 6 caratteri" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} required minLength={6} className="pr-10" />
                  <button type="button" onClick={() => setShowNewPassword(!showNewPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {showNewPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="w-full" disabled={loading} data-testid="button-save-password">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</> : 'Imposta nuova password'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={orgNameDialogOpen} onOpenChange={setOrgNameDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>Rinomina Organizzazione</DialogTitle>
              <DialogDescription>Modifica il nome della tua organizzazione</DialogDescription>
            </DialogHeader>
            <form onSubmit={handleRenameOrg} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="org-name">Nome Organizzazione</Label>
                <Input id="org-name" data-testid="input-org-name" value={orgNameValue} onChange={(e) => setOrgNameValue(e.target.value)} required />
              </div>
              <Button type="submit" className="w-full" disabled={loading || !orgNameValue.trim()} data-testid="button-save-org-name">
                {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</> : 'Salva'}
              </Button>
            </form>
          </DialogContent>
        </Dialog>

        <Dialog open={pdvDialogOpen} onOpenChange={setPdvDialogOpen}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>{editingPdvIndex !== null ? 'Modifica Punto Vendita' : 'Nuovo Punto Vendita'}</DialogTitle>
              <DialogDescription>
                {editingPdvIndex !== null ? 'Modifica i dati del punto vendita' : 'Aggiungi un nuovo punto vendita'}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              <div className="space-y-2">
                <Label>Codice POS</Label>
                <Input data-testid="input-pdv-codice" placeholder="Es. 9001xxxxx" value={pdvForm.codicePos} onChange={(e) => setPdvForm({ ...pdvForm, codicePos: e.target.value })} disabled={editingPdvIndex !== null} />
              </div>
              <div className="space-y-2">
                <Label>Nome negozio</Label>
                <Input data-testid="input-pdv-nome" placeholder="Es. 3Store Milano" value={pdvForm.nome} onChange={(e) => setPdvForm({ ...pdvForm, nome: e.target.value })} />
              </div>
              <div className="space-y-2">
                <Label>Ragione Sociale</Label>
                {ragioniSociali.filter(rs => rs.trim()).length > 0 ? (
                  <Select value={pdvForm.ragioneSociale} onValueChange={(v) => setPdvForm({ ...pdvForm, ragioneSociale: v })}>
                    <SelectTrigger data-testid="select-pdv-rs"><SelectValue placeholder="Seleziona RS" /></SelectTrigger>
                    <SelectContent>
                      {ragioniSociali.filter(rs => rs.trim()).map(rs => (
                        <SelectItem key={rs} value={rs}>{rs}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                ) : (
                  <Input data-testid="input-pdv-rs" placeholder="Es. Telestore S.r.l." value={pdvForm.ragioneSociale} onChange={(e) => setPdvForm({ ...pdvForm, ragioneSociale: e.target.value })} />
                )}
              </div>
              <Button className="w-full" onClick={handleSavePdv} data-testid="button-save-pdv">
                {editingPdvIndex !== null ? 'Salva modifiche' : 'Aggiungi'}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <Dialog open={importDialogOpen} onOpenChange={setImportDialogOpen}>
          <DialogContent className="max-w-2xl max-h-[80vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Importa da BiSuite</DialogTitle>
              <DialogDescription>
                Seleziona le ragioni sociali e i punti vendita da importare dalle vendite BiSuite
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-6">
              {bisuiteRS.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Ragioni Sociali ({bisuiteRS.length})</Label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedImportRS(new Set(bisuiteRS.filter(rs => !ragioniSociali.includes(rs))))} data-testid="button-select-all-rs">Seleziona nuove</Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedImportRS(new Set())} data-testid="button-deselect-all-rs">Deseleziona</Button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-40 overflow-y-auto border rounded-md p-2">
                    {bisuiteRS.map(rs => {
                      const exists = ragioniSociali.includes(rs);
                      return (
                        <label key={rs} className={`flex items-center gap-2 p-1.5 rounded hover:bg-muted text-sm ${exists ? 'opacity-50' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedImportRS.has(rs)}
                            disabled={exists}
                            onChange={(e) => {
                              const next = new Set(selectedImportRS);
                              e.target.checked ? next.add(rs) : next.delete(rs);
                              setSelectedImportRS(next);
                            }}
                            data-testid={`checkbox-import-rs-${rs}`}
                          />
                          <span>{rs}</span>
                          {exists && <Badge variant="secondary" className="text-[10px]">già presente</Badge>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {bisuitePDV.length > 0 && (
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <Label className="text-sm font-semibold">Punti Vendita ({bisuitePDV.length})</Label>
                    <div className="flex gap-2">
                      <Button variant="ghost" size="sm" onClick={() => setSelectedImportPDV(new Set(bisuitePDV.filter(p => !puntiVendita.some(e => e.codicePos === p.codicePos)).map(p => p.codicePos)))} data-testid="button-select-all-pdv">Seleziona nuovi</Button>
                      <Button variant="ghost" size="sm" onClick={() => setSelectedImportPDV(new Set())} data-testid="button-deselect-all-pdv">Deseleziona</Button>
                    </div>
                  </div>
                  <div className="space-y-1 max-h-60 overflow-y-auto border rounded-md p-2">
                    {bisuitePDV.map(pdv => {
                      const exists = puntiVendita.some(e => e.codicePos === pdv.codicePos);
                      return (
                        <label key={pdv.codicePos} className={`flex items-center gap-2 p-1.5 rounded hover:bg-muted text-sm ${exists ? 'opacity-50' : ''}`}>
                          <input
                            type="checkbox"
                            checked={selectedImportPDV.has(pdv.codicePos)}
                            disabled={exists}
                            onChange={(e) => {
                              const next = new Set(selectedImportPDV);
                              e.target.checked ? next.add(pdv.codicePos) : next.delete(pdv.codicePos);
                              setSelectedImportPDV(next);
                            }}
                            data-testid={`checkbox-import-pdv-${pdv.codicePos}`}
                          />
                          <span className="font-mono text-xs">{pdv.codicePos}</span>
                          <span className="truncate">{pdv.nomeNegozio}</span>
                          <span className="text-muted-foreground text-xs ml-auto shrink-0">{pdv.ragioneSociale}</span>
                          {exists && <Badge variant="secondary" className="text-[10px] shrink-0">già presente</Badge>}
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}
              {bisuiteRS.length === 0 && bisuitePDV.length === 0 && (
                <p className="text-sm text-muted-foreground text-center py-4">Nessun dato trovato nelle vendite BiSuite.</p>
              )}
              <Button className="w-full" onClick={handleImportConfirm} disabled={selectedImportRS.size === 0 && selectedImportPDV.size === 0} data-testid="button-confirm-import">
                Importa selezionati ({selectedImportRS.size} RS, {selectedImportPDV.size} PDV)
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-xl sm:text-2xl font-bold flex items-center gap-2" data-testid="text-page-title">
              <Building2 className="h-6 w-6" />
              <span className="truncate">{organization?.name || 'Organizzazione'}</span>
              <Button size="icon" variant="ghost" data-testid="button-rename-org" onClick={() => { setOrgNameValue(organization?.name || ''); setOrgNameDialogOpen(true); }}>
                <Pencil className="h-3.5 w-3.5" />
              </Button>
            </h2>
            <p className="text-sm text-muted-foreground">Gestisci ragioni sociali, punti vendita e utenti</p>
          </div>
          <Button variant="outline" size="sm" onClick={handleFetchBiSuiteData} disabled={importLoading} data-testid="button-import-bisuite">
            {importLoading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Importa da BiSuite
          </Button>
        </div>

        <Tabs value={activeTab} onValueChange={setActiveTab}>
          <TabsList className="grid w-full grid-cols-3" data-testid="tabs-org">
            <TabsTrigger value="ragioni-sociali" data-testid="tab-rs">
              <Building2 className="h-4 w-4 mr-1.5 hidden sm:block" />
              Ragioni Sociali
            </TabsTrigger>
            <TabsTrigger value="punti-vendita" data-testid="tab-pdv">
              <Store className="h-4 w-4 mr-1.5 hidden sm:block" />
              Punti Vendita
            </TabsTrigger>
            <TabsTrigger value="utenti" data-testid="tab-utenti">
              <Users className="h-4 w-4 mr-1.5 hidden sm:block" />
              Utenti
            </TabsTrigger>
          </TabsList>

          <TabsContent value="ragioni-sociali">
            <Card>
              <CardHeader>
                <CardTitle className="text-lg flex items-center gap-2">
                  <Building2 className="h-5 w-5" />
                  Ragioni Sociali
                  {configSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                </CardTitle>
                <CardDescription>Gestisci le ragioni sociali della tua organizzazione</CardDescription>
              </CardHeader>
              <CardContent>
                {configLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : (
                  <div className="space-y-4">
                    <div className="flex gap-2">
                      <Input
                        placeholder="Nuova ragione sociale..."
                        value={newRS}
                        onChange={(e) => setNewRS(e.target.value)}
                        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleAddRS(); } }}
                        data-testid="input-new-rs"
                      />
                      <Button onClick={handleAddRS} disabled={!newRS.trim()} data-testid="button-add-rs">
                        <Plus className="h-4 w-4 mr-1" />
                        Aggiungi
                      </Button>
                    </div>
                    {ragioniSociali.length === 0 ? (
                      <p className="text-sm text-muted-foreground text-center py-4">Nessuna ragione sociale configurata. Aggiungile manualmente o importale da BiSuite.</p>
                    ) : (
                      <div className="overflow-x-auto -mx-4 sm:mx-0">
                        <Table>
                          <TableHeader>
                            <TableRow>
                              <TableHead>#</TableHead>
                              <TableHead>Ragione Sociale</TableHead>
                              <TableHead className="hidden sm:table-cell">PDV associati</TableHead>
                              <TableHead className="w-[100px]">Azioni</TableHead>
                            </TableRow>
                          </TableHeader>
                          <TableBody>
                            {ragioniSociali.map((rs, index) => {
                              const pdvCount = puntiVendita.filter(p => p.ragioneSociale === rs).length;
                              return (
                                <TableRow key={index} data-testid={`row-rs-${index}`}>
                                  <TableCell className="text-muted-foreground">{index + 1}</TableCell>
                                  <TableCell>
                                    {editingRS?.index === index ? (
                                      <div className="flex gap-2">
                                        <Input
                                          value={editingRS.value}
                                          onChange={(e) => setEditingRS({ ...editingRS, value: e.target.value })}
                                          onKeyDown={(e) => { if (e.key === 'Enter') handleEditRS(); if (e.key === 'Escape') setEditingRS(null); }}
                                          autoFocus
                                          data-testid={`input-edit-rs-${index}`}
                                        />
                                        <Button size="sm" onClick={handleEditRS} data-testid={`button-save-rs-${index}`}>Salva</Button>
                                      </div>
                                    ) : (
                                      <span className="font-medium">{rs}</span>
                                    )}
                                  </TableCell>
                                  <TableCell className="hidden sm:table-cell">
                                    <Badge variant="secondary">{pdvCount} PDV</Badge>
                                  </TableCell>
                                  <TableCell>
                                    <div className="flex gap-1">
                                      <Button variant="ghost" size="icon" onClick={() => setEditingRS({ index, value: rs })} data-testid={`button-edit-rs-${index}`}>
                                        <Pencil className="h-4 w-4" />
                                      </Button>
                                      <AlertDialog>
                                        <AlertDialogTrigger asChild>
                                          <Button variant="ghost" size="icon" className="text-destructive" data-testid={`button-delete-rs-${index}`}>
                                            <Trash2 className="h-4 w-4" />
                                          </Button>
                                        </AlertDialogTrigger>
                                        <AlertDialogContent>
                                          <AlertDialogHeader>
                                            <AlertDialogTitle>Elimina ragione sociale</AlertDialogTitle>
                                            <AlertDialogDescription>
                                              Sei sicuro di voler eliminare <strong>{rs}</strong>? I PDV associati non verranno eliminati.
                                            </AlertDialogDescription>
                                          </AlertDialogHeader>
                                          <AlertDialogFooter>
                                            <AlertDialogCancel>Annulla</AlertDialogCancel>
                                            <AlertDialogAction onClick={() => handleDeleteRS(index)} className="bg-destructive text-destructive-foreground">Elimina</AlertDialogAction>
                                          </AlertDialogFooter>
                                        </AlertDialogContent>
                                      </AlertDialog>
                                    </div>
                                  </TableCell>
                                </TableRow>
                              );
                            })}
                          </TableBody>
                        </Table>
                      </div>
                    )}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="punti-vendita">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="text-lg flex items-center gap-2">
                    <Store className="h-5 w-5" />
                    Punti Vendita
                    {configSaving && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />}
                  </CardTitle>
                  <CardDescription>Gestisci i punti vendita della tua organizzazione</CardDescription>
                </div>
                <Button size="sm" onClick={openAddPdv} data-testid="button-add-pdv">
                  <Plus className="mr-2 h-4 w-4" />
                  Aggiungi PDV
                </Button>
              </CardHeader>
              <CardContent>
                {configLoading ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
                ) : puntiVendita.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-4">Nessun punto vendita configurato. Aggiungili manualmente o importali da BiSuite.</p>
                ) : (
                  <div className="overflow-x-auto -mx-4 sm:mx-0">
                    <Table>
                      <TableHeader>
                        <TableRow>
                          <TableHead>Codice POS</TableHead>
                          <TableHead>Nome</TableHead>
                          <TableHead className="hidden sm:table-cell">Ragione Sociale</TableHead>
                          <TableHead className="w-[100px]">Azioni</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {puntiVendita.map((pdv, index) => (
                          <TableRow key={pdv.codicePos} data-testid={`row-pdv-${pdv.codicePos}`}>
                            <TableCell className="font-mono text-sm">{pdv.codicePos}</TableCell>
                            <TableCell>
                              <div className="font-medium">{pdv.nome}</div>
                              <div className="text-xs text-muted-foreground sm:hidden">{pdv.ragioneSociale}</div>
                            </TableCell>
                            <TableCell className="hidden sm:table-cell">{pdv.ragioneSociale || '-'}</TableCell>
                            <TableCell>
                              <div className="flex gap-1">
                                <Button variant="ghost" size="icon" onClick={() => openEditPdv(index)} data-testid={`button-edit-pdv-${pdv.codicePos}`}>
                                  <Pencil className="h-4 w-4" />
                                </Button>
                                <AlertDialog>
                                  <AlertDialogTrigger asChild>
                                    <Button variant="ghost" size="icon" className="text-destructive" data-testid={`button-delete-pdv-${pdv.codicePos}`}>
                                      <Trash2 className="h-4 w-4" />
                                    </Button>
                                  </AlertDialogTrigger>
                                  <AlertDialogContent>
                                    <AlertDialogHeader>
                                      <AlertDialogTitle>Elimina punto vendita</AlertDialogTitle>
                                      <AlertDialogDescription>
                                        Sei sicuro di voler eliminare <strong>{pdv.nome}</strong> ({pdv.codicePos})?
                                      </AlertDialogDescription>
                                    </AlertDialogHeader>
                                    <AlertDialogFooter>
                                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                                      <AlertDialogAction onClick={() => handleDeletePdv(index)} className="bg-destructive text-destructive-foreground">Elimina</AlertDialogAction>
                                    </AlertDialogFooter>
                                  </AlertDialogContent>
                                </AlertDialog>
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
          </TabsContent>

          <TabsContent value="utenti">
            <Card>
              <CardHeader className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Users className="h-5 w-5" />
                    Utenti
                  </CardTitle>
                  <CardDescription>Gestisci gli utenti della tua organizzazione</CardDescription>
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
                      <DialogDescription>Aggiungi un nuovo utente al team di {organization?.name}</DialogDescription>
                    </DialogHeader>
                    <form onSubmit={handleCreateOperatore} className="space-y-4">
                      <div className="space-y-2">
                        <Label htmlFor="op-name">Nome</Label>
                        <Input id="op-name" data-testid="input-create-name" placeholder="Nome Cognome" value={fullName} onChange={(e) => setFullName(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="op-email">Email</Label>
                        <Input id="op-email" data-testid="input-create-email" type="email" placeholder="utente@email.com" value={email} onChange={(e) => setEmail(e.target.value)} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="op-role">Ruolo</Label>
                        <Select value={createRole} onValueChange={(v) => setCreateRole(v as 'operatore' | 'admin')}>
                          <SelectTrigger data-testid="select-create-role"><SelectValue placeholder="Seleziona ruolo" /></SelectTrigger>
                          <SelectContent>
                            <SelectItem value="operatore">Operatore</SelectItem>
                            <SelectItem value="admin">Admin</SelectItem>
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="op-password">Password</Label>
                        <div className="relative">
                          <Input id="op-password" data-testid="input-create-password" type={showPassword ? 'text' : 'password'} placeholder="Minimo 6 caratteri" value={password} onChange={(e) => setPassword(e.target.value)} required className="pr-10" />
                          <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <Button type="submit" className="w-full" disabled={loading} data-testid="button-create-user">
                        {loading ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Creazione...</> : 'Crea Utente'}
                      </Button>
                    </form>
                  </DialogContent>
                </Dialog>
              </CardHeader>
              <CardContent>
                {loading && teamMembers.length === 0 ? (
                  <div className="flex justify-center py-4"><Loader2 className="h-6 w-6 animate-spin" /></div>
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
                                <Badge variant={getRoleBadgeVariant(member.role)}>{getRoleLabel(member.role)}</Badge>
                              </TableCell>
                              <TableCell>
                                {canToggleActive(member) ? (
                                  <div className="flex items-center gap-2">
                                    <Switch checked={isActive} onCheckedChange={() => handleToggleActive(member)} data-testid={`switch-active-${member.id}`} />
                                    <span className="text-xs text-muted-foreground hidden sm:inline">{isActive ? 'Attivo' : 'Disattivato'}</span>
                                  </div>
                                ) : (
                                  <Badge variant={isActive ? 'default' : 'secondary'}>{isActive ? 'Attivo' : 'Disattivato'}</Badge>
                                )}
                              </TableCell>
                              <TableCell>
                                <div className="flex gap-1">
                                  {canEditUser(member) && (
                                    <Button variant="ghost" size="icon" onClick={() => openEditDialog(member)} data-testid={`button-edit-${member.id}`}>
                                      <Pencil className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {canChangePassword(member) && (
                                    <Button variant="ghost" size="icon" onClick={() => openPasswordDialog(member)} data-testid={`button-password-${member.id}`}>
                                      <KeyRound className="h-4 w-4" />
                                    </Button>
                                  )}
                                  {canDeleteUser(member) && (
                                    <AlertDialog>
                                      <AlertDialogTrigger asChild>
                                        <Button variant="ghost" size="icon" className="text-destructive" disabled={deletingId === member.id} data-testid={`button-delete-${member.id}`}>
                                          {deletingId === member.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                                        </Button>
                                      </AlertDialogTrigger>
                                      <AlertDialogContent>
                                        <AlertDialogHeader>
                                          <AlertDialogTitle>Elimina utente</AlertDialogTitle>
                                          <AlertDialogDescription>
                                            Sei sicuro di voler eliminare <strong>{getMemberName(member)}</strong>? L'azione e irreversibile.
                                          </AlertDialogDescription>
                                        </AlertDialogHeader>
                                        <AlertDialogFooter>
                                          <AlertDialogCancel>Annulla</AlertDialogCancel>
                                          <AlertDialogAction onClick={() => handleDeleteUser(member.id)} className="bg-destructive text-destructive-foreground" data-testid={`button-confirm-delete-${member.id}`}>Elimina</AlertDialogAction>
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
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
