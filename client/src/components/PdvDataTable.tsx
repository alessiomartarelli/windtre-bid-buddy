import { useMemo } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Badge } from '@/components/ui/badge';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Preventivo } from '@/hooks/usePreventivi';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from 'recharts';

interface PdvRow {
  id: string;
  codice: string;
  nome: string;
  volumiMobile: number;
  volumiFisso: number;
  volumiPartnership: number;
  volumiEnergia: number;
  volumiAssicurazioni: number;
  volumiProtecta: number;
  volumiExtraGara: number;
  puntiMobile: number;
  puntiFisso: number;
  premioMobile: number;
  premioFisso: number;
  premioPartnership: number;
  premioEnergia: number;
  premioAssicurazioni: number;
  premioProtecta: number;
  premioExtraGara: number;
  sogliaMobile: number;
  sogliaFisso: number;
  premioTotale: number;
  volumiTotali: number;
}

interface PdvDataTableProps {
  preventivo: Preventivo;
}

const formatCurrency = (value: number) => {
  if (isNaN(value) || !value) return '€ 0';
  return new Intl.NumberFormat('it-IT', {
    style: 'currency',
    currency: 'EUR',
    maximumFractionDigits: 0,
  }).format(value);
};

const PISTA_COLORS = {
  Mobile: 'hsl(20, 100%, 50%)',
  Fisso: 'hsl(280, 85%, 50%)',
  Partnership: 'hsl(200, 80%, 50%)',
  Energia: 'hsl(145, 65%, 45%)',
  Assicurazioni: 'hsl(45, 100%, 50%)',
  Protecta: 'hsl(330, 70%, 50%)',
  ExtraGara: 'hsl(180, 60%, 45%)',
};

const VOLUME_NAME_MAP: Record<string, string> = {
  volumiMobile: 'Mobile',
  volumiFisso: 'Fisso',
  volumiPartnership: 'Partnership',
  volumiEnergia: 'Energia',
  volumiAssicurazioni: 'Assicurazioni',
  volumiProtecta: 'Protecta',
  volumiExtraGara: 'Extra Gara IVA',
};

const PREMIO_NAME_MAP: Record<string, string> = {
  premioMobile: 'Mobile',
  premioFisso: 'Fisso',
  premioPartnership: 'Partnership',
  premioEnergia: 'Energia',
  premioAssicurazioni: 'Assicurazioni',
  premioProtecta: 'Protecta',
  premioExtraGara: 'Extra Gara IVA',
};

