import React from "react";
import { LucideIcon } from "lucide-react";
import { formatCurrency } from "@/utils/format";
import { cn } from "@/lib/utils";

interface StepContentHeaderProps {
  icon: LucideIcon;
  title: string;
  subtitle?: string;
  totalPremio?: number;
  extraInfo?: string;
  className?: string;
}

export function StepContentHeader({
  icon: Icon,
  title,
  subtitle,
  totalPremio,
  extraInfo,
  className,
}: StepContentHeaderProps) {
  return (
    <div
      className={cn(
        "flex items-start gap-4 p-4 rounded-xl bg-gradient-to-r from-primary/10 to-primary/5 border border-primary/20",
        className
      )}
    >
      <div className="w-12 h-12 rounded-xl bg-primary/20 flex items-center justify-center shrink-0">
        <Icon className="w-6 h-6 text-primary" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <div>
            <h3 className="text-lg font-semibold text-foreground">{title}</h3>
            {subtitle && (
              <p className="text-sm text-muted-foreground">{subtitle}</p>
            )}
          </div>
          {totalPremio !== undefined && (
            <div className="text-right">
              <p className="text-sm text-muted-foreground">Premio Totale</p>
              <p className="text-2xl font-bold text-primary">
                {formatCurrency(totalPremio)}
              </p>
              {extraInfo && (
                <p className="text-xs text-muted-foreground">{extraInfo}</p>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
