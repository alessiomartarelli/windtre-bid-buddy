import * as React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { SlidersHorizontal, X, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

interface FilterBarProps {
  children: React.ReactNode;
  className?: string;
  title?: string;
  activeCount?: number;
  onReset?: () => void;
  resetLabel?: string;
  actions?: React.ReactNode;
}

export function FilterBar({
  children,
  className,
  title = "Filtri",
  activeCount,
  onReset,
  resetLabel = "Azzera",
  actions,
}: FilterBarProps) {
  const showHeader = !!title || activeCount !== undefined || !!onReset || !!actions;
  return (
    <Card
      className={cn(
        "border-border/60 bg-gradient-to-br from-background to-muted/30 shadow-sm",
        className,
      )}
      data-testid="filter-bar"
    >
      <CardContent className="p-3 sm:p-4 space-y-3">
        {showHeader && (
          <div className="flex items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <div className="p-1.5 rounded-md bg-primary/10 text-primary">
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </div>
              <span className="text-sm font-medium text-foreground/90">{title}</span>
              {activeCount !== undefined && activeCount > 0 && (
                <Badge variant="secondary" className="h-5 px-1.5 text-[10px]" data-testid="badge-filter-count">
                  {activeCount} attiv{activeCount === 1 ? "o" : "i"}
                </Badge>
              )}
            </div>
            <div className="flex items-center gap-2">
              {actions}
              {onReset && activeCount !== undefined && activeCount > 0 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 text-xs text-muted-foreground hover:text-foreground"
                  onClick={onReset}
                  data-testid="button-reset-filters"
                >
                  <X className="h-3 w-3 mr-1" />
                  {resetLabel}
                </Button>
              )}
            </div>
          </div>
        )}
        <div className={cn("grid gap-2.5", "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5")}>
          {children}
        </div>
      </CardContent>
    </Card>
  );
}

interface FilterFieldProps {
  label: string;
  icon?: LucideIcon;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
  span?: 1 | 2 | 3;
}

export function FilterField({
  label,
  icon: Icon,
  children,
  className,
  htmlFor,
  span = 1,
}: FilterFieldProps) {
  const spanClass =
    span === 2
      ? "sm:col-span-2"
      : span === 3
      ? "sm:col-span-2 lg:col-span-3"
      : "";
  return (
    <div className={cn("space-y-1 min-w-0", spanClass, className)}>
      <Label
        htmlFor={htmlFor}
        className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-muted-foreground"
      >
        {Icon && <Icon className="h-3 w-3" />}
        {label}
      </Label>
      <div className="[&_button[role=combobox]]:bg-background [&_button[role=combobox]]:border-border/60 [&_button[role=combobox]]:shadow-sm [&_input]:bg-background [&_input]:border-border/60 [&_input]:shadow-sm">
        {children}
      </div>
    </div>
  );
}