export function PdvDataTable({ preventivo }: PdvDataTableProps) {
  const pdvData = useMemo<PdvRow[]>(() => {
    const data = preventivo.data as Record<string, unknown>;
    const puntiVendita = (data?.puntiVendita as Array<{ id?: string; codicePos?: string; nome?: string }>) || [];

    const risultatoMobile = data?.risultatoMobile as { totale?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoFisso = data?.risultatoFisso as { totale?: number; perPos?: Array<Record<string, unknown>> } | undefined;

    const attivatoMobileByPos = data?.attivatoMobileByPos as Record<string, Array<{ pezzi?: number; type?: string }>> | undefined;
    const attivatoFissoByPos = data?.attivatoFissoByPos as Record<string, Array<{ pezzi?: number; categoria?: string }>> | undefined;
    const attivatoEnergiaByPos = data?.attivatoEnergiaByPos as Record<string, Array<{ pezzi?: number; category?: string }>> | undefined;
    const attivatoAssicurazioniByPos = data?.attivatoAssicurazioniByPos as Record<string, Record<string, number>> | undefined;
    const attivatoProtectaByPos = data?.attivatoProtectaByPos as Record<string, Record<string, number>> | undefined;
    const attivatoCBByPos = data?.attivatoCBByPos as Record<string, Array<{ pezzi?: number }>> | undefined;

    // Risultati calcolati - read totals for fallback
    const risultatoEnergia = data?.risultatoEnergia as { totale?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoAssicurazioni = data?.risultatoAssicurazioni as { totalePremio?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoProtecta = data?.risultatoProtecta as { totalePremio?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoPartnership = data?.risultatoPartnership as { totale?: number; perPos?: Array<Record<string, unknown>> } | undefined;
    const risultatoExtraGara = data?.risultatoExtraGaraIva as { totalePremio?: number; perPos?: Array<Record<string, unknown>>; perRs?: Array<Record<string, unknown>> } | undefined;

    // Build lookup maps
    const mobileByCode: Record<string, Record<string, unknown>> = {};
    const fissoByCode: Record<string, Record<string, unknown>> = {};
    const energiaByCode: Record<string, Record<string, unknown>> = {};
    const assicByCode: Record<string, Record<string, unknown>> = {};
    const protByCode: Record<string, Record<string, unknown>> = {};
    const partByCode: Record<string, Record<string, unknown>> = {};
    const extraByCode: Record<string, Record<string, unknown>> = {};

    const buildMap = (perPos: Array<Record<string, unknown>> | undefined, map: Record<string, Record<string, unknown>>) => {
      perPos?.forEach((pos) => {
        const code = (pos.pdvCodice as string) || (pos.posCode as string) || '';
        if (code) map[code] = pos;
      });
    };

    buildMap(risultatoMobile?.perPos, mobileByCode);
    buildMap(risultatoFisso?.perPos, fissoByCode);
    buildMap(risultatoEnergia?.perPos, energiaByCode);
    buildMap(risultatoAssicurazioni?.perPos, assicByCode);
    buildMap(risultatoProtecta?.perPos, protByCode);
    buildMap(risultatoPartnership?.perPos, partByCode);
    buildMap(risultatoExtraGara?.perPos, extraByCode);

    const isSinglePdv = puntiVendita.length === 1;

    const rows: PdvRow[] = puntiVendita.map((pv) => {
      const code = pv.codicePos || pv.id || '';
      const pdvId = pv.id || code;

      // Mobile - Pezzi = solo SIM Consumer + SIM IVA
      const mobile = mobileByCode[code] || {};
      const mobileRaw = attivatoMobileByPos?.[pdvId] || attivatoMobileByPos?.[code] || [];
      const MOBILE_SIM_TYPES = ['TIED', 'UNTIED', 'TOURIST_FULL', 'TOURIST_PASS', 'TOURIST_XXL',
        'PROFESSIONAL_FLEX', 'PROFESSIONAL_DATA_10', 'PROFESSIONAL_SPECIAL', 'PROFESSIONAL_STAFF', 'PROFESSIONAL_WORLD', 'ALTRE_SIM_IVA'];
      const volumiMobile = mobileRaw
        .filter((r) => MOBILE_SIM_TYPES.includes(r.type || ''))
        .reduce((s, r) => s + (r.pezzi || 0), 0);
      const premioMobile = (mobile.premio as number) || (mobile.premioPrevistoFineMese as number) || (mobile.premioAttuale as number) || 0;
      const puntiMobile = (mobile.punti as number) || (mobile.puntiPrevistiFineMese as number) || (mobile.puntiAttuali as number) || 0;
      const sogliaMobile = (mobile.soglia as number) || (mobile.sogliaPrevista as number) || (mobile.sogliaAttuale as number) || 0;

      // Fisso - Pezzi = solo 4 tecnologie core
      const fisso = fissoByCode[code] || {};
      const fissoRaw = attivatoFissoByPos?.[pdvId] || attivatoFissoByPos?.[code] || [];
      const FISSO_PEZZI_CATEGORIE = ['FISSO_FTTC', 'FISSO_FTTH', 'FISSO_FWA_OUT', 'FISSO_FWA_IND_2P'];
      const volumiFisso = fissoRaw
        .filter((r) => FISSO_PEZZI_CATEGORIE.includes(r.categoria || ''))
        .reduce((s, r) => s + (r.pezzi || 0), 0);
      const premioFisso = (fisso.premio as number) || (fisso.premioPrevistoFineMese as number) || (fisso.premioAttuale as number) || 0;
      const puntiFisso = (fisso.punti as number) || (fisso.puntiPrevistiFineMese as number) || (fisso.puntiAttuali as number) || 0;
      const sogliaFisso = (fisso.soglia as number) || (fisso.sogliaPrevista as number) || (fisso.sogliaAttuale as number) || 0;

      // Partnership (CB)
      const cbRaw = attivatoCBByPos?.[pdvId] || attivatoCBByPos?.[code] || [];
      const volumiPartnership = cbRaw.reduce((s, r) => s + (r.pezzi || 0), 0);
      const partRes = partByCode[code] || {};
      const premioPartnership = (partRes.premio as number) || (partRes.premioTotale as number) || (isSinglePdv ? (risultatoPartnership?.totale || 0) : 0);

      // Energia
      const energiaRaw = attivatoEnergiaByPos?.[pdvId] || attivatoEnergiaByPos?.[code] || [];
      const volumiEnergia = energiaRaw.reduce((s, r) => s + (r.pezzi || 0), 0);
      const energiaRes = energiaByCode[code] || {};
      const premioEnergia = (energiaRes.premio as number) || (energiaRes.premioTotale as number) || (isSinglePdv ? (risultatoEnergia?.totale || 0) : 0);

      // Assicurazioni
      const assicRaw = attivatoAssicurazioniByPos?.[pdvId] || attivatoAssicurazioniByPos?.[code];
      let volumiAssicurazioni = 0;
      if (assicRaw && typeof assicRaw === 'object') {
        Object.entries(assicRaw).forEach(([key, val]) => {
          if (typeof val === 'number' && key !== 'viaggioMondoPremio' && val > 0) volumiAssicurazioni += val;
        });
      }
      const assicRes = assicByCode[code] || {};
      const premioAssicurazioni = (assicRes.premio as number) || (assicRes.premioTotale as number) || (isSinglePdv ? (risultatoAssicurazioni?.totalePremio || 0) : 0);

      // Protecta
      const protRaw = attivatoProtectaByPos?.[pdvId] || attivatoProtectaByPos?.[code];
      let volumiProtecta = 0;
      if (protRaw && typeof protRaw === 'object') {
        Object.entries(protRaw).forEach(([, val]) => {
          if (typeof val === 'number' && val > 0) volumiProtecta += val;
        });
      }
      const protRes = protByCode[code] || {};
      const premioProtecta = (protRes.premio as number) || (protRes.premioTotale as number) || (isSinglePdv ? (risultatoProtecta?.totalePremio || 0) : 0);

      // Extra Gara
      const extraRes = extraByCode[code] || {};
      const premioExtraGara = (extraRes.premio as number) || (extraRes.premioTotale as number) || (isSinglePdv ? (risultatoExtraGara?.totalePremio || 0) : 0);
      const volumiExtraGara = (extraRes.volumi as number) || 0;

      const premioTotale = [premioMobile, premioFisso, premioPartnership, premioEnergia, premioAssicurazioni, premioProtecta, premioExtraGara]
        .reduce((s, v) => s + (isNaN(v) ? 0 : v), 0);
      const volumiTotali = volumiMobile + volumiFisso + volumiPartnership + volumiEnergia + volumiAssicurazioni + volumiProtecta + volumiExtraGara;

      return {
        id: pdvId,
        codice: code,
        nome: pv.nome || code,
        volumiMobile, volumiFisso, volumiPartnership, volumiEnergia, volumiAssicurazioni, volumiProtecta, volumiExtraGara,
        puntiMobile, puntiFisso,
        premioMobile: isNaN(premioMobile) ? 0 : premioMobile,
        premioFisso: isNaN(premioFisso) ? 0 : premioFisso,
        premioPartnership: isNaN(premioPartnership) ? 0 : premioPartnership,
        premioEnergia: isNaN(premioEnergia) ? 0 : premioEnergia,
        premioAssicurazioni: isNaN(premioAssicurazioni) ? 0 : premioAssicurazioni,
        premioProtecta: isNaN(premioProtecta) ? 0 : premioProtecta,
        premioExtraGara: isNaN(premioExtraGara) ? 0 : premioExtraGara,
        sogliaMobile, sogliaFisso,
        premioTotale,
        volumiTotali,
      };
    });

    return rows.sort((a, b) => b.premioTotale - a.premioTotale || b.volumiTotali - a.volumiTotali);
  }, [preventivo]);

  const chartData = useMemo(() => {
    const hasPremi = pdvData.some(row => row.premioTotale > 0);
    const sortedData = [...pdvData].sort((a, b) => {
      if (hasPremi) return b.premioTotale - a.premioTotale;
      return b.volumiTotali - a.volumiTotali;
    });

    return sortedData.map(row => ({
      name: row.codice.length > 10 ? row.codice.substring(0, 10) + '…' : row.codice,
      fullName: row.nome,
      volumiMobile: row.volumiMobile,
      volumiFisso: row.volumiFisso,
      volumiPartnership: row.volumiPartnership,
      volumiEnergia: row.volumiEnergia,
      volumiAssicurazioni: row.volumiAssicurazioni,
      volumiProtecta: row.volumiProtecta,
      volumiExtraGara: row.volumiExtraGara,
      premioMobile: row.premioMobile,
      premioFisso: row.premioFisso,
      premioPartnership: row.premioPartnership,
      premioEnergia: row.premioEnergia,
      premioAssicurazioni: row.premioAssicurazioni,
      premioProtecta: row.premioProtecta,
      premioExtraGara: row.premioExtraGara,
      puntiMobile: Math.round(row.puntiMobile),
      puntiFisso: Math.round(row.puntiFisso),
    }));
  }, [pdvData]);

  const hasPremi = pdvData.some(row => row.premioTotale > 0);
  const dynamicHeight = Math.max(350, chartData.length * 40);

  const tooltipStyle = {
    backgroundColor: 'hsl(var(--card))',
    border: '1px solid hsl(var(--border))',
    borderRadius: '8px',
  };

  const nameFormatter = (label: string, payload?: Array<{ payload: { fullName: string } }>) => {
    if (payload && payload[0]) return payload[0].payload.fullName;
    return label;
  };

  if (pdvData.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Dettaglio per PDV</CardTitle>
          <CardDescription>Nessun dato disponibile</CardDescription>
        </CardHeader>
      </Card>
    );
  }

  return (
    <div className="space-y-6">
      {/* Chart Volumi per PDV - tutte le piste */}
      <Card>
        <CardHeader>
          <CardTitle>Volumi per PDV</CardTitle>
          <CardDescription>Confronto volumi per tutte le piste e tutti i punti vendita</CardDescription>
        </CardHeader>
        <CardContent>
          <ResponsiveContainer width="100%" height={dynamicHeight}>
            <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
              <XAxis dataKey="name" className="text-xs" angle={-45} textAnchor="end" height={80} interval={0} />
              <YAxis className="text-xs" />
              <Tooltip
                contentStyle={tooltipStyle}
                formatter={(value: number, name: string) => [value, VOLUME_NAME_MAP[name] || name]}
                labelFormatter={(label, payload) => nameFormatter(label, payload as never)}
              />
              <Legend formatter={(value: string) => VOLUME_NAME_MAP[value] || value} />
              <Bar dataKey="volumiMobile" name="volumiMobile" fill={PISTA_COLORS.Mobile} radius={[2, 2, 0, 0]} stackId="volumi" />
              <Bar dataKey="volumiFisso" name="volumiFisso" fill={PISTA_COLORS.Fisso} radius={[0, 0, 0, 0]} stackId="volumi" />
              <Bar dataKey="volumiPartnership" name="volumiPartnership" fill={PISTA_COLORS.Partnership} radius={[0, 0, 0, 0]} stackId="volumi" />
              <Bar dataKey="volumiEnergia" name="volumiEnergia" fill={PISTA_COLORS.Energia} radius={[0, 0, 0, 0]} stackId="volumi" />
              <Bar dataKey="volumiAssicurazioni" name="volumiAssicurazioni" fill={PISTA_COLORS.Assicurazioni} radius={[0, 0, 0, 0]} stackId="volumi" />
              <Bar dataKey="volumiProtecta" name="volumiProtecta" fill={PISTA_COLORS.Protecta} radius={[0, 0, 0, 0]} stackId="volumi" />
              <Bar dataKey="volumiExtraGara" name="volumiExtraGara" fill={PISTA_COLORS.ExtraGara} radius={[2, 2, 0, 0]} stackId="volumi" />
            </BarChart>
          </ResponsiveContainer>
        </CardContent>
      </Card>

      {/* Chart Premi per PDV - tutte le piste */}
      {hasPremi && (
        <Card>
          <CardHeader>
            <CardTitle>Premi per PDV</CardTitle>
            <CardDescription>Confronto premi per tutte le piste e tutti i punti vendita</CardDescription>
          </CardHeader>
          <CardContent>
            <ResponsiveContainer width="100%" height={dynamicHeight}>
              <BarChart data={chartData} margin={{ top: 20, right: 30, left: 20, bottom: 60 }}>
                <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                <XAxis dataKey="name" className="text-xs" angle={-45} textAnchor="end" height={80} interval={0} />
                <YAxis className="text-xs" tickFormatter={(value) => `€${Math.round(value / 1000)}k`} />
                <Tooltip
                  contentStyle={tooltipStyle}
                  formatter={(value: number, name: string) => [formatCurrency(value), PREMIO_NAME_MAP[name] || name]}
                  labelFormatter={(label, payload) => nameFormatter(label, payload as never)}
                />
                <Legend formatter={(value: string) => PREMIO_NAME_MAP[value] || value} />
                <Bar dataKey="premioMobile" name="premioMobile" fill={PISTA_COLORS.Mobile} radius={[2, 2, 0, 0]} stackId="premi" />
                <Bar dataKey="premioFisso" name="premioFisso" fill={PISTA_COLORS.Fisso} radius={[0, 0, 0, 0]} stackId="premi" />
                <Bar dataKey="premioPartnership" name="premioPartnership" fill={PISTA_COLORS.Partnership} radius={[0, 0, 0, 0]} stackId="premi" />
                <Bar dataKey="premioEnergia" name="premioEnergia" fill={PISTA_COLORS.Energia} radius={[0, 0, 0, 0]} stackId="premi" />
                <Bar dataKey="premioAssicurazioni" name="premioAssicurazioni" fill={PISTA_COLORS.Assicurazioni} radius={[0, 0, 0, 0]} stackId="premi" />
                <Bar dataKey="premioProtecta" name="premioProtecta" fill={PISTA_COLORS.Protecta} radius={[0, 0, 0, 0]} stackId="premi" />
                <Bar dataKey="premioExtraGara" name="premioExtraGara" fill={PISTA_COLORS.ExtraGara} radius={[2, 2, 0, 0]} stackId="premi" />
              </BarChart>
            </ResponsiveContainer>
          </CardContent>
        </Card>
      )}



      {/* Data Table - tutte le piste */}
      <Card>
        <CardHeader>
          <CardTitle>Tabella Dettaglio PDV</CardTitle>
          <CardDescription>
            Volumi, premi e soglie per ogni punto vendita e pista ({pdvData.length} PDV)
          </CardDescription>
        </CardHeader>
        <CardContent>
          <ScrollArea className="h-[600px]">
            <div className="min-w-[900px]">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="sticky top-0 bg-background z-10" rowSpan={2}>Codice</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10" rowSpan={2}>Nome</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.Mobile }}>Mobile</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.Fisso }}>Fisso</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.Partnership }}>Partner.</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.Energia }}>Energia</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.Assicurazioni }}>Assic.</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.Protecta }}>Protecta</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center" style={{ color: PISTA_COLORS.ExtraGara }}>Extra IVA</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center">Soglia M</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-center">Soglia F</TableHead>
                    <TableHead className="sticky top-0 bg-background z-10 text-right">Premio Tot.</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {pdvData.map((row) => (
                    <TableRow key={row.codice}>
                      <TableCell className="font-mono text-xs">{row.codice}</TableCell>
                      <TableCell className="max-w-[120px] truncate text-xs" title={row.nome}>{row.nome}</TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiMobile}</Badge>
                          {row.premioMobile > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioMobile)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiFisso}</Badge>
                          {row.premioFisso > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioFisso)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiPartnership}</Badge>
                          {row.premioPartnership > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioPartnership)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiEnergia}</Badge>
                          {row.premioEnergia > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioEnergia)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiAssicurazioni}</Badge>
                          {row.premioAssicurazioni > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioAssicurazioni)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiProtecta}</Badge>
                          {row.premioProtecta > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioProtecta)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <div className="text-xs">
                          <Badge variant="outline" className="text-xs">{row.volumiExtraGara}</Badge>
                          {row.premioExtraGara > 0 && <div className="text-muted-foreground mt-0.5">{formatCurrency(row.premioExtraGara)}</div>}
                        </div>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={row.sogliaMobile > 0 ? 'default' : 'secondary'} className="text-xs">
                          S{row.sogliaMobile}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-center">
                        <Badge variant={row.sogliaFisso > 0 ? 'default' : 'secondary'} className="text-xs">
                          S{row.sogliaFisso}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right font-semibold text-primary text-sm">
                        {formatCurrency(row.premioTotale)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </ScrollArea>
        </CardContent>
      </Card>
    </div>
  );
}
