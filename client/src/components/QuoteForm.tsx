import { useState } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Upload, FileText, Calculator } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface QuoteFormProps {
  onCalculate: (data: FormData) => void;
}

interface FormData {
  projectName: string;
  startDate: string;
  endDate: string;
  description: string;
  files: File[];
}

export const QuoteForm = ({ onCalculate }: QuoteFormProps) => {
  const { toast } = useToast();
  const [formData, setFormData] = useState<FormData>({
    projectName: "",
    startDate: "",
    endDate: "",
    description: "",
    files: [],
  });

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (e.target.files) {
      const newFiles = Array.from(e.target.files);
      setFormData({ ...formData, files: [...formData.files, ...newFiles] });
      toast({
        title: "File caricati",
        description: `${newFiles.length} file aggiunti con successo`,
      });
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.projectName || !formData.startDate || !formData.endDate) {
      toast({
        title: "Campi obbligatori mancanti",
        description: "Compila nome progetto e periodo di gara",
        variant: "destructive",
      });
      return;
    }

    onCalculate(formData);
    toast({
      title: "Calcolo in corso",
      description: "Stiamo generando il preventivo...",
    });
  };

  return (
    <Card className="border-border shadow-md">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-foreground">
          <FileText className="h-5 w-5 text-primary" />
          Dati Gara WindTre
        </CardTitle>
        <CardDescription>
          Inserisci i dati della gara per generare il preventivo
        </CardDescription>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSubmit} className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="projectName">Nome Progetto *</Label>
              <Input
                id="projectName"
                placeholder="Es: Gara 2025 - Milano"
                value={formData.projectName}
                onChange={(e) => setFormData({ ...formData, projectName: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="startDate">Data Inizio Gara *</Label>
              <Input
                id="startDate"
                type="date"
                value={formData.startDate}
                onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2">
              <Label htmlFor="endDate">Data Fine Gara *</Label>
              <Input
                id="endDate"
                type="date"
                value={formData.endDate}
                onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                required
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="description">Descrizione</Label>
              <Textarea
                id="description"
                placeholder="Note aggiuntive sulla gara..."
                value={formData.description}
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
                rows={4}
              />
            </div>

            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="files">Documenti Gara (opzionali)</Label>
              <p className="text-sm text-muted-foreground mb-2">
                Carica i documenti se disponibili, altrimenti procederemo con inserimento manuale
              </p>
              <div className="flex items-center gap-4">
                <Button type="button" variant="outline" className="relative" asChild>
                  <label htmlFor="files" className="cursor-pointer">
                    <Upload className="h-4 w-4 mr-2" />
                    Carica File
                    <input
                      id="files"
                      type="file"
                      multiple
                      onChange={handleFileUpload}
                      className="absolute inset-0 w-full h-full opacity-0 cursor-pointer"
                    />
                  </label>
                </Button>
                {formData.files.length > 0 && (
                  <span className="text-sm text-muted-foreground">
                    {formData.files.length} file caricati
                  </span>
                )}
              </div>
            </div>
          </div>

          <Button type="submit" className="w-full" size="lg">
            <Calculator className="h-4 w-4 mr-2" />
            Genera Preventivo
          </Button>
        </form>
      </CardContent>
    </Card>
  );
};
