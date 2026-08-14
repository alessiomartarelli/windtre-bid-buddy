import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList,
} from "@/components/ui/command";

export interface MultiSelectOption {
  value: string;
  label: string;
}

/**
 * Filtro a selezione multipla (Popover + Command + Checkbox), pattern
 * condiviso dei filtri: selezione vuota = "tutti". Stesso comportamento del
 * filtro PDV di Amministrazione, reso riutilizzabile.
 *
 * - `allLabel` è il testo mostrato quando non c'è selezione (es. "Tutte");
 *   la voce "allLabel" in cima alla lista azzera la selezione.
 * - `countLabel(n)` è il testo con n>1 selezioni (es. `${n} RS selezionate`).
 * - `testid` finisce sul trigger; le opzioni usano `option-<testid>-<value>`.
 */
export function MultiSelectFilter({
  values,
  onChange,
  options,
  allLabel,
  countLabel,
  searchPlaceholder = "Cerca...",
  emptyText = "Nessun risultato.",
  testid,
}: {
  values: string[];
  onChange: (next: string[]) => void;
  options: MultiSelectOption[];
  allLabel: string;
  countLabel: (n: number) => string;
  searchPlaceholder?: string;
  emptyText?: string;
  testid: string;
}) {
  const labelFor = (v: string) => options.find(o => o.value === v)?.label ?? v;
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          className="w-full justify-between font-normal px-3"
          data-testid={testid}
        >
          <span className="truncate text-left">
            {values.length === 0
              ? allLabel
              : values.length === 1
              ? labelFor(values[0])
              : countLabel(values.length)}
          </span>
          <ChevronDown className="h-4 w-4 ml-2 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="p-0 w-[var(--radix-popover-trigger-width)] min-w-[240px]" align="start">
        <Command>
          <CommandInput placeholder={searchPlaceholder} />
          <CommandList>
            <CommandEmpty>{emptyText}</CommandEmpty>
            <CommandGroup>
              <CommandItem value="__all__" onSelect={() => onChange([])} data-testid={`option-${testid}-all`}>
                <Check aria-hidden className={cn("mr-2 h-4 w-4", values.length === 0 ? "opacity-100" : "opacity-0")} />
                <span className="font-medium">{allLabel}</span>
              </CommandItem>
              {options.map((o) => (
                <CommandItem
                  key={o.value}
                  value={o.label}
                  onSelect={() => {
                    onChange(
                      values.includes(o.value)
                        ? values.filter(v => v !== o.value)
                        : [...values, o.value],
                    );
                  }}
                  data-testid={`option-${testid}-${o.value}`}
                  aria-selected={values.includes(o.value)}
                >
                  <Check aria-hidden className={cn("mr-2 h-4 w-4", values.includes(o.value) ? "opacity-100" : "opacity-0")} />
                  <span className="truncate">{o.label}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
