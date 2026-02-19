import { useState } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { apiUrl } from "@/lib/basePath";
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Building2, User, Lock, Eye, EyeOff } from 'lucide-react';

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user, profile, organization, loading: authLoading } = useAuth();
  const { toast } = useToast();

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [showCurrent, setShowCurrent] = useState(false);
  const [showNew, setShowNew] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);

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
      <div className="max-w-2xl mx-auto space-y-4 sm:space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => setLocation('/')}
          className="mb-4"
          data-testid="button-back"
        >
          <ArrowLeft className="mr-2 h-4 w-4" />
          Torna al preventivatore
        </Button>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <User className="h-5 w-5" />
              Profilo utente
            </CardTitle>
            <CardDescription>
              Le tue informazioni personali
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
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
          <CardContent>
            <div>
              <Label className="text-muted-foreground text-sm">Nome organizzazione</Label>
              <p className="font-medium" data-testid="text-org-name">{organization?.name || 'Non specificata'}</p>
            </div>
          </CardContent>
        </Card>

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
