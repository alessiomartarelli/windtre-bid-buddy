import * as React from "react";
import { DialogContent } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * DialogContent che sotto il breakpoint mobile (<640px) diventa a schermo
 * intero e scrollabile, mentre da tablet/desktop in su resta il classico
 * dialog centrato. Pattern condiviso per la versione mobile dell'app:
 * usarlo al posto di DialogContent nei dialog con form o contenuti lunghi.
 *
 * Uso: identico a DialogContent — <ResponsiveDialogContent className="...">.
 * Le classi passate hanno la precedenza (cn) e valgono per desktop.
 */
export const ResponsiveDialogContent = React.forwardRef<
  React.ElementRef<typeof DialogContent>,
  React.ComponentPropsWithoutRef<typeof DialogContent>
>(({ className, ...props }, ref) => (
  <DialogContent
    ref={ref}
    className={cn(
      // Mobile (<sm): schermo intero, nessun bordo arrotondato, scroll interno.
      "max-sm:inset-0 max-sm:left-0 max-sm:top-0 max-sm:h-[100dvh] max-sm:max-h-[100dvh] max-sm:w-screen max-sm:max-w-none max-sm:translate-x-0 max-sm:translate-y-0 max-sm:rounded-none max-sm:overflow-y-auto max-sm:pb-[max(1.5rem,env(safe-area-inset-bottom))]",
      className,
    )}
    {...props}
  />
));
ResponsiveDialogContent.displayName = "ResponsiveDialogContent";
