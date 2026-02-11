import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from '@/hooks/useAuth';
import { usePreventivi, Preventivo } from '@/hooks/usePreventivi';
import { PreventiviList } from '@/components/PreventiviList';
import { PdvDataTable } from '@/components/PdvDataTable';
import { PdvDrillDown } from '@/components/PdvDrillDown';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Progress } from '@/components/ui/progress';
import { 
  Loader2, ArrowLeft, TrendingUp, TrendingDown, Euro, Target, Calendar, 
  Users, FileText, BarChart3, Smartphone, Wifi, Zap, Shield, Award, Sparkles, Download
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  LineChart,
  Line,
  Legend,
  RadialBarChart,
  RadialBar,
} from 'recharts';

interface SinglePreventivoData {
  premioMobile: number;
  premioFisso: number;
  premioEnergia: number;
  premioAssicurazioni: number;
  premioPartnership: number;
  premioProtecta: number;
  premioExtraGaraIva: number;
  totale: number;
  puntiMobile: number;
  puntiFisso: number;
  volumiMobile: number;
  volumiFisso: number;
  categorieDistribuzione: { name: string; value: number; color: string }[];
}

interface AggregatedData {
  totalPreventivi: number;
  totalPremioAttuale: number;
  totalPremioPrevisionale: number;
  variazione: number;
  variazionePercent: number;
  preventiviPerMese: { mese: string; count: number; premio: number }[];
  categorieDistribuzione: { name: string; value: number; color: string }[];
  categorieBreakdown: {
    mobile: number;
    fisso: number;
    partnership: number;
    energia: number;
    assicurazioni: number;
    protecta: number;
    extraGaraIva: number;
  };
}

// Palette colori armonizzata con il design system
const CATEGORY_COLORS = {
  Mobile: 'hsl(20, 100%, 50%)',      // Primary orange
  Fisso: 'hsl(280, 85%, 50%)',       // Accent purple
  Partnership: 'hsl(200, 80%, 50%)', // Blue
  Energia: 'hsl(145, 65%, 45%)',     // Success green
  Assicurazioni: 'hsl(45, 100%, 50%)', // Gold
  Protecta: 'hsl(330, 70%, 50%)',    // Pink
  'Extra Gara P.IVA': 'hsl(180, 60%, 45%)', // Teal
};

const COLORS = Object.values(CATEGORY_COLORS);

const formatCurrency = (value: number) => {
  if (isNaN(value) || value === null || value === undefined) {
    return '€ 0';
  }
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
};

