// Componente condiviso (Task #144) per l'editor di mappatura colonne
// + categoria default + modalità IVA + toggle auto-classificazione.
//
// Usato sia da `FinPlanSetupWizard` (step "mapping" del setup iniziale)
// sia da `BankImportFlow` (dialog di append in Transazioni). Riassume
// la parte UI identica tra i due flussi senza duplicarla. Le differenze
// rimanenti (multi-RS upload nel wizard, single-RS append nel dialog)
// sono incapsulate nei rispettivi step di upload/preview.

import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { AlertTriangle } from "lucide-react";
import { DEFAULT_CATS_E, DEFAULT_CATS_U, type ColumnMapping } from "@/lib/finplanImport";

export interface MappingFieldsProps {
  headers: string[];
  mapping: ColumnMapping;
  onMappingChange: (next: ColumnMapping) => void;
  defaultCatE: string;
  onDefaultCatEChange: (id: string) => void;
  defaultCatU: string;
  onDefaultCatUChange: (id: string) => void;
  ivaMode: "netti" | "lordi";
  onIvaModeChange: (mode: "netti" | "lordi") => void;
  /** Mostra il dropdown "Ragione Sociale" (modalità single-file con colonna RS). */
  showRsColumn?: boolean;
  /** Mostra warning se la mapping è invalida. */
  invalid?: boolean;
  invalidMessage?: string;
  /** Toggle opzionale per l'auto-classificazione descrizioni. */
  autoClassify?: { enabled: boolean; onToggle: (next: boolean) => void };
  testIdPrefix?: string;
}

export function MappingFields(props: MappingFieldsProps) {
  const p = props.testIdPrefix ?? "map";
  return (
    <div className="space-y-3" data-testid={`${p}-mapping-fields`}>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <ColMap
          label="Data / Mese (opz.)" value={props.mapping.date} headers={props.headers}
          onChange={(v) => props.onMappingChange({ ...props.mapping, date: v })}
          testId={`${p}-date`}
        />
        <ColMap
          label="Descrizione (opz.)" value={props.mapping.desc} headers={props.headers}
          onChange={(v) => props.onMappingChange({ ...props.mapping, desc: v })}
          testId={`${p}-desc`}
        />
        <ColMap
          label="Entrate / Accrediti" value={props.mapping.amountIn} headers={props.headers}
          onChange={(v) => props.onMappingChange({ ...props.mapping, amountIn: v })}
          testId={`${p}-in`}
        />
        <ColMap
          label="Uscite / Addebiti" value={props.mapping.amountOut} headers={props.headers}
          onChange={(v) => props.onMappingChange({ ...props.mapping, amountOut: v })}
          testId={`${p}-out`}
        />
        <ColMap
          label="OPPURE Importo unico con segno" value={props.mapping.amountSigned} headers={props.headers}
          onChange={(v) => props.onMappingChange({ ...props.mapping, amountSigned: v })}
          testId={`${p}-signed`}
        />
        {props.showRsColumn && (
          <ColMap
            label="Ragione Sociale" value={props.mapping.rs} headers={props.headers}
            onChange={(v) => props.onMappingChange({ ...props.mapping, rs: v })}
            testId={`${p}-rs`}
          />
        )}
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-3 pt-2">
        <div className="space-y-1">
          <Label>Categoria default Entrate</Label>
          <Select value={props.defaultCatE} onValueChange={props.onDefaultCatEChange}>
            <SelectTrigger data-testid={`${p}-default-cat-e`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEFAULT_CATS_E.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Categoria default Uscite</Label>
          <Select value={props.defaultCatU} onValueChange={props.onDefaultCatUChange}>
            <SelectTrigger data-testid={`${p}-default-cat-u`}><SelectValue /></SelectTrigger>
            <SelectContent>
              {DEFAULT_CATS_U.map(c => (
                <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <Label>Modalità importi</Label>
          <Select value={props.ivaMode} onValueChange={(v) => props.onIvaModeChange(v as "netti" | "lordi")}>
            <SelectTrigger data-testid={`${p}-iva-mode`}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="netti">Netti (estratto CC)</SelectItem>
              <SelectItem value="lordi">Lordi IVA 22% (fatture)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {props.autoClassify && (
        <div className="rounded-md border p-3 flex items-center justify-between gap-2" data-testid={`${p}-auto-classify`}>
          <div>
            <div className="text-sm font-medium">Auto-classificazione categorie</div>
            <div className="text-xs text-muted-foreground">
              Riconosce giroconti, infragruppo, estero, stipendi e fornitori dalla descrizione.
            </div>
          </div>
          <Button
            type="button"
            size="sm"
            variant={props.autoClassify.enabled ? "default" : "outline"}
            onClick={() => props.autoClassify!.onToggle(!props.autoClassify!.enabled)}
            data-testid={`${p}-toggle-auto-classify`}
          >
            {props.autoClassify.enabled ? "Attiva" : "Disattiva"}
          </Button>
        </div>
      )}

      {props.invalid && (
        <div className="rounded-md border border-amber-500/40 bg-amber-500/10 p-3 text-xs flex items-start gap-2" data-testid={`${p}-warn`}>
          <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0 mt-0.5" />
          <span>{props.invalidMessage ?? "Mappa Entrate e Uscite, oppure Importo con segno, per procedere."}</span>
        </div>
      )}
    </div>
  );
}

function ColMap(props: { label: string; value: number; headers: string[]; onChange: (v: number) => void; testId: string }) {
  return (
    <div className="space-y-1">
      <Label>{props.label}</Label>
      <Select value={String(props.value)} onValueChange={(v) => props.onChange(parseInt(v, 10))}>
        <SelectTrigger data-testid={props.testId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value="-1">— non presente —</SelectItem>
          {props.headers.map((h, i) => (
            <SelectItem key={i} value={String(i)}>{h}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  );
}
