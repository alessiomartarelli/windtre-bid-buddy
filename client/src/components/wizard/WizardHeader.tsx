import { Badge } from "@/components/ui/badge";
import { 
  FileText, 
  Store, 
  Layers, 
  Calendar, 
  CalendarDays, 
  Settings, 
  Smartphone, 
  Monitor, 
  Gift, 
  Zap, 
  Shield, 
  Lock, 
  Receipt,
  CheckCircle2,
  ListChecks
} from "lucide-react";
import { cn } from "@/lib/utils";

interface WizardHeaderProps {
  currentStep: number;
  totalSteps: number;
  nomeGara?: string;
  preventivoName?: string;
  currentPreventivoId?: string | null;
  onStepClick?: (step: number) => void;
  isGaraOperatoreRS?: boolean;
  disabledStepsAfter?: number; // Steps after this index will be disabled
}

// Configuration steps count (0-5)
const CONFIG_STEPS_COUNT = 6;

// Step configurations for standard mode (13 steps)
const STEP_CONFIG_STANDARD = [
  { icon: FileText, label: "Lettera Gara", shortLabel: "Gara", group: "config" },
  { icon: Store, label: "Punti Vendita", shortLabel: "PDV", group: "config" },
  { icon: Layers, label: "Cluster", shortLabel: "Cluster", group: "config" },
  { icon: Calendar, label: "Calendari", shortLabel: "Calendari", group: "config" },
  { icon: CalendarDays, label: "Calendario Mese", shortLabel: "Mese", group: "config" },
  { icon: Settings, label: "Config Piste", shortLabel: "Config", group: "config" },
  { icon: Smartphone, label: "Mobile", shortLabel: "Mobile", group: "kpi" },
  { icon: Monitor, label: "Fisso", shortLabel: "Fisso", group: "kpi" },
  { icon: Gift, label: "Partnership", shortLabel: "CB+", group: "kpi" },
  { icon: Zap, label: "Energia", shortLabel: "Energia", group: "kpi" },
  { icon: Shield, label: "Assicurazioni", shortLabel: "Assic.", group: "kpi" },
  { icon: Lock, label: "Protecta", shortLabel: "Protecta", group: "kpi" },
  { icon: Receipt, label: "Extra IVA", shortLabel: "Extra IVA", group: "kpi" },
] as const;

// Step configurations for Gara Operatore RS mode (14 steps - includes step 6 for modality selection)
const STEP_CONFIG_RS = [
  { icon: FileText, label: "Lettera Gara", shortLabel: "Gara", group: "config" },
  { icon: Store, label: "Punti Vendita", shortLabel: "PDV", group: "config" },
  { icon: Layers, label: "Cluster", shortLabel: "Cluster", group: "config" },
  { icon: Calendar, label: "Calendari", shortLabel: "Calendari", group: "config" },
  { icon: CalendarDays, label: "Calendario Mese", shortLabel: "Mese", group: "config" },
  { icon: Settings, label: "Config Piste", shortLabel: "Config", group: "config" },
  { icon: ListChecks, label: "Modalità", shortLabel: "Modalità", group: "kpi" }, // Step 6 - Scelta modalità
  { icon: Smartphone, label: "Mobile", shortLabel: "Mobile", group: "kpi" },
  { icon: Monitor, label: "Fisso", shortLabel: "Fisso", group: "kpi" },
  { icon: Gift, label: "Partnership", shortLabel: "CB+", group: "kpi" },
  { icon: Zap, label: "Energia", shortLabel: "Energia", group: "kpi" },
  { icon: Shield, label: "Assicurazioni", shortLabel: "Assic.", group: "kpi" },
  { icon: Lock, label: "Protecta", shortLabel: "Protecta", group: "kpi" },
  { icon: Receipt, label: "Extra IVA", shortLabel: "Extra IVA", group: "kpi" },
] as const;

