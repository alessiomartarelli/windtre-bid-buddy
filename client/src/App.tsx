import { Switch, Route } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import Dashboard from "@/pages/dashboard";
import Auth from "@/pages/auth";
import ProductDetails from "@/pages/product-details";

function Router() {
  return (
    <Switch>
      <Route path="/" component={Dashboard} />
      <Route path="/auth" component={Auth} />
      <Route path="/product/:id" component={ProductDetails} />
      
      {/* Fallback routes for demo navigation */}
      <Route path="/auctions" component={Dashboard} />
      <Route path="/my-bids" component={Dashboard} />
      <Route path="/settings" component={Dashboard} />
      
      <Route component={NotFound} />
    </Switch>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