const extractSinglePreventivoData = (preventivo: Preventivo): SinglePreventivoData => {
  const data = preventivo.data as Record<string, unknown>;
  
  const risultatoMobile = data?.risultatoMobile as Record<string, unknown> | undefined;
  const risultatoFisso = data?.risultatoFisso as Record<string, unknown> | undefined;
  const risultatoEnergia = data?.risultatoEnergia as Record<string, unknown> | undefined;
  const risultatoAssicurazioni = data?.risultatoAssicurazioni as Record<string, unknown> | undefined;
  const risultatoPartnership = data?.risultatoPartnership as Record<string, unknown> | undefined;
  const risultatoProtecta = data?.risultatoProtecta as Record<string, unknown> | undefined;

  let premioMobile = 0;
  let premioFisso = 0;
  let premioEnergia = 0;
  let premioAssicurazioni = 0;
  let premioPartnership = 0;
  let premioProtecta = 0;
  let premioExtraGaraIva = 0;
  let puntiMobile = 0;
  let puntiFisso = 0;
  let volumiMobile = 0;
  let volumiFisso = 0;

  // Mobile - usa il totale se disponibile, altrimenti somma i singoli
  if (risultatoMobile && typeof risultatoMobile === 'object') {
    if (typeof risultatoMobile.totale === 'number') {
      premioMobile = risultatoMobile.totale || 0;
    }
    const posList = risultatoMobile.perPos as Array<{
      premio?: number;
      punti?: number;
      attivazioniTotali?: number;
    }> | undefined;
    if (Array.isArray(posList)) {
      posList.forEach((pos) => {
        if (!risultatoMobile.totale) {
          premioMobile += pos.premio || 0;
        }
        puntiMobile += pos.punti || 0;
        volumiMobile += pos.attivazioniTotali || 0;
      });
    }
  }

  // Fisso
  if (risultatoFisso && typeof risultatoFisso === 'object') {
    if (typeof risultatoFisso.totale === 'number') {
      premioFisso = risultatoFisso.totale || 0;
    }
    const posList = risultatoFisso.perPos as Array<{
      premio?: number;
      punti?: number;
      attivazioniTotali?: number;
    }> | undefined;
    if (Array.isArray(posList)) {
      posList.forEach((pos) => {
        if (!risultatoFisso.totale) {
          premioFisso += pos.premio || 0;
        }
        puntiFisso += pos.punti || 0;
        volumiFisso += pos.attivazioniTotali || 0;
      });
    }
  }

  // Energia
  if (risultatoEnergia && typeof risultatoEnergia === 'object') {
    premioEnergia = (risultatoEnergia.totale as number) || 0;
  }

  // Assicurazioni
  if (risultatoAssicurazioni && typeof risultatoAssicurazioni === 'object') {
    premioAssicurazioni = (risultatoAssicurazioni.totalePremio as number) || 0;
  }

  // Partnership
  if (risultatoPartnership && typeof risultatoPartnership === 'object') {
    premioPartnership = (risultatoPartnership.totale as number) || 0;
  }

  // Protecta
  if (risultatoProtecta && typeof risultatoProtecta === 'object') {
    premioProtecta = (risultatoProtecta.totalePremio as number) || 0;
  }

  // Extra Gara P.IVA - leggi dal totale salvato
  const savedExtraGaraIva = data?.risultatoExtraGaraIva as Record<string, unknown> | undefined;
  if (savedExtraGaraIva && typeof savedExtraGaraIva === 'object') {
    premioExtraGaraIva = (savedExtraGaraIva.totalePremio as number) || 0;
  }

  // Proteggi da NaN
  premioMobile = isNaN(premioMobile) ? 0 : premioMobile;
  premioFisso = isNaN(premioFisso) ? 0 : premioFisso;
  premioEnergia = isNaN(premioEnergia) ? 0 : premioEnergia;
  premioAssicurazioni = isNaN(premioAssicurazioni) ? 0 : premioAssicurazioni;
  premioPartnership = isNaN(premioPartnership) ? 0 : premioPartnership;
  premioProtecta = isNaN(premioProtecta) ? 0 : premioProtecta;
  premioExtraGaraIva = isNaN(premioExtraGaraIva) ? 0 : premioExtraGaraIva;

  const totale = premioMobile + premioFisso + premioEnergia + premioAssicurazioni + premioPartnership + premioProtecta + premioExtraGaraIva;

  const categorieDistribuzione = [
    { name: 'Mobile', value: premioMobile, color: CATEGORY_COLORS.Mobile },
    { name: 'Fisso', value: premioFisso, color: CATEGORY_COLORS.Fisso },
    { name: 'Partnership', value: premioPartnership, color: CATEGORY_COLORS.Partnership },
    { name: 'Energia', value: premioEnergia, color: CATEGORY_COLORS.Energia },
    { name: 'Assicurazioni', value: premioAssicurazioni, color: CATEGORY_COLORS.Assicurazioni },
    { name: 'Protecta', value: premioProtecta, color: CATEGORY_COLORS.Protecta },
    { name: 'Extra Gara P.IVA', value: premioExtraGaraIva, color: CATEGORY_COLORS['Extra Gara P.IVA'] },
  ].filter(c => c.value > 0);

  return {
    premioMobile,
    premioFisso,
    premioEnergia,
    premioAssicurazioni,
    premioPartnership,
    premioProtecta,
    premioExtraGaraIva,
    totale,
    puntiMobile,
    puntiFisso,
    volumiMobile,
    volumiFisso,
    categorieDistribuzione,
  };
};

// KPI Card con design moderno
interface KpiCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: React.ReactNode;
  trend?: { value: number; positive: boolean };
  gradient?: string;
  progress?: number;
}

