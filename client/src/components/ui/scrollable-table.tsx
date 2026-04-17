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
    setCanRight(max > 2 && el.scrollLeft < max - 2);
  }, []);

  React.useLayoutEffect(() => {
    update();
    const r1 = requestAnimationFrame(update);
    const t1 = window.setTimeout(update, 100);
    const t2 = window.setTimeout(update, 400);
    const el = ref.current;
    if (!el) return () => { cancelAnimationFrame(r1); clearTimeout(t1); clearTimeout(t2); };
    const ro = new ResizeObserver(update);
    ro.observe(el);
    Array.from(el.children).forEach((c) => ro.observe(c as Element));
    const mo = new MutationObserver(update);
    mo.observe(el, { childList: true, subtree: true, attributes: true });
    el.addEventListener("scroll", update, { passive: true });
    window.addEventListener("resize", update);
    return () => {
      cancelAnimationFrame(r1);
      clearTimeout(t1);
      clearTimeout(t2);
      ro.disconnect();
      mo.disconnect();
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
    <div className={cn("relative", className)}>
      <div
        ref={ref}
        className="w-full max-w-full overflow-x-auto"
        style={{ WebkitOverflowScrolling: "touch" }}
        data-testid="scrollable-table-viewport"
      >
        {children}
      </div>
      {canLeft && (
        <>
          <div className="pointer-events-none absolute left-0 top-0 bottom-3 w-10 bg-gradient-to-r from-background via-background/80 to-transparent z-10" />
          <button
            type="button"
            onClick={() => scroll(-1)}
            className="absolute left-2 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-full bg-background border-2 border-primary/40 shadow-lg hover-elevate active-elevate-2 flex items-center justify-center text-primary"
            aria-label="Scorri a sinistra"
            data-testid="button-scroll-left"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
        </>
      )}
      {canRight && (
        <>
          <div className="pointer-events-none absolute right-0 top-0 bottom-3 w-12 bg-gradient-to-l from-background via-background/80 to-transparent z-10" />
          <button
            type="button"
            onClick={() => scroll(1)}
            className="absolute right-2 top-1/2 -translate-y-1/2 z-20 h-9 w-9 rounded-full bg-background border-2 border-primary/40 shadow-lg hover-elevate active-elevate-2 flex items-center justify-center text-primary"
            aria-label="Scorri a destra"
            data-testid="button-scroll-right"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}