export function WizardHeader({ 
  currentStep, 
  totalSteps, 
  nomeGara,
  preventivoName,
  currentPreventivoId,
  onStepClick,
  isGaraOperatoreRS = false,
  disabledStepsAfter
}: WizardHeaderProps) {
  // Choose step config based on mode
  const STEP_CONFIG = isGaraOperatoreRS ? STEP_CONFIG_RS : STEP_CONFIG_STANDARD;
  const kpiStepsCount = STEP_CONFIG.length - CONFIG_STEPS_COUNT;
  
  const currentConfig = STEP_CONFIG[currentStep];
  const CurrentIcon = currentConfig?.icon || FileText;

  return (
    <div className="space-y-4">
      {/* Step Header */}
      <div className="flex items-center gap-3">
        <div className="flex items-center justify-center w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-gradient-to-br from-primary/20 to-primary/5 border border-primary/20 shrink-0">
          <CurrentIcon className="w-5 h-5 sm:w-6 sm:h-6 text-primary" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 flex-wrap">
            <h2 className="text-lg sm:text-xl font-semibold text-foreground truncate">
              {currentConfig?.label || `Step ${currentStep + 1}`}
            </h2>
            <Badge variant="outline" className="text-xs font-normal shrink-0">
              {currentStep + 1}/{totalSteps}
            </Badge>
          </div>
          <p className="text-sm text-muted-foreground truncate">
            {nomeGara || "Nuova simulazione"}
            {currentPreventivoId && preventivoName && (
              <span className="ml-2 text-primary font-medium">• {preventivoName}</span>
            )}
          </p>
        </div>
      </div>

      {/* Step indicators (clickable) - with visual separation between config and KPI */}
      <div className="w-full">
        <div className="flex items-center gap-1">
          {/* Config steps group */}
          <div 
            className="grid gap-1 flex-1"
            style={{ gridTemplateColumns: `repeat(${CONFIG_STEPS_COUNT}, minmax(0, 1fr))` }}
          >
          {STEP_CONFIG.slice(0, CONFIG_STEPS_COUNT).map((step, index) => {
              const StepIcon = step.icon;
              const isCompleted = index < currentStep;
              const isCurrent = index === currentStep;
              const isDisabled = disabledStepsAfter !== undefined && index > disabledStepsAfter;
              
              return (
                <button
                  key={index}
                  onClick={() => !isDisabled && onStepClick?.(index)}
                  disabled={!onStepClick || isDisabled}
                  className={cn(
                    "flex flex-col items-center transition-all duration-200 group",
                    onStepClick && !isDisabled && "cursor-pointer hover:scale-105",
                    isDisabled && "opacity-50 cursor-not-allowed"
                  )}
                  title={isDisabled ? "Seleziona prima la modalità di inserimento" : step.label}
                >
                  <div 
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200",
                      isCompleted && "bg-blue-500 text-white shadow-sm",
                      isCurrent && "bg-blue-500/20 text-blue-600 ring-2 ring-blue-500 ring-offset-1 ring-offset-background",
                      !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                      onStepClick && !isCurrent && !isDisabled && "group-hover:bg-blue-500/10 group-hover:text-blue-600"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <StepIcon className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span 
                    className={cn(
                      "text-[9px] mt-1 font-medium text-center truncate w-full leading-tight",
                      isCurrent && "text-blue-600",
                      isCompleted && "text-foreground",
                      !isCompleted && !isCurrent && "text-muted-foreground"
                    )}
                  >
                    {step.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>

          {/* Vertical separator */}
          <div className="flex items-center justify-center px-0.5 sm:px-1">
            <div className="w-px h-5 sm:h-6 bg-border/60 rounded-full" />
          </div>

          {/* KPI steps group */}
          <div 
            className="grid gap-1 flex-1"
            style={{ gridTemplateColumns: `repeat(${kpiStepsCount}, minmax(0, 1fr))` }}
          >
          {STEP_CONFIG.slice(CONFIG_STEPS_COUNT).map((step, sliceIndex) => {
              const index = sliceIndex + CONFIG_STEPS_COUNT;
              const StepIcon = step.icon;
              const isCompleted = index < currentStep;
              const isCurrent = index === currentStep;
              const isDisabled = disabledStepsAfter !== undefined && index > disabledStepsAfter;
              
              return (
                <button
                  key={index}
                  onClick={() => !isDisabled && onStepClick?.(index)}
                  disabled={!onStepClick || isDisabled}
                  className={cn(
                    "flex flex-col items-center transition-all duration-200 group",
                    onStepClick && !isDisabled && "cursor-pointer hover:scale-105",
                    isDisabled && "opacity-50 cursor-not-allowed"
                  )}
                  title={isDisabled ? "Seleziona prima la modalità di inserimento" : step.label}
                >
                  <div 
                    className={cn(
                      "w-7 h-7 rounded-full flex items-center justify-center transition-all duration-200",
                      isCompleted && "bg-emerald-500 text-white shadow-sm",
                      isCurrent && "bg-emerald-500/20 text-emerald-600 ring-2 ring-emerald-500 ring-offset-1 ring-offset-background",
                      !isCompleted && !isCurrent && "bg-muted text-muted-foreground",
                      onStepClick && !isCurrent && !isDisabled && "group-hover:bg-emerald-500/10 group-hover:text-emerald-600"
                    )}
                  >
                    {isCompleted ? (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    ) : (
                      <StepIcon className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <span 
                    className={cn(
                      "text-[9px] mt-1 font-medium text-center truncate w-full leading-tight",
                      isCurrent && "text-emerald-600",
                      isCompleted && "text-foreground",
                      !isCompleted && !isCurrent && "text-muted-foreground"
                    )}
                  >
                    {step.shortLabel}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}