const KpiCard = ({ title, value, subtitle, icon, trend, gradient, progress }: KpiCardProps) => (
  <Card className={`relative overflow-hidden transition-all duration-300 hover:shadow-lg hover:-translate-y-1 ${gradient || ''}`}>
    <div className="absolute top-0 right-0 w-24 h-24 opacity-10">
      <div className="w-full h-full flex items-center justify-center text-6xl">
        {icon}
      </div>
    </div>
    <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
      <CardTitle className="text-sm font-medium text-muted-foreground">{title}</CardTitle>
      <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center">
        {icon}
      </div>
    </CardHeader>
    <CardContent>
      <div className="text-2xl font-bold">{value}</div>
      {subtitle && <p className="text-xs text-muted-foreground mt-1">{subtitle}</p>}
      {trend && (
        <div className={`flex items-center gap-1 mt-2 text-xs ${trend.positive ? 'text-green-600' : 'text-red-500'}`}>
          {trend.positive ? <TrendingUp className="h-3 w-3" /> : <TrendingDown className="h-3 w-3" />}
          <span>{trend.positive ? '+' : ''}{trend.value.toFixed(1)}%</span>
        </div>
      )}
      {progress !== undefined && (
        <div className="mt-3">
          <Progress value={progress} className="h-1.5" />
        </div>
      )}
    </CardContent>
  </Card>
);

// Categoria Card con indicatore visivo
interface CategoryCardProps {
  name: string;
  value: number;
  icon: React.ReactNode;
  color: string;
  percentage: number;
}

const CategoryCard = ({ name, value, icon, color, percentage }: CategoryCardProps) => (
  <div className="flex items-center gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors">
    <div 
      className="h-10 w-10 rounded-lg flex items-center justify-center"
      style={{ backgroundColor: `${color}20` }}
    >
      <div style={{ color }}>{icon}</div>
    </div>
    <div className="flex-1 min-w-0">
      <div className="flex items-center justify-between">
        <span className="text-sm font-medium truncate">{name}</span>
        <span className="font-semibold">{formatCurrency(value)}</span>
      </div>
      <div className="mt-1 flex items-center gap-2">
        <div className="flex-1 h-1.5 rounded-full bg-muted">
          <div 
            className="h-full rounded-full transition-all duration-500"
            style={{ width: `${percentage}%`, backgroundColor: color }}
          />
        </div>
        <span className="text-xs text-muted-foreground">{percentage.toFixed(0)}%</span>
      </div>
    </div>
  </div>
);

