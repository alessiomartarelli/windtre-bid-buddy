import * as React from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";

interface ScrollableTableProps {
  children: React.ReactNode;
  className?: string;
  scrollAmount?: number;
}

export function ScrollableTable({
  children,
  className,
  scrollAmount = 240,
}: ScrollableTableProps) {
  const ref = React.useRef<HTMLDivElement>(null);
  const [canLeft, setCanLeft] = React.useState(false);
  const [canRight, setCanRight] = React.useState(false);

  const update = React.useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setCanLeft(el.scrollLeft > 2);
    setCanRight(el.scrollLeft < max - 2);
  }, []);

  React.useEffect(() => {
    update();
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(update);
    ro.observe(el);
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      el.removeEventListener("scroll", update);
      window.removeEventListener("resize", update);
    };
  }, [update]);

  const scroll = (dir: 1 | -1) => {
    const el = ref.current;
    if (!el) return;
    el.scrollBy({ left: dir * scrollAmount, behavior: "smooth" });
  };

  return (
    <div className={cn("relative group", className)}>
      <div
        ref={ref}
        className="w-full max-w-full overflow-x-auto [-webkit-overflow-scrolling:touch] scrollbar-thin"
        data-testid="scrollable-table-viewport"
      >
        {children}
      </div>
      {canLeft && (
        <>
          <div className="pointer-events-none absolute left-0 top-0 bottom-3 w-8 bg-gradient-to-r from-background to-transparent z-10" />
          <button
            type="button"
            onClick={() => scroll(-1)}
            className="absolute left-1 top-1/2 -translate-y-1/2 z-20 h-8 w-8 rounded-full bg-background/95 border border-border shadow-md hover-elevate active-elevate-2 flex items-center justify-center"
            aria-label="Scorri a sinistra"
            data-testid="button-scroll-left"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
        </>
      )}
      {canRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-3 w-10 bg-gradient-to-l from-background to-transparent z-10" />
          <button
            type="button"
            onClick={() => scroll(1)}
            className="absolute right-1 top-1/2 -translate-y-1/2 z-20 h-8 w-8 rounded-full bg-background/95 border border-border shadow-md hover-elevate active-elevate-2 flex items-center justify-center animate-pulse"
            aria-label="Scorri a destra"
            data-testid="button-scroll-right"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </>
      )}
    </div>
  );
}
