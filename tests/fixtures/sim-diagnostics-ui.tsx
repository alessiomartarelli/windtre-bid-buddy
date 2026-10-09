// Browser-only component harness: real React, React Query and diagnostic calculations.
// Test controls stand in for parent props; no test route is added to the application.
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SimDiagnostics from "../../client/src/components/customer-journey/SimDiagnostics";
import { buildGettoneJourneys, filterGettoneByInsertDate, type CjListFilters, type CjReportRow } from "../../shared/customerJourney";
import { matchesDiagnosticFilters } from "../../shared/customerJourneyDiagnostics";
// @ts-expect-error Plain JS fixture is also consumed by the Node test.
import { rows, filters as initialFilters } from "./sim-diagnostics-data.mjs";

const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: false, refetchOnWindowFocus: false,
} } });

function Harness() {
  const [from, setFrom] = useState("2026-07-01");
  const [to, setTo] = useState("2026-07-31");
  const [filters, setFilters] = useState<CjListFilters>(initialFilters);
  const filteredRows = (rows as CjReportRow[]).filter(r => matchesDiagnosticFilters(r, filters));
  const selected = filterGettoneByInsertDate(buildGettoneJourneys(filteredRows), from, to);
  return <>
    <label>Dal<input type="date" value={from} onChange={e => setFrom(e.target.value)} /></label>
    <label>Al<input type="date" value={to} onChange={e => setTo(e.target.value)} /></label>
    <label>Cerca<input value={filters.search} onChange={e => setFilters({ ...filters, search: e.target.value })} /></label>
    <label>PDV<select aria-label="PDV" value={filters.pdvFilter[0] ?? ""} onChange={e => setFilters({ ...filters, pdvFilter: e.target.value ? [e.target.value] : [] })}>
      <option value="">Tutti</option><option>Roma</option><option>Milano</option>
    </select></label>
    <label>Addetto<select aria-label="Addetto" value={filters.addettoFilter} onChange={e => setFilters({ ...filters, addettoFilter: e.target.value })}>
      <option value="tutti">Tutti</option><option>Mario</option><option>Luigi</option>
    </select></label>
    <button onClick={() => {
      setFrom("2026-07-01"); setTo("2026-07-31"); setFilters(initialFilters);
    }}>Ripristina contesto</button>
    <SimDiagnostics rows={filteredRows} selected={selected} filters={filters} from={from} to={to} onOpenJourney={() => {}} />
  </>;
}
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}><Harness /></QueryClientProvider>,
);
