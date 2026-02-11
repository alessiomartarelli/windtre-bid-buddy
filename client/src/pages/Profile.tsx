import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { Loader2, ArrowLeft, Building2, User, Lock } from 'lucide-react';

export default function Profile() {
  const [, setLocation] = useLocation();
  const { user, profile, organization, loading: authLoading } = useAuth();
  const { toast } = useToast();

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="h-8 w-8 animate-spin text-primary" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-background to-muted p-4">
      <div className="max-w-2xl mx-auto space-y-6">
        <Button 
          variant="ghost" 
          onClick={() => setLocation('/')}
          className="mb-4"
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
              Gestisci le tue informazioni personali
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Label className="text-muted-foreground text-sm">Nome</Label>
                <p className="font-medium">{profile?.full_name || 'Non specificato'}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Email</Label>
                <p className="font-medium">{user?.email}</p>
              </div>
              <div>
                <Label className="text-muted-foreground text-sm">Ruolo</Label>
                <p className="font-medium capitalize">
                  {profile?.role === 'admin' ? 'Amministratore' : 'Membro'}
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
              <p className="font-medium">{organization?.name || 'Non specificata'}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Lock className="h-5 w-5" />
              Sicurezza
            </CardTitle>
            <CardDescription>
              Gestione password
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">
              La gestione della password viene effettuata tramite Replit. Per modificare la tua password, accedi alle impostazioni del tuo account Replit.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
