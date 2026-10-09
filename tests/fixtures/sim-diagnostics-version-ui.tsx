// Focused harness: parent report props are deliberately empty. All visible
// diagnostics must come from the authenticated, DB-backed diagnostic endpoint.
import React from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import SimDiagnostics from "../../client/src/components/customer-journey/SimDiagnostics";

const queryClient = new QueryClient({ defaultOptions: { queries: {
  retry: false, refetchOnWindowFocus: false,
} } });
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={queryClient}>
    <SimDiagnostics rows={[]} selected={[]} from="2026-07-01" to="2026-07-31"
      filters={{ typeFilter: "tutti", pdvFilter: [], addettoFilter: "tutti", stateFilter: "tutti", search: "" }}
      onOpenJourney={() => {}} />
  </QueryClientProvider>,
);
