import { Card, CardContent } from "@/components/ui/card";
import { 
  Smartphone, 
  Monitor, 
  Gift, 
  Zap, 
  Shield, 
  Lock, 
  Receipt,
  TrendingUp
} from "lucide-react";
import { formatCurrency } from "@/utils/format";
import { cn } from "@/lib/utils";

interface WizardSummaryCardProps {
  premioMobile: number;
  premioFisso: number;
  premioPartnership: number;
  premioEnergia: number;
  premioAssicurazioni: number;
  premioProtecta: number;
  premioExtraGaraIva: number;
  currentStep?: number;
  tipologiaGara?: string;
}

const STEP_TO_CATEGORY_DEFAULT: Record<number, string> = {
  6: 'mobile',
  7: 'fisso',
  8: 'partnership',
  9: 'energia',
  10: 'assicurazioni',
  11: 'protecta',
  12: 'extra',
};

const STEP_TO_CATEGORY_RS: Record<number, string> = {
  7: 'mobile',
  8: 'fisso',
  9: 'partnership',
  10: 'energia',
  11: 'assicurazioni',
  12: 'protecta',
  13: 'extra',
};

const CATEGORY_CONFIG = [
  { key: 'mobile', label: 'Mobile', icon: Smartphone, color: 'bg-blue-500', activeColor: 'ring-blue-500' },
  { key: 'fisso', label: 'Fisso', icon: Monitor, color: 'bg-indigo-500', activeColor: 'ring-indigo-500' },
  { key: 'partnership', label: 'CB+', icon: Gift, color: 'bg-purple-500', activeColor: 'ring-purple-500' },
  { key: 'energia', label: 'Energia', icon: Zap, color: 'bg-yellow-500', activeColor: 'ring-yellow-500' },
  { key: 'assicurazioni', label: 'Assic.', icon: Shield, color: 'bg-green-500', activeColor: 'ring-green-500' },
  { key: 'protecta', label: 'Protecta', icon: Lock, color: 'bg-teal-500', activeColor: 'ring-teal-500' },
  { key: 'extra', label: 'Extra IVA', icon: Receipt, color: 'bg-orange-500', activeColor: 'ring-orange-500' },
];

export function WizardSummaryCard({
  premioMobile,
  premioFisso,
  premioPartnership,
  premioEnergia,
  premioAssicurazioni,
  premioProtecta,
  premioExtraGaraIva,
  currentStep,
  tipologiaGara,
}: WizardSummaryCardProps) {
  const totale = premioMobile + premioFisso + premioPartnership + premioEnergia + 
                 premioAssicurazioni + premioProtecta + premioExtraGaraIva;

  const premi = [
    premioMobile,
    premioFisso,
    premioPartnership,
    premioEnergia,
    premioAssicurazioni,
    premioProtecta,
    premioExtraGaraIva,
  ];

  const stepMap = tipologiaGara === "gara_operatore_rs" ? STEP_TO_CATEGORY_RS : STEP_TO_CATEGORY_DEFAULT;
  const activeCategory = currentStep !== undefined ? stepMap[currentStep] : undefined;

  // Calcola percentuali per mini bar
  const maxPremio = Math.max(...premi, 1);

  return (
    <Card className="border-primary/20 bg-gradient-to-br from-primary/5 via-background to-accent/5">
      <CardContent className="p-4">
        {/* Header con totale */}
        <div className="flex items-center gap-3 mb-4">
          <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center shadow-sm">
            <TrendingUp className="w-5 h-5 text-primary-foreground" />
          </div>
          <div>
            <p className="text-xs text-muted-foreground font-medium uppercase tracking-wide">Premio Totale</p>
            <p className="text-2xl font-bold text-primary">{formatCurrency(totale)}</p>
          </div>
        </div>

        {/* Mini bars per categoria */}
        <div className="space-y-2">
          {CATEGORY_CONFIG.map((cat, index) => {
            const premio = premi[index];
            const percentage = maxPremio > 0 ? (premio / maxPremio) * 100 : 0;
            const Icon = cat.icon;
            const isActive = activeCategory === cat.key;
            
            return (
              <div 
                key={cat.key} 
                className={cn(
                  "flex items-center gap-2 p-1.5 rounded-lg transition-all duration-300",
                  isActive && "bg-primary/10 ring-2 ring-primary/30 scale-[1.02]"
                )}
              >
                <div className={cn(
                  "w-6 h-6 rounded flex items-center justify-center text-white shrink-0",
                  cat.color,
                  isActive && "ring-2 ring-offset-1 ring-offset-background " + cat.activeColor
                )}>
                  <Icon className="w-3.5 h-3.5" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className={cn(
                      "text-xs truncate",
                      isActive ? "text-foreground font-medium" : "text-muted-foreground"
                    )}>
                      {cat.label}
                    </span>
                    <span className={cn(
                      "text-xs font-medium",
                      isActive && "text-primary font-semibold"
                    )}>
                      {formatCurrency(premio)}
                    </span>
                  </div>
                  <div className="h-1.5 bg-muted rounded-full overflow-hidden">
                    <div 
                      className={cn(
                        "h-full transition-all duration-500 rounded-full",
                        cat.color,
                        isActive && "animate-pulse"
                      )}
                      style={{ width: `${percentage}%` }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
