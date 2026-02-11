import { useState } from "react";
import { useLocation } from "wouter";
import { QuoteForm } from "@/components/QuoteForm";
import { QuoteResult } from "@/components/QuoteResult";
import { FileSpreadsheet, ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";

const Index = () => {
  const [, setLocation] = useLocation();
  const [showResults, setShowResults] = useState(false);

  // Dati di esempio - verranno sostituiti con i dati reali dal TypeScript che l'utente fornirà
  const mockQuoteData = [
    {
      id: "1",
      description: "Installazione Base Station",
      pieces: 15,
      points: 450,
      currentEconomic: 45000,
      forecastEconomic: 52000,
    },
    {
      id: "2",
      description: "Cablaggio Fibra Ottica",
      pieces: 230,
      points: 1150,
      currentEconomic: 115000,
      forecastEconomic: 128000,
    },
    {
      id: "3",
      description: "Apparati Radio 5G",
      pieces: 8,
      points: 320,
      currentEconomic: 96000,
      forecastEconomic: 105000,
    },
    {
      id: "4",
      description: "Sistema di Alimentazione",
      pieces: 15,
      points: 300,
      currentEconomic: 60000,
      forecastEconomic: 65000,
    },
  ];

  const handleCalculate = (formData: any) => {
    console.log("Dati form:", formData);
    // Qui verrà integrata la logica di calcolo con il TypeScript fornito
    setTimeout(() => {
      setShowResults(true);
    }, 1000);
  };

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border bg-gradient-to-r from-primary to-warning shadow-md">
        <div className="container mx-auto px-4 py-6">
          <div className="flex items-center gap-3">
            <FileSpreadsheet className="h-8 w-8 text-primary-foreground" />
            <div>
              <h1 className="text-3xl font-bold text-primary-foreground">
                Simulatore Gare WindTre
              </h1>
              <p className="text-primary-foreground/90">
                Sistema di calcolo preventivi per lettere di gara
              </p>
            </div>
          </div>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-6xl mx-auto space-y-8">
          <div className="flex justify-end mb-4">
            <Button onClick={() => setLocation("/preventivatore")} size="lg" className="gap-2">
              Apri Simulatore Manuale <ArrowRight className="h-4 w-4" />
            </Button>
          </div>
          <QuoteForm onCalculate={handleCalculate} />
          
          {showResults && (
            <QuoteResult data={mockQuoteData} />
          )}
        </div>
      </main>

      <footer className="border-t border-border mt-16 py-6">
        <div className="container mx-auto px-4 text-center text-sm text-muted-foreground">
          © 2025 WindTre Simulatore - Sistema di gestione simulazioni gare
        </div>
      </footer>
    </div>
  );
};

export default Index;
