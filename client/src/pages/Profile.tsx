import { useEffect, useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from "@/lib/basePath";
import { apiRequest } from '@/lib/queryClient';
import { Pencil } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Building2, User, Lock, Eye, EyeOff, Mail } from 'lucide-react';
import { AppNavbar } from '@/components/AppNavbar';

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user, profile, organization, organizationBrands, loading: authLoading, refreshUser } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const [emailDisabled, setEmailDisabled] = useState<boolean>(false);
  const [savingEmailPref, setSavingEmailPref] = useState(false);

  const [editingInfo, setEditingInfo] = useState(false);
  const [editName, setEditName] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [savingInfo, setSavingInfo] = useState(false);

  const isAdminLike = profile?.role === 'admin' || profile?.role === 'super_admin';

  useEffect(() => {
    setEmailDisabled(!!profile?.emailNotificationsDisabled);
  }, [profile]);

  const startEditInfo = () => {
    setEditName(profile?.full_name || '');
    setEditEmail(user?.email || '');
    setEditingInfo(true);
  };

  const handleSaveInfo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editName.trim()) {
      toast({ title: 'Errore', description: 'Il nome non può essere vuoto', variant: 'destructive' });
      return;
    }
    if (!editEmail.trim()) {
      toast({ title: 'Errore', description: "L'email non può essere vuota", variant: 'destructive' });
      return;
    }
    setSavingInfo(true);
    try {
      const res = await fetch(apiUrl('/api/auth/profile'), {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ fullName: editName.trim(), email: editEmail.trim() }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        toast({ title: 'Errore', description: data?.error || "Errore nell'aggiornamento", variant: 'destructive' });
      } else {
        toast({ title: 'Informazioni aggiornate', description: 'I tuoi dati sono stati salvati' });
        setEditingInfo(false);
        await refreshUser();
      }
    } catch {
      toast({ title: 'Errore', description: 'Errore di connessione', variant: 'destructive' });
    }
    setSavingInfo(false);
  };

  const handleToggleEmailPref = async (disabled: boolean) => {
    setSavingEmailPref(true);
    const previous = emailDisabled;
    setEmailDisabled(disabled);
    try {
      await apiRequest('PATCH', '/api/auth/email-preferences', { emailNotificationsDisabled: disabled });
      toast({
        title: 'Preferenza salvata',
        description: disabled
          ? 'Non riceverai più email per le sync BiSuite fallite.'
          : 'Riceverai email per le sync BiSuite parziali o fallite.',
      });
    } catch (err) {
      setEmailDisabled(previous);
      toast({ title: 'Errore', description: 'Impossibile salvare la preferenza', variant: 'destructive' });
    } finally {
      setSavingEmailPref(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword.length < 6) {
      toast({ title: 'Errore', description: 'La nuova password deve avere almeno 6 caratteri', variant: 'destructive' });
      return;
    }
    if (newPassword !== confirmPassword) {
      toast({ title: 'Errore', description: 'Le password non coincidono', variant: 'destructive' });
      return;
    }
    setChangingPassword(true);
    try {
      const res = await fetch(apiUrl('/api/auth/change-password'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      const data = await res.json();
      if (!res.ok || data?.error) {
        toast({ title: 'Errore', description: data?.error || 'Errore nel cambio password', variant: 'destructive' });
      } else {
        toast({ title: 'Password aggiornata', description: 'La tua password e stata cambiata con successo' });
        setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      }
    } catch {
      toast({ title: 'Errore', description: 'Errore di connessione', variant: 'destructive' });
    }
    setChangingPassword(false);
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-3 sm:p-4">
      <AppNavbar title="MyStoreDesk" />
      <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6 p-4">

        <Card>
          <CardHeader>
            <div className="flex items-start justify-between gap-2">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <User className="h-5 w-5" />
                  Profilo utente
                </CardTitle>
                <CardDescription>
                  Le tue informazioni personali
                </CardDescription>
              </div>
              {!editingInfo && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={startEditInfo}
                  data-testid="button-edit-info"
                >
                  <Pencil className="mr-2 h-4 w-4" />
                  Modifica
                </Button>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {editingInfo ? (
              <form onSubmit={handleSaveInfo} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="edit-name">Nome</Label>
                  <Input
                    id="edit-name"
                    data-testid="input-edit-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    placeholder="Il tuo nome completo"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="edit-email">Email</Label>
                  <Input
                    id="edit-email"
                    data-testid="input-edit-email"
                    type="email"
                    value={editEmail}
                    onChange={(e) => setEditEmail(e.target.value)}
                    placeholder="La tua email"
                    required
                  />
                </div>
                <div className="flex gap-2">
                  <Button type="submit" disabled={savingInfo} data-testid="button-save-info">
                    {savingInfo ? (
                      <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Salvataggio...</>
                    ) : 'Salva'}
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    disabled={savingInfo}
                    onClick={() => setEditingInfo(false)}
                    data-testid="button-cancel-info"
                  >
                    Annulla
                  </Button>
                </div>
              </form>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <Label className="text-muted-foreground text-sm">Nome</Label>
                  <p className="font-medium" data-testid="text-profile-name">{profile?.full_name || 'Non specificato'}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-sm">Email</Label>
                  <p className="font-medium" data-testid="text-profile-email">{user?.email}</p>
                </div>
                <div>
                  <Label className="text-muted-foreground text-sm">Ruolo</Label>
                  <p className="font-medium capitalize" data-testid="text-profile-role">
                    {profile?.role === 'super_admin' ? 'Super Admin' : profile?.role === 'admin' ? 'Amministratore' : 'Operatore'}
                  </p>
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              Organizzazione
            </CardTitle>
            <CardDescription>
              Informazioni sulla tua organizzazione
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label className="text-muted-foreground text-sm">Nome organizzazione</Label>
              <p className="font-medium" data-testid="text-org-name">{organization?.name || 'Non specificata'}</p>
            </div>
            {organizationBrands.length > 0 && (
              <div>
                <Label className="text-muted-foreground text-sm">Operatori gestiti</Label>
                <div className="flex flex-wrap gap-2 mt-1.5" data-testid="list-org-brands">
                  {organizationBrands.map((brand) => (
                    <Badge
                      key={brand.id}
                      variant="secondary"
                      className="font-medium"
                      data-testid={`badge-org-brand-${brand.id}`}
                    >
                      {brand.name}
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {isAdminLike && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5" />
                Notifiche email
              </CardTitle>
              <CardDescription>
                Ricevi una email quando la sincronizzazione notturna BiSuite è parziale o fallisce
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center justify-between gap-4">
                <div className="space-y-1">
                  <Label htmlFor="toggle-email-notifications" className="text-base">
                    Email per sync BiSuite fallite
                  </Label>
                  <p className="text-sm text-muted-foreground">
                    {emailDisabled
                      ? 'Riceverai solo la notifica in-app (campanellino).'
                      : 'Riceverai una email a ' + (user?.email || 'il tuo indirizzo') + ' oltre alla notifica in-app.'}
                  </p>
                </div>
                <Switch
                  id="toggle-email-notifications"
                  data-testid="switch-email-notifications"
                  checked={!emailDisabled}
                  disabled={savingEmailPref}
                  onCheckedChange={(checked) => handleToggleEmailPref(!checked)}
                />
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Cambia Password
            </CardTitle>
            <CardDescription>
              Aggiorna la tua password di accesso
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleChangePassword} className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="current-password">Password attuale</Label>
                <div className="relative">
                  <Input
                    id="current-password"
                    data-testid="input-current-password"
                    type={showCurrent ? 'text' : 'password'}
                    placeholder="Inserisci la password attuale"
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    required
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrent(!showCurrent)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showCurrent ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="new-password">Nuova password</Label>
                <div className="relative">
                  <Input
                    id="new-password"
                    data-testid="input-new-password"
                    type={showNew ? 'text' : 'password'}
                    placeholder="Minimo 6 caratteri"
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    required
                    minLength={6}
                    className="pr-10"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNew(!showNew)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showNew ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="confirm-password">Conferma nuova password</Label>
                <Input
                  id="confirm-password"
                  data-testid="input-confirm-password"
                  type="password"
                  placeholder="Ripeti la nuova password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  required
                  minLength={6}
                />
              </div>
              <Button type="submit" disabled={changingPassword} data-testid="button-change-password">
                {changingPassword ? (
                  <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Aggiornamento...</>
                ) : 'Cambia Password'}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
