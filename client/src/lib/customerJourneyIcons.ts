import {
  Smartphone, Router, Zap, ShieldCheck, Phone, ShieldPlus,
  type LucideIcon,
} from "lucide-react";
import type { CjDriver } from "@shared/schema";

// === Mappa centralizzata icona ↔ driver (Task #179) ===
// Unica fonte per la rappresentazione visiva dei driver della Customer
// Journey: la usa sia la UI a schermo (pagina CustomerJourney) sia gli
// export PDF/Excel. Tenere qui ogni nuovo driver per non duplicare la
// mappatura.

export const CJ_DRIVER_ICONS: Record<CjDriver, LucideIcon> = {
  mobile: Smartphone,
  fisso: Router,
  energia: Zap,
  assicurazioni: ShieldCheck,
  telefono: Phone,
  protetti: ShieldPlus,
};

// Equivalente testuale dell'icona, usato come indicatore visivo negli export
// Excel (le celle XLSX non possono contenere immagini con SheetJS). Resta
// allineato 1:1 ai driver di `CJ_DRIVER_ICONS`.
export const CJ_DRIVER_EMOJI: Record<CjDriver, string> = {
  mobile: "📱",
  fisso: "📡",
  energia: "⚡",
  assicurazioni: "🛡️",
  telefono: "☎️",
  protetti: "🚨",
};

// Colore brand per driver, usato dal grafico di tracciamento temporale della
// scheda cliente (dot timeline + legenda) e dai chip "per negozio". Tinte fisse
// leggibili sia in light sia in dark mode (mutuate dalla palette dei tool di
// tracciamento Wind3). Tenere allineato 1:1 ai driver di `CJ_DRIVER_ICONS`.
export const CJ_DRIVER_COLORS: Record<CjDriver, string> = {
  mobile: "#3B82F6",
  fisso: "#10B981",
  energia: "#F59E0B",
  assicurazioni: "#8B5CF6",
  telefono: "#06B6D4",
  protetti: "#EF4444",
};
