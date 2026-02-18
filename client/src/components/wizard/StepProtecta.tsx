import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { PuntoVendita } from '@/types/preventivatore';
import {
  ProtectaAttivatoRiga,
  ProtectaResult,
  ProtectaProduct,
  PROTECTA_GETTONI,
  PROTECTA_LABELS,
  PROTECTA_PRODUCTS_CASA,
  PROTECTA_PRODUCTS_NEGOZIO,
  createEmptyProtectaAttivato,
} from '@/types/protecta';
import { formatCurrency } from '@/utils/format';
import { Lock, Home, Store, Zap, Clock } from 'lucide-react';
import { StepContentHeader } from './StepContentHeader';
import { CalendarioMeseOverride, getWorkdayInfoFromOverrides } from '@/utils/calendario';

interface StepProtectaProps {
  puntiVendita: PuntoVendita[];
  attivatoByPos: Record<string, ProtectaAttivatoRiga>;
  setAttivatoByPos: React.Dispatch<React.SetStateAction<Record<string, ProtectaAttivatoRiga>>>;
  results: ProtectaResult[];
  totalePremio: number;
  anno?: number;
  monthIndex?: number;
  calendarioOverrides?: Record<string, CalendarioMeseOverride>;
}

const StepProtecta: React.FC<StepProtectaProps> = ({
  puntiVendita,
  attivatoByPos,
  setAttivatoByPos,
  results,
  totalePremio,
  anno,
  monthIndex,
  calendarioOverrides,
}) => {
  const handleChange = (posCode: string, field: ProtectaProduct, value: number) => {
    setAttivatoByPos(prev => ({
      ...prev,
      [posCode]: {
        ...(prev[posCode] || createEmptyProtectaAttivato()),
        [field]: Math.max(0, value),
      },
    }));
  };

  const getResultForPos = (posCode: string): ProtectaResult | undefined => {
    return results.find(r => r.pdvId === posCode);
  };

  return (
    <div className="space-y-6">
      <StepContentHeader
        icon={Lock}
        title="Protecta - Sistemi di Allarme"
        subtitle="Inserisci il numero di pezzi venduti per ogni tipologia di allarme"
        totalPremio={totalePremio}
      />

      <div className="grid gap-4">
        {puntiVendita.map((pdv) => {
          const attivato = attivatoByPos[pdv.codicePos] || createEmptyProtectaAttivato();
          const result = getResultForPos(pdv.codicePos);
          const wi = (anno !== undefined && monthIndex !== undefined)
            ? getWorkdayInfoFromOverrides(anno, monthIndex, pdv.calendar, calendarioOverrides?.[pdv.id])
            : null;
          const totalWorkingDays = wi?.totalWorkingDays || 0;
          const totalPezziPDV = (Object.keys(PROTECTA_GETTONI) as ProtectaProduct[]).reduce((s, k) => s + attivato[k], 0);
          const runRatePezzi = totalWorkingDays > 0 ? totalPezziPDV / totalWorkingDays : 0;

          return (
            <Card key={pdv.codicePos}>
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="text-base font-medium">
                    {pdv.codicePos} - {pdv.nome || 'PDV'}
                  </CardTitle>
                  <Badge variant="secondary" className="text-base font-semibold">
                    {formatCurrency(result?.premioTotale || 0)}
                  </Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                {/* Sezione Casa */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Home className="h-4 w-4" />
                    <span>Allarmi Casa</span>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                    {PROTECTA_PRODUCTS_CASA.map((product) => (
                      <div key={product} className="space-y-1">
                        <Label htmlFor={`${pdv.codicePos}-${product}`} className="text-xs">
                          {PROTECTA_LABELS[product]}
                          <span className="text-muted-foreground ml-1">
                            ({formatCurrency(PROTECTA_GETTONI[product])})
                          </span>
                        </Label>
                        <Input
                          id={`${pdv.codicePos}-${product}`}
                          type="number"
                          min={0}
                          value={attivato[product] || ''}
                          onChange={(e) =>
                            handleChange(pdv.codicePos, product, parseInt(e.target.value) || 0)
                          }
                          placeholder="0"
                          className="h-9"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Sezione Negozio */}
                <div className="space-y-3">
                  <div className="flex items-center gap-2 text-sm font-medium text-muted-foreground">
                    <Store className="h-4 w-4" />
                    <span>Allarmi Negozio</span>
                    <Badge variant="outline" className="ml-2 text-xs">
                      <Zap className="h-3 w-3 mr-1" />
                      Extra Gara P.IVA 5pt
                    </Badge>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    {PROTECTA_PRODUCTS_NEGOZIO.map((product) => (
                      <div key={product} className="space-y-1">
                        <Label htmlFor={`${pdv.codicePos}-${product}`} className="text-xs">
                          {PROTECTA_LABELS[product]}
                          <span className="text-muted-foreground ml-1">
                            ({formatCurrency(PROTECTA_GETTONI[product])})
                          </span>
                        </Label>
                        <Input
                          id={`${pdv.codicePos}-${product}`}
                          type="number"
                          min={0}
                          value={attivato[product] || ''}
                          onChange={(e) =>
                            handleChange(pdv.codicePos, product, parseInt(e.target.value) || 0)
                          }
                          placeholder="0"
                          className="h-9"
                        />
                      </div>
                    ))}
                  </div>
                </div>

                {/* Dettaglio prodotti attivati */}
                {totalWorkingDays > 0 && (
                  <div className="p-2 bg-secondary/10 rounded-lg border border-secondary/30 mt-2" data-testid={`run-rate-protecta-pdv-${pdv.id}`}>
                    <div className="flex items-center gap-2 mb-1">
                      <Clock className="w-3 h-3 text-secondary-foreground" />
                      <span className="font-medium text-xs text-secondary-foreground">Run Rate</span>
                    </div>
                    <span className="text-xs text-muted-foreground">Pezzi/gg: <span className="font-medium text-foreground">{runRatePezzi.toFixed(2)}</span> · Giorni: {totalWorkingDays}</span>
                  </div>
                )}

                {result && result.dettaglioProdotti.length > 0 && (
                  <div className="pt-2 border-t">
                    <p className="text-xs text-muted-foreground">
                      {result.dettaglioProdotti
                        .map((d) => `${d.prodotto}: ${d.pezzi}pz × ${formatCurrency(d.gettone)} = ${formatCurrency(d.premio)}`)
                        .join(' | ')}
                    </p>
                  </div>
                )}
              </CardContent>
            </Card>
          );
        })}
      </div>

      {/* Totale */}
      <Card className="bg-primary/5 border-primary/20">
        <CardContent className="py-4">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Lock className="h-5 w-5 text-primary" />
              <span className="font-medium">Totale Premio Protecta</span>
            </div>
            <span className="text-2xl font-bold text-primary">
              {formatCurrency(totalePremio)}
            </span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
};

export default StepProtecta;
