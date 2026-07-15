// Modulo Gestione DTS (Task #321): upload dell'Excel dei lead drive-to-store
// e dashboard di incidenza sulle vendite BiSuite. Il parsing dell'Excel
// avviene nel browser (come Canvass VF): al server arrivano solo i lead già
// normalizzati. Il report incrocia ID VENDITA ↔ codice esterno della vendita
// (rawData.codiceEsterno, Task #324) con filtri mese (colonna DATA),
// consulente e negozio.
import { useMemo, useRef, useState } from 'react';
import * as XLSX from 'xlsx';
import { useAuth } from '@/hooks/useAuth';
import { useToast } from '@/hooks/use-toast';
import { useQuery, useMutation } from '@tanstack/react-query';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
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
import { AppNavbar } from '@/components/AppNavbar';
import { DataTableSkeleton } from '@/components/skeletons';
import {
  Upload,
  Loader2,
  Trash2,
  Store,
  Users,
  Target,
  Percent,
  CalendarClock,
  FileSpreadsheet,
} from 'lucide-react';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from 'recharts';
import { getPistaCanvassLabels, type PistaCanvass } from '@shared/bisuiteClassification';
import {
  aggregateDtsReport,
  dtsAvailableMonths,
  dtsMonthLabel,
  filterDtsLeads,
  parseDtsRows,
  validateDtsHeaders,
  type DtsLead,
  type DtsSaleRow,
} from '@shared/dtsReport';

// Riga lead come restituita da GET /api/dts/leads (subset campi DB).
interface DtsLeadApiRow extends DtsLead {
  fileName: string | null;
  uploadedAt: string | null;
}

function fmtPct(pct: number | null): string {
  return pct === null ? '—' : `${pct.toLocaleString('it-IT')}%`;
}