export default function Dashboard() {
  const [, setLocation] = useLocation();
  const { profile, loading: authLoading } = useAuth();
  const { preventivi, loading, fetchPreventivi, deletePreventivo } = usePreventivi();
  const [selectedPreventivoId, setSelectedPreventivoId] = useState<string | 'all'>('all');
  const analyticsRef = useRef<HTMLDivElement>(null);
  const [exporting, setExporting] = useState(false);

  const handleExportPdf = useCallback(async () => {
    if (!analyticsRef.current) return;
    // Set exporting=true first so PdvDrillDown re-renders with forceExpandAll
    setExporting(true);
  }, []);

  // When exporting becomes true, wait for render then print
  useEffect(() => {
    if (!exporting || !analyticsRef.current) return;

    const timer = setTimeout(() => {
      const el = analyticsRef.current!;
      
      // Also click closed accordion items
      const accordionTriggers = el.querySelectorAll('button[data-state="closed"][data-radix-collection-item]');
      accordionTriggers.forEach((trigger) => {
        (trigger as HTMLElement).click();
      });

      setTimeout(() => {
        document.body.classList.add('printing-analytics');
        el.classList.add('print-target');

        window.print();

        document.body.classList.remove('printing-analytics');
        el.classList.remove('print-target');
        setExporting(false);
      }, 500);
    }, 300);

    return () => clearTimeout(timer);
  }, [exporting]);

  useEffect(() => {
    fetchPreventivi();
  }, [fetchPreventivi]);

  const selectedPreventivo = useMemo(() => {
    if (selectedPreventivoId === 'all') return null;
    return preventivi.find(p => p.id === selectedPreventivoId) || null;
  }, [selectedPreventivoId, preventivi]);

  const singlePreventivoData = useMemo<SinglePreventivoData | null>(() => {
    if (!selectedPreventivo) return null;
    return extractSinglePreventivoData(selectedPreventivo);
  }, [selectedPreventivo]);

  const aggregatedData = useMemo<AggregatedData>(() => {
    let totalPremioAttuale = 0;
    let totalPremioPrevisionale = 0;
    const perMeseMap: Record<string, { count: number; premio: number }> = {};
    const categorieMap: Record<string, number> = {
      'Mobile': 0,
      'Fisso': 0,
      'Energia': 0,
      'Assicurazioni': 0,
      'Partnership': 0,
      'Protecta': 0,
      'Extra Gara P.IVA': 0,
    };

    preventivi.forEach((preventivo) => {
      const extracted = extractSinglePreventivoData(preventivo);
      
      totalPremioPrevisionale += extracted.totale;
      categorieMap['Mobile'] += extracted.premioMobile;
      categorieMap['Fisso'] += extracted.premioFisso;
      categorieMap['Partnership'] += extracted.premioPartnership;
      categorieMap['Energia'] += extracted.premioEnergia;
      categorieMap['Assicurazioni'] += extracted.premioAssicurazioni;
      categorieMap['Protecta'] += extracted.premioProtecta;
      categorieMap['Extra Gara P.IVA'] += extracted.premioExtraGaraIva;

      // Aggregate by month
      const createdAt = new Date(preventivo.created_at);
      const meseKey = `${createdAt.getFullYear()}-${String(createdAt.getMonth() + 1).padStart(2, '0')}`;
      if (!perMeseMap[meseKey]) {
        perMeseMap[meseKey] = { count: 0, premio: 0 };
      }
      perMeseMap[meseKey].count += 1;
      perMeseMap[meseKey].premio += extracted.totale;
    });

    const variazione = totalPremioPrevisionale - totalPremioAttuale;
    const variazionePercent = totalPremioAttuale > 0 ? (variazione / totalPremioAttuale) * 100 : 0;

    const mesiLabels: Record<string, string> = {
      '01': 'Gen', '02': 'Feb', '03': 'Mar', '04': 'Apr',
      '05': 'Mag', '06': 'Giu', '07': 'Lug', '08': 'Ago',
      '09': 'Set', '10': 'Ott', '11': 'Nov', '12': 'Dic',
    };

    const preventiviPerMese = Object.entries(perMeseMap)
      .sort(([a], [b]) => a.localeCompare(b))
      .slice(-6)
      .map(([key, val]) => ({
        mese: mesiLabels[key.split('-')[1]] || key,
        count: val.count,
        premio: val.premio,
      }));

    const categorieDistribuzione = Object.entries(categorieMap)
      .filter(([, value]) => value > 0)
      .map(([name, value]) => ({ 
        name, 
        value,
        color: CATEGORY_COLORS[name as keyof typeof CATEGORY_COLORS] || COLORS[0]
      }));

    return {
      totalPreventivi: preventivi.length,
      totalPremioAttuale,
      totalPremioPrevisionale,
      variazione,
      variazionePercent,
      preventiviPerMese,
      categorieDistribuzione,
      categorieBreakdown: {
        mobile: categorieMap['Mobile'],
        fisso: categorieMap['Fisso'],
        partnership: categorieMap['Partnership'],
        energia: categorieMap['Energia'],
        assicurazioni: categorieMap['Assicurazioni'],
        protecta: categorieMap['Protecta'],
        extraGaraIva: categorieMap['Extra Gara P.IVA'],
      },
    };
  }, [preventivi]);

  if (authLoading || loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-background">
        <div className="text-center space-y-4">
          <Loader2 className="h-12 w-12 animate-spin text-primary mx-auto" />
          <p className="text-muted-foreground">Caricamento dashboard...</p>
        </div>
      </div>
    );
  }

  const getCategoryIcon = (name: string) => {
    const icons: Record<string, React.ReactNode> = {
      'Mobile': <Smartphone className="h-4 w-4" />,
      'Fisso': <Wifi className="h-4 w-4" />,
      'Partnership': <Users className="h-4 w-4" />,
      'Energia': <Zap className="h-4 w-4" />,
      'Assicurazioni': <Shield className="h-4 w-4" />,
      'Protecta': <Award className="h-4 w-4" />,
      'Extra Gara P.IVA': <Sparkles className="h-4 w-4" />,
    };
    return icons[name] || <Target className="h-4 w-4" />;
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-background via-background to-muted/30">
      {/* Header con gradient sottile */}
      <div className="border-b bg-card/80 backdrop-blur-sm sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-4">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-2xl font-bold bg-gradient-to-r from-primary to-accent bg-clip-text text-transparent">
                Dashboard
              </h1>
              <p className="text-sm text-muted-foreground">
                Gestione preventivi e analytics • {profile?.organization_id ? 'Organizzazione' : 'Personale'}
              </p>
            </div>
            <Button variant="outline" onClick={() => setLocation('/')} className="gap-2">
              <ArrowLeft className="h-4 w-4" />
              Simulatore
            </Button>
          </div>
        </div>
      </div>

      <div className="max-w-7xl mx-auto p-4 space-y-6">
        <Tabs defaultValue="preventivi" className="space-y-6">
          <TabsList className="bg-muted/50 p-1">
            <TabsTrigger value="preventivi" className="flex items-center gap-2 data-[state=active]:bg-background">
              <FileText className="h-4 w-4" />
              Preventivi
            </TabsTrigger>
            <TabsTrigger value="analytics" className="flex items-center gap-2 data-[state=active]:bg-background">
              <BarChart3 className="h-4 w-4" />
              Analytics
            </TabsTrigger>
          </TabsList>

          <TabsContent value="preventivi">
            <PreventiviList 
              preventivi={preventivi} 
              onDelete={deletePreventivo}
              loading={loading}
            />
          </TabsContent>

          <TabsContent value="analytics" className="space-y-6">
            <div ref={analyticsRef} className="space-y-6">
            <Card className="border-dashed">
              <CardContent className="pt-4">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center gap-4">
                    <div className="flex items-center gap-2">
                      <Target className="h-5 w-5 text-primary" />
                      <span className="font-medium">Visualizza:</span>
                    </div>
                  <Select value={selectedPreventivoId} onValueChange={(v) => setSelectedPreventivoId(v as string)}>
                    <SelectTrigger className="w-full sm:w-[400px]">
                      <SelectValue placeholder="Seleziona un preventivo" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">
                        <span className="flex items-center gap-2">
                          <BarChart3 className="h-4 w-4" />
                          Tutti i preventivi (aggregato)
                        </span>
                      </SelectItem>
                      {preventivi.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          {p.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  </div>
                  <Button onClick={handleExportPdf} disabled={exporting} variant="outline" size="sm" className="gap-2 shrink-0">
                    {exporting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Download className="h-4 w-4" />}
                    <span className="hidden sm:inline">{exporting ? 'Esporta...' : 'PDF'}</span>
                  </Button>
                </div>
              </CardContent>
            </Card>

            {/* Vista Aggregata */}
            {selectedPreventivoId === 'all' ? (
              <>
                {/* KPI Cards Row */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                  <KpiCard
                    title="Preventivi Totali"
                    value={aggregatedData.totalPreventivi}
                    subtitle="Preventivi creati"
                    icon={<FileText className="h-4 w-4 text-primary" />}
                  />
                  <KpiCard
                    title="Premio Totale"
                    value={formatCurrency(aggregatedData.totalPremioPrevisionale)}
                    subtitle="Somma tutti i preventivi"
                    icon={<Euro className="h-4 w-4 text-primary" />}
                  />
                  <KpiCard
                    title="Media per Preventivo"
                    value={formatCurrency(aggregatedData.totalPreventivi > 0 ? aggregatedData.totalPremioPrevisionale / aggregatedData.totalPreventivi : 0)}
                    subtitle="Premio medio"
                    icon={<Target className="h-4 w-4 text-primary" />}
                  />
                  <KpiCard
                    title="Categorie Attive"
                    value={aggregatedData.categorieDistribuzione.length}
                    subtitle="Su 7 disponibili"
                    icon={<BarChart3 className="h-4 w-4 text-primary" />}
                    progress={(aggregatedData.categorieDistribuzione.length / 7) * 100}
                  />
                </div>

                {/* Breakdown Categorie */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <Sparkles className="h-5 w-5 text-primary" />
                      Breakdown per Categoria
                    </CardTitle>
                    <CardDescription>Ripartizione dettagliata dei premi per servizio</CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-3">
                      {aggregatedData.categorieDistribuzione.map((cat) => (
                        <CategoryCard
                          key={cat.name}
                          name={cat.name}
                          value={cat.value}
                          icon={getCategoryIcon(cat.name)}
                          color={cat.color}
                          percentage={(cat.value / aggregatedData.totalPremioPrevisionale) * 100}
                        />
                      ))}
                    </div>
                  </CardContent>
                </Card>

                {/* Charts Row */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Bar Chart - Andamento Mensile */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Calendar className="h-5 w-5 text-primary" />
                        Andamento Mensile
                      </CardTitle>
                      <CardDescription>Premi negli ultimi mesi</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {aggregatedData.preventiviPerMese.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <BarChart data={aggregatedData.preventiviPerMese}>
                            <defs>
                              <linearGradient id="barGradient" x1="0" y1="0" x2="0" y2="1">
                                <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={1} />
                                <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0.6} />
                              </linearGradient>
                            </defs>
                            <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                            <XAxis dataKey="mese" className="text-xs" axisLine={false} tickLine={false} />
                            <YAxis className="text-xs" axisLine={false} tickLine={false} tickFormatter={(v) => `€${Math.round(v/1000)}k`} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              }}
                              formatter={(value: number) => [formatCurrency(value), 'Premio']}
                            />
                            <Bar dataKey="premio" fill="url(#barGradient)" radius={[8, 8, 0, 0]} />
                          </BarChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                          <div className="text-center">
                            <Calendar className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>Nessun dato disponibile</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>

                  {/* Pie Chart - Distribuzione */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        Distribuzione Premi
                      </CardTitle>
                      <CardDescription>Ripartizione percentuale per categoria</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {aggregatedData.categorieDistribuzione.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={aggregatedData.categorieDistribuzione}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={2}
                              dataKey="value"
                            >
                              {aggregatedData.categorieDistribuzione.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              }}
                              formatter={(value: number) => [formatCurrency(value), 'Premio']}
                            />
                            <Legend 
                              formatter={(value) => <span className="text-sm">{value}</span>}
                            />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                          <div className="text-center">
                            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>Nessun dato disponibile</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Trend Line Chart */}
                <Card>
                  <CardHeader>
                    <CardTitle className="flex items-center gap-2">
                      <TrendingUp className="h-5 w-5 text-primary" />
                      Trend Premi
                    </CardTitle>
                    <CardDescription>Evoluzione dei premi nel tempo</CardDescription>
                  </CardHeader>
                  <CardContent>
                    {aggregatedData.preventiviPerMese.length > 0 ? (
                      <ResponsiveContainer width="100%" height={300}>
                        <LineChart data={aggregatedData.preventiviPerMese}>
                          <defs>
                            <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                              <stop offset="0%" stopColor="hsl(var(--primary))" stopOpacity={0.3} />
                              <stop offset="100%" stopColor="hsl(var(--primary))" stopOpacity={0} />
                            </linearGradient>
                          </defs>
                          <CartesianGrid strokeDasharray="3 3" className="stroke-muted" vertical={false} />
                          <XAxis dataKey="mese" className="text-xs" axisLine={false} tickLine={false} />
                          <YAxis className="text-xs" axisLine={false} tickLine={false} tickFormatter={(value) => formatCurrency(value)} />
                          <Tooltip
                            contentStyle={{
                              backgroundColor: 'hsl(var(--card))',
                              border: '1px solid hsl(var(--border))',
                              borderRadius: '12px',
                              boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                            }}
                            formatter={(value: number) => [formatCurrency(value), 'Premio']}
                          />
                          <Line
                            type="monotone"
                            dataKey="premio"
                            stroke="hsl(var(--primary))"
                            strokeWidth={3}
                            dot={{ fill: 'hsl(var(--primary))', strokeWidth: 2, r: 5 }}
                            activeDot={{ r: 8, stroke: 'hsl(var(--primary))', strokeWidth: 2 }}
                          />
                        </LineChart>
                      </ResponsiveContainer>
                    ) : (
                      <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                        <div className="text-center">
                          <TrendingUp className="h-12 w-12 mx-auto mb-2 opacity-50" />
                          <p>Nessun dato disponibile</p>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            ) : singlePreventivoData ? (
              <>
                {/* Single Preventivo - KPI Cards */}
                <div>
                  <KpiCard
                    title="Premio Totale"
                    value={formatCurrency(singlePreventivoData.totale)}
                    subtitle="Totale previsto"
                    icon={<Euro className="h-4 w-4 text-primary" />}
                  />
                </div>

                {/* Single Preventivo - Detail Cards */}
                <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                  {/* Premi per Categoria - Card con layout migliorato */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Euro className="h-5 w-5 text-primary" />
                        Premi per Categoria
                      </CardTitle>
                      <CardDescription>Dettaglio economico per servizio</CardDescription>
                    </CardHeader>
                    <CardContent className="space-y-3">
                      {singlePreventivoData.categorieDistribuzione.map((cat) => (
                        <CategoryCard
                          key={cat.name}
                          name={cat.name}
                          value={cat.value}
                          icon={getCategoryIcon(cat.name)}
                          color={cat.color}
                          percentage={(cat.value / singlePreventivoData.totale) * 100}
                        />
                      ))}
                      <div className="border-t pt-4 mt-4 flex justify-between items-center">
                        <span className="font-semibold">Totale</span>
                        <span className="text-2xl font-bold text-primary">{formatCurrency(singlePreventivoData.totale)}</span>
                      </div>
                    </CardContent>
                  </Card>

                  {/* Pie Chart for Single */}
                  <Card>
                    <CardHeader>
                      <CardTitle className="flex items-center gap-2">
                        <Users className="h-5 w-5 text-primary" />
                        Distribuzione Premi
                      </CardTitle>
                      <CardDescription>Ripartizione per categoria di servizio</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {singlePreventivoData.categorieDistribuzione.length > 0 ? (
                        <ResponsiveContainer width="100%" height={300}>
                          <PieChart>
                            <Pie
                              data={singlePreventivoData.categorieDistribuzione}
                              cx="50%"
                              cy="50%"
                              innerRadius={60}
                              outerRadius={100}
                              paddingAngle={2}
                              dataKey="value"
                              label={({ name, percent }) => `${(percent * 100).toFixed(0)}%`}
                              labelLine={false}
                            >
                              {singlePreventivoData.categorieDistribuzione.map((entry, index) => (
                                <Cell key={`cell-${index}`} fill={entry.color} />
                              ))}
                            </Pie>
                            <Tooltip
                              contentStyle={{
                                backgroundColor: 'hsl(var(--card))',
                                border: '1px solid hsl(var(--border))',
                                borderRadius: '12px',
                                boxShadow: '0 4px 12px rgba(0,0,0,0.1)',
                              }}
                              formatter={(value: number) => [formatCurrency(value), 'Premio']}
                            />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                      ) : (
                        <div className="flex items-center justify-center h-[300px] text-muted-foreground">
                          <div className="text-center">
                            <Users className="h-12 w-12 mx-auto mb-2 opacity-50" />
                            <p>Nessun dato disponibile</p>
                          </div>
                        </div>
                      )}
                    </CardContent>
                  </Card>
                </div>

                {/* Drill-Down per PDV */}
                {selectedPreventivo && (
                  <PdvDrillDown preventivo={selectedPreventivo} forceExpandAll={exporting} />
                )}

                {/* PDV Data Table & Charts */}
                {selectedPreventivo && (
                  <PdvDataTable preventivo={selectedPreventivo} />
                )}
              </>
            ) : (
              <div className="flex items-center justify-center h-[300px]">
                <div className="text-center">
                  <Target className="h-16 w-16 mx-auto mb-4 text-muted-foreground/50" />
                  <p className="text-muted-foreground">Seleziona un preventivo per visualizzare i dettagli</p>
                </div>
              </div>
            )}
            </div>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
