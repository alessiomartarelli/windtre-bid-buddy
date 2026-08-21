import { useState, useEffect } from 'react';
import { useLocation } from 'wouter';
import { z } from 'zod';
import { useAuth } from '@/hooks/useAuth';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Eye, EyeOff, Smartphone, Wifi, Zap, Shield, TrendingUp, Users, BarChart3 } from 'lucide-react';
import { BrandGlyph } from '@/components/BrandLogo';

const loginSchema = z.object({
  email: z.string().email('Email non valida'),
  password: z.string().min(6, 'La password deve avere almeno 6 caratteri'),
});


const featureCards = [
  {
    icon: TrendingUp,
    title: 'Simulazione Gara',
    description: 'Simula scenari di gara con calcoli automatici su soglie, premi e incentivi per ogni punto vendita.',
    gradient: 'from-primary/20 to-blue-500/20',
    border: 'border-primary/30',
    iconColor: 'text-primary',
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
    gradient: 'from-sky-500/20 to-primary/20',
    border: 'border-sky-400/30',
    iconColor: 'text-sky-400',
  },
];

export default function Auth() {
  const [, setLocation] = useLocation();
  const { user, loading: authLoading, signIn, signUp } = useAuth();
  const { toast } = useToast();

  const [loading, setLoading] = useState(false);
  const [showLoginPassword, setShowLoginPassword] = useState(false);

  const [loginEmail, setLoginEmail] = useState('');
  const [loginPassword, setLoginPassword] = useState('');

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

  if (authLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <Loader2 className="w-8 h-8 animate-spin text-primary" data-testid="spinner-loading" />
      </div>
    );
  }

  return (
    <div className="min-h-[100dvh] flex overflow-x-hidden bg-background" data-testid="page-auth">
      {/* Left Panel - Feature Cards with dark gradient background */}
      <div className="hidden lg:flex lg:w-[55%] relative overflow-hidden bg-gradient-to-br from-[#131c3b] via-[#1a2148] to-[#101830] p-8 xl:p-12 flex-col justify-between">
        {/* Decorative gradient orbs */}
        <div className="absolute top-[-120px] left-[-80px] w-[400px] h-[400px] rounded-full bg-primary/10 blur-[100px] pointer-events-none" />
        <div className="absolute bottom-[-100px] right-[-60px] w-[350px] h-[350px] rounded-full bg-blue-500/8 blur-[100px] pointer-events-none" />
        <div className="absolute top-[40%] right-[20%] w-[250px] h-[250px] rounded-full bg-violet-500/8 blur-[80px] pointer-events-none" />

        {/* Header */}
        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-10 h-10 rounded-lg bg-primary flex items-center justify-center shadow-lg shadow-primary/25">
              <BrandGlyph className="w-5 h-5 text-primary-foreground" />
            </div>
            <h1 className="text-2xl font-bold text-white tracking-tight" data-testid="text-brand-title">
              MyStoreDesk
            </h1>
          </div>
          <p className="text-white/50 text-sm mt-1 ml-[52px]" data-testid="text-brand-subtitle">
            La scrivania digitale del punto vendita
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
      <div className="relative isolate w-full lg:w-[45%] flex items-center justify-center overflow-hidden px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(2rem,env(safe-area-inset-bottom))] sm:p-8 lg:p-12 bg-transparent lg:bg-background">
        {/* Mobile night surface: intentionally kept out of the desktop composition. */}
        <div
          className="pointer-events-none absolute inset-0 -z-10 lg:hidden bg-[radial-gradient(circle_at_12%_8%,hsl(239_84%_64%_/_0.22),transparent_34%),radial-gradient(circle_at_92%_22%,hsl(190_82%_55%_/_0.13),transparent_31%),linear-gradient(145deg,hsl(233_55%_8%)_0%,hsl(232_48%_11%)_48%,hsl(225_45%_15%)_100%)]"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -right-24 top-16 -z-10 h-72 w-72 rounded-full bg-primary/10 blur-3xl lg:hidden"
          aria-hidden="true"
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-24 -z-10 h-80 w-80 rounded-full bg-cyan-400/10 blur-3xl lg:hidden"
          aria-hidden="true"
        />

        <div className="w-full max-w-[420px] lg:max-w-[420px]">
          {/* Mobile brand header */}
          <div className="lg:hidden flex flex-col items-center gap-3 mb-7 text-center">
            <div className="flex items-center gap-3">
              <div className="relative flex h-12 w-12 items-center justify-center rounded-[0.9rem] bg-primary shadow-[0_12px_30px_hsl(239_84%_64%_/_0.25)] ring-1 ring-white/20">
                <div className="absolute inset-1 rounded-[0.65rem] border border-white/20" aria-hidden="true" />
                <BrandGlyph className="w-5 h-5 text-primary-foreground" />
              </div>
              <h1 className="text-[1.75rem] font-bold tracking-[-0.05em] text-white" data-testid="text-brand-title-mobile">
                MyStoreDesk
              </h1>
            </div>
            <p className="text-[0.65rem] font-semibold uppercase tracking-[0.18em] text-white/40">
              La scrivania digitale del punto vendita
            </p>
          </div>

          <div className="relative rounded-[1.45rem] border border-white/[0.13] bg-gradient-to-b from-white/[0.085] to-white/[0.035] p-5 shadow-[0_24px_70px_rgba(2,6,23,0.3),inset_0_1px_0_rgba(255,255,255,0.08)] backdrop-blur-xl sm:p-7 lg:rounded-none lg:border-0 lg:bg-transparent lg:p-0 lg:shadow-none lg:backdrop-blur-none">
            <div className="pointer-events-none absolute -top-px left-10 right-10 h-px bg-gradient-to-r from-transparent via-primary/60 to-transparent" aria-hidden="true" />
            <div className="mb-7 lg:mb-6">
              <div className="mb-4 hidden h-px w-10 bg-primary/70 lg:block" aria-hidden="true" />
              <h2 className="text-[1.8rem] font-bold tracking-[-0.045em] text-white lg:text-2xl lg:tracking-tight lg:text-foreground" data-testid="text-auth-title">Bentornato</h2>
              <p className="mt-2 text-sm leading-relaxed text-slate-300/75 lg:mt-1 lg:text-muted-foreground">
                Accedi al tuo account per continuare
              </p>
              <div className="mt-4 flex items-center gap-2 text-[0.68rem] font-medium text-white/45 lg:hidden">
                <Shield className="h-4 w-4 shrink-0 text-primary/75" aria-hidden="true" />
                <span>Piattaforma sicura per operatori e dealer autorizzati</span>
              </div>
            </div>

            <form onSubmit={handleLogin} className="space-y-5">
              <div className="space-y-2">
                <Label htmlFor="login-email" className="text-sm font-medium text-slate-200 lg:text-foreground">Email</Label>
                <Input
                  id="login-email"
                  type="email"
                  placeholder="nome@azienda.it"
                  value={loginEmail}
                  onChange={(e) => setLoginEmail(e.target.value)}
                  required
                  className="h-12 border-white/15 bg-white/[0.07] text-white placeholder:text-slate-400/70 focus-visible:border-primary/80 focus-visible:ring-primary/25 lg:h-10 lg:border-input lg:bg-background lg:text-foreground lg:placeholder:text-muted-foreground"
                  data-testid="input-login-email"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="login-password" className="text-sm font-medium text-slate-200 lg:text-foreground">Password</Label>
                <div className="relative">
                  <Input
                    id="login-password"
                    type={showLoginPassword ? 'text' : 'password'}
                    placeholder="Inserisci la password"
                    value={loginPassword}
                    onChange={(e) => setLoginPassword(e.target.value)}
                    required
                    className="h-12 pr-12 border-white/15 bg-white/[0.07] text-white placeholder:text-slate-400/70 focus-visible:border-primary/80 focus-visible:ring-primary/25 lg:h-10 lg:border-input lg:bg-background lg:text-foreground lg:placeholder:text-muted-foreground"
                    data-testid="input-login-password"
                  />
                  <button
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-0.5 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center rounded-lg text-slate-300/75 transition-colors hover:bg-white/10 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/70 lg:right-1 lg:h-10 lg:w-10 lg:text-muted-foreground lg:hover:bg-muted lg:hover:text-foreground"
                    data-testid="button-toggle-login-password"
                  >
                    {showLoginPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <Button type="submit" className="h-12 w-full font-semibold shadow-[0_10px_24px_hsl(239_84%_64%_/_0.22)] transition-transform hover:-translate-y-0.5 active:translate-y-0 lg:h-10 lg:shadow-sm lg:hover:translate-y-0 lg:active:translate-y-0" disabled={loading} data-testid="button-login">
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

            <p className="mt-6 text-center text-sm leading-relaxed text-slate-300/65 lg:text-muted-foreground">
              Per ottenere un account, contatta l'amministratore della tua organizzazione.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
