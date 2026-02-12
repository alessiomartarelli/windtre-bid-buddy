import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Tabs, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Loader2, Eye, EyeOff, Smartphone, Wifi, Zap, Shield, TrendingUp, Users, BarChart3, Award } from 'lucide-react';

const loginSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(6, 'La password deve avere almeno 6 caratteri'),
});

const signupSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(6, 'La password deve avere almeno 6 caratteri'),
  fullName: z.string().min(2, 'Il nome deve avere almeno 2 caratteri'),
  organizationName: z.string().min(2, "Il nome dell'organizzazione deve avere almeno 2 caratteri"),
});

const featureCards = [
  {
    icon: TrendingUp,
    title: 'Simulazione Gara',
    description: 'Simula scenari di gara con calcoli automatici su soglie, premi e incentivi per ogni punto vendita.',
    gradient: 'from-orange-500/20 to-amber-500/20',
    border: 'border-orange-400/30',
    iconColor: 'text-orange-400',
  },
  {
    icon: Smartphone,
    title: 'Pista Mobile',
    description: 'Gestione completa delle attivazioni mobile con calcolo punti per categoria e soglie progressive.',
    gradient: 'from-blue-500/20 to-cyan-500/20',
    border: 'border-blue-400/30',
    iconColor: 'text-blue-400',
  },
  {
    icon: Wifi,
    title: 'Pista Fisso',
    description: 'Configurazione linee fisse con 5 livelli di soglia e premi differenziati per cluster e tipologia.',
    gradient: 'from-violet-500/20 to-purple-500/20',
    border: 'border-violet-400/30',
    iconColor: 'text-violet-400',
  },
  {
    icon: Zap,
    title: 'Energia & Assicurazioni',
    description: 'Calcolo commissioni energia per categoria e punti assicurazioni con target multi-livello.',
    gradient: 'from-emerald-500/20 to-teal-500/20',
    border: 'border-emerald-400/30',
    iconColor: 'text-emerald-400',
  },
  {
    icon: Users,
    title: 'Gestione Risorse',
    description: 'Organizza operatori e risorse per punto vendita con configurazioni personalizzate per ogni RS.',
    gradient: 'from-rose-500/20 to-pink-500/20',
    border: 'border-rose-400/30',
    iconColor: 'text-rose-400',
  },
  {
    icon: BarChart3,
    title: 'Dashboard & Report',
    description: 'Visualizza risultati, esporta in PDF e Excel, confronta performance tra punti vendita.',
    gradient: 'from-sky-500/20 to-indigo-500/20',
    border: 'border-sky-400/30',
    iconColor: 'text-sky-400',
  },
];

