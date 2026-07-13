import { useState, useMemo, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/lib/basePath';
import { queryClient } from '@/lib/queryClient';
import { useQuery } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { AppNavbar } from '@/components/AppNavbar';
import { DataTableSkeleton } from '@/components/skeletons';
import {
  Download,
  Loader2,
  ChevronLeft,
  ChevronRight,
  AlertTriangle,
  ListChecks,
} from 'lucide-react';
import type {
  CanvassOffer,
  CanvassStepGroup,
  CanvassAggregatedItem,
  CanvassUnmappedItem,
  CanvassMatchType,
} from '@shared/canvassMapping';

interface CatalogData {
  periodo: string;
  source: 'saved' | 'default';
  offersCount: number;
  stepsCount: number;
  offers: CanvassOffer[];
  stepsByPista: CanvassStepGroup[];
}

interface MappedSalesData {
  month: number;
  year: number;
  hasCanvassBrand: boolean;
  periodo: string;
  source: 'saved' | 'default';
  totalSales?: number;
  byPista: Record<string, Record<string, Record<string, CanvassAggregatedItem>>>;
  unmapped: CanvassUnmappedItem[];
  totalArticoli: number;
  totalMapped: number;
  totalUnmapped: number;
  matchCounts: Record<CanvassMatchType, number>;
}

interface OrgLite {
  id: string;
  name: string;
}

const MONTH_NAMES = ['Gennaio', 'Febbraio', 'Marzo', 'Aprile', 'Maggio', 'Giugno', 'Luglio', 'Agosto', 'Settembre', 'Ottobre', 'Novembre', 'Dicembre'];

function fmtEuro(n: number): string {
  return n.toLocaleString('it-IT', { style: 'currency', currency: 'EUR' });
}

export default function CanvassVodafoneFastweb() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isSuperAdmin = profile?.role === 'super_admin';

  const now = new Date();
  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());
  const [pistaFilter, setPistaFilter] = useState<string>('all');
  const [search, setSearch] = useState('');
  const [selectedOrg, setSelectedOrg] = useState<string>('');
  const [importing, setImporting] = useState(false);

  const { data: catalog, isLoading: loadingCatalog } = useQuery<CatalogData>({
    queryKey: ['/api/admin/canvass-catalog'],
    enabled: !!profile,
  });

  const { data: orgs } = useQuery<OrgLite[]>({
    queryKey: ['/api/admin/organizations'],
    enabled: !!profile && isSuperAdmin,
  });

  useEffect(() => {
    if (!selectedOrg && profile?.organizationId) setSelectedOrg(profile.organizationId);
  }, [profile?.organizationId, selectedOrg]);

  const orgParam = isSuperAdmin ? selectedOrg : (profile?.organizationId || '');

  const { data: mapped, isLoading: loadingMapped } = useQuery<MappedSalesData>({
    queryKey: ['/api/admin/canvass-mapped-sales', orgParam, month, year],
    enabled: !!profile && !!orgParam,
    queryFn: async () => {
      const params = new URLSearchParams();
      if (orgParam) params.set('organization_id', orgParam);
      params.set('month', String(month));
      params.set('year', String(year));
      const res = await fetch(apiUrl(`/api/admin/canvass-mapped-sales?${params.toString()}`), {
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Errore nel caricamento delle vendite categorizzate');
      return res.json();
    },
  });

  const piste = useMemo(() => {
    if (!catalog) return [];
    return Array.from(new Set(catalog.offers.map((o) => o.pista))).sort();
  }, [catalog]);

  const filteredOffers = useMemo(() => {
    if (!catalog) return [];
    const q = search.trim().toUpperCase();
    return catalog.offers.filter((o) => {
      if (pistaFilter !== 'all' && o.pista !== pistaFilter) return false;
      if (q && !o.codice.toUpperCase().includes(q) && !o.nomeEtichetta.toUpperCase().includes(q)) return false;
      return true;
    });
  }, [catalog, pistaFilter, search]);

  const mappedItems = useMemo<CanvassAggregatedItem[]>(() => {
    if (!mapped) return [];
    const items: CanvassAggregatedItem[] = [];
    for (const cats of Object.values(mapped.byPista)) {
      for (const tips of Object.values(cats)) {
        for (const item of Object.values(tips)) items.push(item);
      }
    }
    return items.sort((a, b) => a.pista.localeCompare(b.pista) || b.pezzi - a.pezzi);
  }, [mapped]);

  const handleImport = async () => {
    try {
      setImporting(true);
      const res = await fetch(apiUrl('/api/admin/canvass-catalog/import'), {
        method: 'POST',
        credentials: 'include',
      });
      if (!res.ok) throw new Error('Errore');
      const data = await res.json();
      queryClient.invalidateQueries({ queryKey: ['/api/admin/canvass-catalog'] });
      queryClient.invalidateQueries({ queryKey: ['/api/admin/canvass-mapped-sales'] });
      toast({
        title: 'Catalogo importato',
        description: `${data.offersCount} offerte, ${data.stepsCount} step (${data.periodo}).`,
      });
    } catch {
      toast({ title: 'Errore', description: 'Impossibile importare il catalogo.', variant: 'destructive' });
    } finally {
      setImporting(false);
    }
  };

  const changeMonth = (delta: number) => {
    let m = month + delta;
    let y = year;
    if (m > 12) { m = 1; y++; }
    if (m < 1) { m = 12; y--; }
    setMonth(m);
    setYear(y);
  };

  if (!['super_admin', 'admin'].includes(profile?.role || '')) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Accesso non autorizzato</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="MyStoreDesk">
        {catalog && (
          <Badge variant="outline" data-testid="badge-canvass-periodo">
            {catalog.periodo} · {catalog.offersCount} offerte
          </Badge>
        )}
        {isSuperAdmin && (
          <Button size="sm" onClick={handleImport} disabled={importing} data-testid="btn-import-canvass">
            {importing ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Download className="h-4 w-4 mr-2" />}
            Importa catalogo
          </Button>
        )}
      </AppNavbar>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
        <Card className="mb-6">
          <CardHeader>
            <CardTitle>Canvass Vodafone / Fastweb</CardTitle>
            <CardDescription>
              Catalogo di riferimento (listino offerte + step di vendita) usato per categorizzare
              le vendite BiSuite canvass Vodafone/Fastweb per pista, categoria e tipologia. Separato
              dalla mappatura WindTre.
            </CardDescription>
          </CardHeader>
        </Card>

        <Tabs defaultValue="listino">
          <TabsList data-testid="tabs-canvass">
            <TabsTrigger value="listino" data-testid="tab-listino">Listino</TabsTrigger>
            <TabsTrigger value="step" data-testid="tab-step">Step di vendita</TabsTrigger>
            <TabsTrigger value="vendite" data-testid="tab-vendite">Vendite categorizzate</TabsTrigger>
          </TabsList>

          {/* LISTINO */}
          <TabsContent value="listino" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <CardTitle className="text-base">Listino canvass ({filteredOffers.length})</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    <Select value={pistaFilter} onValueChange={setPistaFilter}>
                      <SelectTrigger className="w-[200px]" data-testid="select-pista-filter">
                        <SelectValue placeholder="Tutte le piste" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="all">Tutte le piste</SelectItem>
                        {piste.map((p) => (
                          <SelectItem key={p} value={p}>{p}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <Input
                      placeholder="Cerca codice o nome…"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      className="w-[220px]"
                      data-testid="input-search-offer"
                    />
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingCatalog ? (
                  <DataTableSkeleton rows={8} columns={5} />
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className="border-b text-left text-muted-foreground">
                          <th className="py-2 pr-3 font-medium">Codice</th>
                          <th className="py-2 pr-3 font-medium">Nome etichetta</th>
                          <th className="py-2 pr-3 font-medium">Pista</th>
                          <th className="py-2 pr-3 font-medium">Categoria</th>
                          <th className="py-2 pr-3 font-medium">Tipologia</th>
                          <th className="py-2 pr-3 font-medium">Brand</th>
                          <th className="py-2 pr-3 font-medium text-right">Canone</th>
                        </tr>
                      </thead>
                      <tbody>
                        {filteredOffers.map((o) => (
                          <tr key={o.codice} className="border-b last:border-0" data-testid={`row-offer-${o.codice}`}>
                            <td className="py-1.5 pr-3 font-mono text-xs">{o.codice}</td>
                            <td className="py-1.5 pr-3">{o.nomeEtichetta}</td>
                            <td className="py-1.5 pr-3">{o.pista}</td>
                            <td className="py-1.5 pr-3">{o.categoria}</td>
                            <td className="py-1.5 pr-3">{o.tipologia}</td>
                            <td className="py-1.5 pr-3">
                              <Badge variant="outline" className="capitalize">{o.brand}</Badge>
                            </td>
                            <td className="py-1.5 pr-3 text-right">{o.canone ? fmtEuro(o.canone) : '—'}</td>
                          </tr>
                        ))}
                        {filteredOffers.length === 0 && (
                          <tr><td colSpan={7} className="py-6 text-center text-muted-foreground">Nessuna offerta.</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* STEP */}
          <TabsContent value="step" className="mt-4">
            {loadingCatalog ? (
              <DataTableSkeleton rows={8} columns={5} />
            ) : (
              <div className="grid gap-4 md:grid-cols-2">
                {catalog?.stepsByPista.map((g) => (
                  <Card key={g.pista} data-testid={`card-step-${g.pista}`}>
                    <CardHeader className="py-3">
                      <CardTitle className="text-sm flex items-center gap-2">
                        <ListChecks className="h-4 w-4" /> {g.pista}
                        <Badge variant="secondary">{g.steps.length}</Badge>
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="pt-0">
                      <ul className="space-y-1 text-sm">
                        {g.steps.map((s, i) => (
                          <li key={`${g.pista}-${i}`} className="flex items-start gap-2">
                            <span className="text-muted-foreground w-6 shrink-0">{s.ordine ?? '·'}</span>
                            <span className={s.attivo ? '' : 'text-muted-foreground line-through'}>{s.domanda}</span>
                            {!s.attivo && <Badge variant="outline" className="text-xs">off</Badge>}
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </TabsContent>

          {/* VENDITE CATEGORIZZATE */}
          <TabsContent value="vendite" className="mt-4">
            <Card>
              <CardHeader>
                <div className="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                  <CardTitle className="text-base">Vendite categorizzate</CardTitle>
                  <div className="flex items-center gap-2 flex-wrap">
                    {isSuperAdmin && (
                      <Select value={selectedOrg} onValueChange={setSelectedOrg}>
                        <SelectTrigger className="w-[220px]" data-testid="select-org">
                          <SelectValue placeholder="Seleziona organizzazione" />
                        </SelectTrigger>
                        <SelectContent>
                          {(orgs || []).map((o) => (
                            <SelectItem key={o.id} value={o.id}>{o.name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    )}
                    <div className="flex items-center gap-1">
                      <Button variant="outline" size="icon" onClick={() => changeMonth(-1)} data-testid="btn-prev-month">
                        <ChevronLeft className="h-4 w-4" />
                      </Button>
                      <span className="w-32 text-center text-sm" data-testid="text-month">{MONTH_NAMES[month - 1]} {year}</span>
                      <Button variant="outline" size="icon" onClick={() => changeMonth(1)} data-testid="btn-next-month">
                        <ChevronRight className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {loadingMapped ? (
                  <DataTableSkeleton rows={8} columns={5} />
                ) : !mapped ? (
                  <p className="text-muted-foreground text-sm">Seleziona un'organizzazione.</p>
                ) : !mapped.hasCanvassBrand ? (
                  <div className="flex items-start gap-2 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="note-no-brand">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>Questa organizzazione non ha il brand Vodafone o Fastweb associato: la categorizzazione canvass non si applica.</span>
                  </div>
                ) : (
                  <>
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-4">
                      <StatCard label="Articoli canvass" value={mapped.totalArticoli} testid="stat-articoli" />
                      <StatCard label="Categorizzati" value={mapped.totalMapped} testid="stat-mapped" />
                      <StatCard label="Non mappati" value={mapped.totalUnmapped} testid="stat-unmapped" />
                      <StatCard label="Match per codice" value={mapped.matchCounts.codice} testid="stat-match-codice" />
                    </div>

                    <div className="overflow-x-auto mb-6">
                      <table className="w-full text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 pr-3 font-medium">Pista</th>
                            <th className="py-2 pr-3 font-medium">Categoria</th>
                            <th className="py-2 pr-3 font-medium">Tipologia</th>
                            <th className="py-2 pr-3 font-medium text-right">Pezzi</th>
                            <th className="py-2 pr-3 font-medium text-right">Canone</th>
                          </tr>
                        </thead>
                        <tbody>
                          {mappedItems.map((it, i) => (
                            <tr key={i} className="border-b last:border-0" data-testid={`row-mapped-${i}`}>
                              <td className="py-1.5 pr-3">{it.pista}</td>
                              <td className="py-1.5 pr-3">{it.categoria}</td>
                              <td className="py-1.5 pr-3">{it.tipologia}</td>
                              <td className="py-1.5 pr-3 text-right">{it.pezzi}</td>
                              <td className="py-1.5 pr-3 text-right">{it.canone ? fmtEuro(it.canone) : '—'}</td>
                            </tr>
                          ))}
                          {mappedItems.length === 0 && (
                            <tr><td colSpan={5} className="py-6 text-center text-muted-foreground">Nessuna vendita canvass categorizzata nel periodo.</td></tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {mapped.unmapped.length > 0 && (
                      <div>
                        <h3 className="text-sm font-medium mb-2 flex items-center gap-2">
                          <AlertTriangle className="h-4 w-4 text-amber-600" />
                          Codici non mappati ({mapped.unmapped.length})
                        </h3>
                        <div className="overflow-x-auto">
                          <table className="w-full text-sm">
                            <thead>
                              <tr className="border-b text-left text-muted-foreground">
                                <th className="py-2 pr-3 font-medium">Codice</th>
                                <th className="py-2 pr-3 font-medium">Categoria</th>
                                <th className="py-2 pr-3 font-medium">Tipologia</th>
                                <th className="py-2 pr-3 font-medium">Descrizione</th>
                                <th className="py-2 pr-3 font-medium text-right">Pezzi</th>
                              </tr>
                            </thead>
                            <tbody>
                              {mapped.unmapped.map((u, i) => (
                                <tr key={i} className="border-b last:border-0" data-testid={`row-unmapped-${i}`}>
                                  <td className="py-1.5 pr-3 font-mono text-xs">{u.codice}</td>
                                  <td className="py-1.5 pr-3">{u.categoria || '—'}</td>
                                  <td className="py-1.5 pr-3">{u.tipologia || '—'}</td>
                                  <td className="py-1.5 pr-3">{u.descrizione || '—'}</td>
                                  <td className="py-1.5 pr-3 text-right">{u.pezzi}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      </div>
                    )}
                  </>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

function StatCard({ label, value, testid }: { label: string; value: number; testid: string }) {
  return (
    <div className="rounded-lg border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-xl font-semibold" data-testid={testid}>{value}</div>
    </div>
  );
}