/** Primo e ultimo giorno del mese YYYY-MM in YMD. */
function monthRange(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, '0')}` };
}

const ALL = '__all__';

export default function GestioneDts() {
  const { profile } = useAuth();
  const { toast } = useToast();
  const isAdmin = ['super_admin', 'admin'].includes(profile?.role || '');
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);
  const [selMonth, setSelMonth] = useState<string>('');
  const [selConsulente, setSelConsulente] = useState<string>(ALL);
  const [selNegozio, setSelNegozio] = useState<string>(ALL);
  const pistaLabels = getPistaCanvassLabels(false);

  const { data: leadRows, isLoading: loadingLeads } = useQuery<DtsLeadApiRow[]>({
    queryKey: ['/api/dts/leads'],
    enabled: !!profile,
  });

  const leads = leadRows ?? [];
  const months = useMemo(() => dtsAvailableMonths(leads), [leads]);
  const month = selMonth || months[0] || '';

  const { from, to } = useMemo(
    () => (month ? monthRange(month) : { from: '', to: '' }),
    [month],
  );

  const { data: sales, isLoading: loadingSales } = useQuery<DtsSaleRow[]>({
    queryKey: ['/api/dts/sales', from, to],
    enabled: !!profile && !!from && !!to,
  });

  const consulenti = useMemo(() => {
    const set = new Set<string>();
    for (const l of filterDtsLeads(leads, { month })) {
      const c = l.consulente.trim();
      if (c) set.add(c);
    }
    return Array.from(set).sort((a, b) => a.localeCompare(b, 'it'));
  }, [leads, month]);

  const negozi = useMemo(() => {
    const map = new Map<string, string>();
    for (const s of sales ?? []) {
      const pos = (s.codicePos ?? '').trim();
      if (pos && !map.has(pos)) map.set(pos, (s.nomeNegozio ?? '').trim());
    }
    return Array.from(map.entries())
      .map(([codicePos, nome]) => ({ codicePos, nome }))
      .sort((a, b) => (a.nome || a.codicePos).localeCompare(b.nome || b.codicePos, 'it'));
  }, [sales]);

  const report = useMemo(() => {
    if (!month || !sales) return null;
    const filtered = filterDtsLeads(leads, {
      month,
      consulente: selConsulente === ALL ? null : selConsulente,
    });
    return aggregateDtsReport(filtered, sales, {
      codicePos: selNegozio === ALL ? null : selNegozio,
    });
  }, [leads, sales, month, selConsulente, selNegozio]);

  const pistaChartData = useMemo(() => {
    if (!report) return [];
    return (Object.entries(report.perPista) as Array<[PistaCanvass, { dts: number; totale: number; incidenzaPct: number | null }]>)
      .filter(([, v]) => v.totale > 0)
      .map(([p, v]) => ({
        pista: pistaLabels[p] ?? p,
        DTS: v.dts,
        Altre: v.totale - v.dts,
      }));
  }, [report, pistaLabels]);

  const uploadMutation = useMutation({
    mutationFn: async (payload: { fileName: string; leads: DtsLead[] }) => {
      const res = await apiRequest('POST', '/api/dts/upload', payload);
      return res.json() as Promise<{ ok: boolean; count: number }>;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['/api/dts/leads'] });
      toast({ title: 'Upload completato', description: `${data.count} lead salvati/aggiornati.` });
    },
    onError: (e: Error) => {
      toast({ title: 'Errore upload', description: e.message, variant: 'destructive' });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async () => apiRequest('DELETE', '/api/dts/leads'),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/dts/leads'] });
      setSelMonth('');
      setSelConsulente(ALL);
      toast({ title: 'Lead eliminati', description: 'Tutti i lead DTS sono stati rimossi.' });
    },
    onError: (e: Error) => {
      toast({ title: 'Errore', description: e.message, variant: 'destructive' });
    },
  });

  const handleFile = async (file: File) => {
    setUploading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const sheet = wb.Sheets[wb.SheetNames[0]];
      if (!sheet) throw new Error('Il file non contiene fogli.');
      const matrix = XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, defval: '' }) as unknown[][];
      if (matrix.length < 2) throw new Error('Il file non contiene righe di dati.');
      const headerCheck = validateDtsHeaders(matrix[0]);
      if (!headerCheck.ok) {
        throw new Error(`Colonne mancanti nel file: ${headerCheck.missing.join(', ')}`);
      }
      const { leads: parsed, skipped } = parseDtsRows(matrix);
      if (parsed.length === 0) throw new Error('Nessun lead valido trovato nel file.');
      await uploadMutation.mutateAsync({ fileName: file.name, leads: parsed });
      if (skipped > 0) {
        toast({ title: 'Righe scartate', description: `${skipped} righe senza dati identificativi sono state ignorate.` });
      }
    } catch (e) {
      toast({
        title: 'File non valido',
        description: e instanceof Error ? e.message : 'Errore nella lettura del file.',
        variant: 'destructive',
      });
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const kpis = report
    ? [
        { label: 'DTS fissati', value: String(report.totaleLead), icon: CalendarClock, testid: 'kpi-dts-fissati' },
        { label: 'Convertiti', value: String(report.leadConvertiti), icon: Target, testid: 'kpi-dts-convertiti' },
        { label: 'Conversione', value: fmtPct(report.conversionePct), icon: Percent, testid: 'kpi-dts-conversione' },
        {
          label: 'Incidenza vendite',
          value: `${fmtPct(report.vendite.incidenzaPct)}`,
          sub: `${report.vendite.dts} su ${report.vendite.totale}`,
          icon: Store,
          testid: 'kpi-dts-incidenza',
        },
      ]
    : [];

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Gestione DTS" />
      <main className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold" data-testid="text-dts-title">Gestione DTS</h1>
            <p className="text-sm text-muted-foreground">
              Lead drive-to-store e incidenza sulle vendite BiSuite
            </p>
          </div>
          {isAdmin && (
            <div className="flex items-center gap-2">
              <input
                ref={fileInputRef}
                type="file"
                accept=".xlsx,.xls"
                className="hidden"
                data-testid="input-dts-file"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) void handleFile(f);
                }}
              />
              <Button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploading}
                data-testid="button-dts-upload"
              >
                {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                Carica Excel
              </Button>
              {leads.length > 0 && (
                <AlertDialog>
                  <AlertDialogTrigger asChild>
                    <Button variant="outline" size="icon" data-testid="button-dts-delete">
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </AlertDialogTrigger>
                  <AlertDialogContent>
                    <AlertDialogHeader>
                      <AlertDialogTitle>Eliminare tutti i lead DTS?</AlertDialogTitle>
                      <AlertDialogDescription>
                        Verranno rimossi tutti i {leads.length} lead caricati per l'organizzazione.
                        L'operazione non è reversibile: dovrai ricaricare il file Excel.
                      </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                      <AlertDialogCancel>Annulla</AlertDialogCancel>
                      <AlertDialogAction
                        onClick={() => deleteMutation.mutate()}
                        data-testid="button-dts-delete-confirm"
                      >
                        Elimina tutto
                      </AlertDialogAction>
                    </AlertDialogFooter>
                  </AlertDialogContent>
                </AlertDialog>
              )}
            </div>
          )}
        </div>

        {loadingLeads ? (
          <DataTableSkeleton />
        ) : leads.length === 0 ? (
          <Card>
            <CardContent className="py-12 text-center space-y-3">
              <FileSpreadsheet className="h-10 w-10 mx-auto text-muted-foreground" />
              <p className="font-medium" data-testid="text-dts-empty">Nessun lead DTS caricato</p>
              <p className="text-sm text-muted-foreground max-w-md mx-auto">
                {isAdmin
                  ? 'Carica il file Excel dei lead drive-to-store (colonne Source.Name, CAMPAGNA, NOMINATIVO, DATA, ID VENDITA, …) per vedere il report di incidenza.'
                  : "Non ci sono ancora lead caricati: chiedi a un amministratore di caricare l'export Excel."}
              </p>
            </CardContent>
          </Card>
        ) : (
          <>
            <div className="flex flex-wrap items-center gap-3">
              <Select value={month} onValueChange={(v) => setSelMonth(v)}>
                <SelectTrigger className="w-[200px]" data-testid="select-dts-month">
                  <SelectValue placeholder="Mese" />
                </SelectTrigger>
                <SelectContent>
                  {months.map((m) => (
                    <SelectItem key={m} value={m}>{dtsMonthLabel(m)}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selConsulente} onValueChange={setSelConsulente}>
                <SelectTrigger className="w-[220px]" data-testid="select-dts-consulente">
                  <SelectValue placeholder="Consulente" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tutti i consulenti</SelectItem>
                  {consulenti.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Select value={selNegozio} onValueChange={setSelNegozio}>
                <SelectTrigger className="w-[220px]" data-testid="select-dts-negozio">
                  <SelectValue placeholder="Negozio" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={ALL}>Tutti i negozi</SelectItem>
                  {negozi.map((n) => (
                    <SelectItem key={n.codicePos} value={n.codicePos}>
                      {n.nome || n.codicePos}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Badge variant="secondary" data-testid="badge-dts-lead-count">
                {leads.length} lead totali
              </Badge>
            </div>

            {loadingSales || !report ? (
              <DataTableSkeleton />
            ) : (
              <>
                <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
                  {kpis.map((k) => (
                    <Card key={k.label}>
                      <CardContent className="pt-5">
                        <div className="flex items-center justify-between">
                          <p className="text-xs uppercase tracking-wide text-muted-foreground">{k.label}</p>
                          <k.icon className="h-4 w-4 text-muted-foreground" />
                        </div>
                        <p className="text-2xl font-bold mt-1" data-testid={k.testid}>{k.value}</p>
                        {k.sub && <p className="text-xs text-muted-foreground">{k.sub}</p>}
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {pistaChartData.length > 0 && (
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Incidenza per pista</CardTitle>
                      <CardDescription>Pezzi da vendite DTS vs resto, per pista canvass</CardDescription>
                    </CardHeader>
                    <CardContent className="h-64">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={pistaChartData}>
                          <CartesianGrid strokeDasharray="3 3" className="opacity-30" />
                          <XAxis dataKey="pista" fontSize={12} />
                          <YAxis allowDecimals={false} fontSize={12} />
                          <Tooltip />
                          <Bar dataKey="DTS" stackId="a" fill="#4ade80" radius={[0, 0, 0, 0]} />
                          <Bar dataKey="Altre" stackId="a" fill="#94a3b8" radius={[4, 4, 0, 0]} />
                        </BarChart>
                      </ResponsiveContainer>
                    </CardContent>
                  </Card>
                )}

                <div className="grid lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Users className="h-4 w-4" /> Per consulente
                      </CardTitle>
                      <CardDescription>DTS fissati, convertiti e tasso di conversione</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {report.perConsulente.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nessun lead nel periodo.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                              <th className="py-2">Consulente</th>
                              <th className="py-2 text-right">Fissati</th>
                              <th className="py-2 text-right">Convertiti</th>
                              <th className="py-2 text-right">Tasso</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.perConsulente.map((c) => (
                              <tr key={c.consulente} className="border-b last:border-0" data-testid={`row-dts-consulente-${c.consulente}`}>
                                <td className="py-2 font-medium">{c.consulente}</td>
                                <td className="py-2 text-right">{c.fissati}</td>
                                <td className="py-2 text-right">{c.convertiti}</td>
                                <td className="py-2 text-right">{fmtPct(c.tassoPct)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base flex items-center gap-2">
                        <Store className="h-4 w-4" /> Per negozio
                      </CardTitle>
                      <CardDescription>Vendite da DTS sul totale del negozio</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {report.perNegozio.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nessuna vendita nel periodo.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <thead>
                            <tr className="text-left text-xs uppercase text-muted-foreground border-b">
                              <th className="py-2">Negozio</th>
                              <th className="py-2 text-right">DTS</th>
                              <th className="py-2 text-right">Totali</th>
                              <th className="py-2 text-right">Incidenza</th>
                            </tr>
                          </thead>
                          <tbody>
                            {report.perNegozio.map((n) => (
                              <tr key={n.codicePos} className="border-b last:border-0" data-testid={`row-dts-negozio-${n.codicePos}`}>
                                <td className="py-2 font-medium">{n.nomeNegozio || n.codicePos}</td>
                                <td className="py-2 text-right">{n.vendite.dts}</td>
                                <td className="py-2 text-right">{n.vendite.totale}</td>
                                <td className="py-2 text-right">{fmtPct(n.vendite.incidenzaPct)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </CardContent>
                  </Card>
                </div>

                <div className="grid lg:grid-cols-2 gap-6">
                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Per categoria canvass</CardTitle>
                      <CardDescription>Pezzi canvass da vendite DTS sul totale</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {report.perCategoriaCanvass.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nessun pezzo canvass nel periodo.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <tbody>
                            {report.perCategoriaCanvass.map((c) => (
                              <tr key={c.nome} className="border-b last:border-0" data-testid={`row-dts-cat-${c.nome}`}>
                                <td className="py-2">{c.nome}</td>
                                <td className="py-2 text-right text-muted-foreground">{c.dts} / {c.totale}</td>
                                <td className="py-2 text-right font-medium w-20">{fmtPct(c.incidenzaPct)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </CardContent>
                  </Card>

                  <Card>
                    <CardHeader>
                      <CardTitle className="text-base">Per prodotto</CardTitle>
                      <CardDescription>Pezzi prodotto da vendite DTS sul totale</CardDescription>
                    </CardHeader>
                    <CardContent>
                      {report.perProdotto.length === 0 ? (
                        <p className="text-sm text-muted-foreground">Nessun prodotto nel periodo.</p>
                      ) : (
                        <table className="w-full text-sm">
                          <tbody>
                            {report.perProdotto.map((c) => (
                              <tr key={c.nome} className="border-b last:border-0" data-testid={`row-dts-prod-${c.nome}`}>
                                <td className="py-2">{c.nome}</td>
                                <td className="py-2 text-right text-muted-foreground">{c.dts} / {c.totale}</td>
                                <td className="py-2 text-right font-medium w-20">{fmtPct(c.incidenzaPct)}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </CardContent>
                  </Card>
                </div>
              </>
            )}
          </>
        )}
      </main>
    </div>
  );
}