export default function Auth() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, signIn, signUp } = useAuth();
  const { toast } = useToast();

  const [activeTab, setActiveTab] = useState<'login' | 'signup'>('login');
  const [loading, setLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [showSignupPassword, setShowSignupPassword] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

  const [signupEmail, setSignupEmail] = useState('');
  const [signupPassword, setSignupPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [organizationName, setOrganizationName] = useState('');

  useEffect(() => {
    if (user && !authLoading) {
      setLocation('/');
    }
  }, [user, authLoading, setLocation]);

  const handleLogin = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = loginSchema.safeParse({ email: loginEmail, password: loginPassword });
    if (!validation.success) {
      toast({
        title: 'Errore di validazione',
        description: validation.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    const { error } = await signIn(loginEmail, loginPassword);
    setLoading(false);

    if (error) {
      let message = 'Errore durante il login';
      if (error.message.includes('Invalid login credentials')) {
        message = 'Credenziali non valide';
      } else if (error.message.includes('Email not confirmed')) {
        message = 'Email non confermata';
      }
      toast({
        title: 'Errore',
        description: message,
        variant: 'destructive',
      });
    }
  };

  const handleSignup = async (e: React.FormEvent) => {
    e.preventDefault();

    const validation = signupSchema.safeParse({
      email: signupEmail,
      password: signupPassword,
      fullName,
      organizationName,
    });

    if (!validation.success) {
      toast({
        title: 'Errore di validazione',
        description: validation.error.errors[0].message,
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    const { error } = await signUp(signupEmail, signupPassword, fullName, organizationName);
    setLoading(false);

    if (error) {
      let message = 'Errore durante la registrazione';
      if (error.message.includes('User already registered')) {
        message = 'Utente già registrato con questa email';
      }
      toast({
        title: 'Errore',
        description: message,
        variant: 'destructive',
      });
    } else {
      toast({
        title: 'Registrazione completata',
        description: 'Benvenuto! Stai per essere reindirizzato.',
      });
    }
  };

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="spinner-loading" />
      </div>
    );
  }

  return (
    <div className="min-h-screen flex" data-testid="page-auth">
      {/* Left Panel - Feature Cards with dark gradient background */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-gradient-to-br from-[#0f1729] via-[#1a1f3a] to-[#0d1117] p-8 xl:p-12 flex-col justify-between">
        {/* Decorative gradient orbs */}
        <div className="absolute top-[-120px] left-[-80px] w-[400px] h-[400px] rounded-full bg-orange-500/10 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-100px] right-[-60px] w-[350px] h-[350px] rounded-full bg-blue-500/8 blur-[100px] pointer-events-none" />
        <div className="absolute top-[40%] right-[20%] w-[250px] h-[250px] rounded-full bg-violet-500/8 blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Award className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight" data-testid="text-brand-title">
              Incentive W3
            </h1>
          </div>
          <p className="text-white/50 text-sm mt-1 ml-[52px]" data-testid="text-brand-subtitle">
            Sistema di Simulazione & Gestione Gara
          </p>
        </div>

        {/* Feature Cards Grid */}
        <div className="relative z-10 grid grid-cols-2 gap-4 my-8">
          {featureCards.map((card) => (
            <div
              key={card.title}
              className={`rounded-xl p-5 backdrop-blur-xl bg-gradient-to-br ${card.gradient} border ${card.border} transition-all duration-300`}
              data-testid={`card-feature-${card.title.toLowerCase().replace(/\s+/g, '-')}`}
            >
              <div className={`w-9 h-9 rounded-lg bg-white/10 flex items-center justify-center mb-3 ${card.iconColor}`}>
                <card.icon className="w-5 h-5" />
              </div>
              <h3 className="text-white font-semibold text-sm mb-1.5">{card.title}</h3>
              <p className="text-white/55 text-xs leading-relaxed">{card.description}</p>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="relative z-10 flex items-center gap-3" data-testid="text-footer-security">
          <Shield className="w-4 h-4 text-white/30" />
          <p className="text-white/30 text-xs">
            Piattaforma sicura per operatori e dealer autorizzati
          </p>
        </div>
      </div>

      {/* Right Panel - Login Form */}
      <div className="w-full lg:w-[45%] flex items-center justify-center p-6 sm:p-8 lg:p-12 bg-background">
        <div className="w-full max-w-[420px]">
          {/* Mobile brand header */}
          <div className="lg:hidden flex items-center gap-3 mb-8 justify-center">
            <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-orange-500 to-orange-600 flex items-center justify-center shadow-lg shadow-orange-500/25">
              <Award className="w-5 h-5 text-white" />
            </div>
            <h1 className="text-2xl font-bold tracking-tight" data-testid="text-brand-title-mobile">
              Incentive W3
            </h1>
          </div>

          {/* Tab switcher */}
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'login' | 'signup')} className="mb-8" data-testid="tabs-auth">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="login" data-testid="tab-login">Accedi</TabsTrigger>
              <TabsTrigger value="signup" data-testid="tab-signup">Registrati</TabsTrigger>
            </TabsList>
          </Tabs>

          {activeTab === 'login' ? (
            <div>
              <div className="mb-6">
                <h2 className="text-2xl font-bold" data-testid="text-auth-title">Bentornato</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Accedi al tuo account per continuare
                </p>
              </div>

              <form onSubmit={handleLogin} className="space-y-5">
                <div className="space-y-2">
                  <Label htmlFor="login-email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="login-email"
                    type="email"
                    placeholder="nome@azienda.it"
                    value={loginEmail}
                    onChange={(e) => setLoginEmail(e.target.value)}
                    required
                    data-testid="input-login-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="login-password" className="text-sm font-medium">Password</Label>
                  <div className="relative">
                    <Input
                      id="login-password"
                      type={showLoginPassword ? 'text' : 'password'}
                      placeholder="Inserisci la password"
                      value={loginPassword}
                      onChange={(e) => setLoginPassword(e.target.value)}
                      required
                      className="pr-10"
                      data-testid="input-login-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowLoginPassword(!showLoginPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      data-testid="button-toggle-login-password"
                    >
                      {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading} data-testid="button-login">
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Accesso in corso...
                    </>
                  ) : (
                    'Accedi'
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground mt-6">
                Non hai un account?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('signup')}
                  className="text-primary font-medium"
                  data-testid="link-go-to-signup"
                >
                  Registrati
                </button>
              </p>
            </div>
          ) : (
            <div>
              <div className="mb-6">
                <h2 className="text-2xl font-bold" data-testid="text-auth-title">Crea Account</h2>
                <p className="text-muted-foreground text-sm mt-1">
                  Registra la tua organizzazione per iniziare
                </p>
              </div>

              <form onSubmit={handleSignup} className="space-y-4">
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label htmlFor="signup-fullname" className="text-sm font-medium">Nome Completo</Label>
                    <Input
                      id="signup-fullname"
                      type="text"
                      placeholder="Mario Rossi"
                      value={fullName}
                      onChange={(e) => setFullName(e.target.value)}
                      required
                      data-testid="input-signup-fullname"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="signup-organization" className="text-sm font-medium">Organizzazione</Label>
                    <Input
                      id="signup-organization"
                      type="text"
                      placeholder="Nome azienda"
                      value={organizationName}
                      onChange={(e) => setOrganizationName(e.target.value)}
                      required
                      data-testid="input-signup-organization"
                    />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-email" className="text-sm font-medium">Email</Label>
                  <Input
                    id="signup-email"
                    type="email"
                    placeholder="nome@azienda.it"
                    value={signupEmail}
                    onChange={(e) => setSignupEmail(e.target.value)}
                    required
                    data-testid="input-signup-email"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password" className="text-sm font-medium">Password</Label>
                  <div className="relative">
                    <Input
                      id="signup-password"
                      type={showSignupPassword ? 'text' : 'password'}
                      placeholder="Minimo 6 caratteri"
                      value={signupPassword}
                      onChange={(e) => setSignupPassword(e.target.value)}
                      required
                      className="pr-10"
                      data-testid="input-signup-password"
                    />
                    <button
                      type="button"
                      onClick={() => setShowSignupPassword(!showSignupPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"
                      data-testid="button-toggle-signup-password"
                    >
                      {showSignupPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <Button type="submit" className="w-full" disabled={loading} data-testid="button-signup">
                  {loading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Registrazione in corso...
                    </>
                  ) : (
                    'Registrati'
                  )}
                </Button>
              </form>

              <p className="text-center text-sm text-muted-foreground mt-6">
                Hai già un account?{' '}
                <button
                  type="button"
                  onClick={() => setActiveTab('login')}
                  className="text-primary font-medium"
                  data-testid="link-go-to-login"
                >
                  Accedi
                </button>
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
