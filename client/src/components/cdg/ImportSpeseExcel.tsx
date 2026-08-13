import { useRef, useState } from "react";
import * as XLSX from "xlsx";
import { useQueryClient } from "@tanstack/react-query";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/basePath";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Table, TableBody, TableCell, TableHead, TableHeader, TableRow,
} from "@/components/ui/table";
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle } from "lucide-react";
import type { CdgCategoria, CdgFornitore } from "@shared/schema";

// Intestazioni del foglio "Spese" del template. Il matching in lettura è
// case-insensitive e ignora gli asterischi.
const HEADERS = [
  "Ragione Sociale*", "Codice PDV", "Nome PDV", "Categoria", "Fornitore",
  "Descrizione*", "Imponibile*", "Aliquota IVA (%)", "Data Pagamento*",
  "Mese Competenza", "Metodo Pagamento", "Note",
] as const;

type RawRow = {
  ragioneSociale: string; pdvCodice: string; pdvNome: string;
  categoria: string; fornitore: string; descrizione: string;
  imponibile: string; aliquotaIva: string; dataPagamento: string;
  meseCompetenza: string; metodoPagamento: string; note: string;
};

type PreviewRiga = {
  index: number;
  esito: "ok" | "errore";
  errori: string[];
  azioni: string[];
  dati: {
    ragioneSociale: string; pdvCodice: string | null; categoriaNome: string | null;
    fornitoreNome: string | null; descrizione: string; imponibile: string;
    dataPagamento: string; meseCompetenza: string;
  };
};

type PreviewResp = { righe: PreviewRiga[]; valide: number; scartate: number };
type ConfirmResp = {
  importate: number; scartate: number; duplicati: number;
  categorieCreate: number; fornitoriCreati: number; pdvCreati: number;
};

const FIELD_BY_HEADER: Record<string, keyof RawRow> = {
  "ragione sociale": "ragioneSociale",
  "codice pdv": "pdvCodice",
  "nome pdv": "pdvNome",
  "categoria": "categoria",
  "fornitore": "fornitore",
  "descrizione": "descrizione",
  "imponibile": "imponibile",
  "aliquota iva (%)": "aliquotaIva",
  "aliquota iva": "aliquotaIva",
  "data pagamento": "dataPagamento",
  "mese competenza": "meseCompetenza",
  "metodo pagamento": "metodoPagamento",
  "note": "note",
};

// Excel può consegnare le date come numero seriale: convertiamo in DD/MM/YYYY.
function cellToText(v: unknown): string {
  if (v == null) return "";
  if (v instanceof Date) {
    return `${String(v.getDate()).padStart(2, "0")}/${String(v.getMonth() + 1).padStart(2, "0")}/${v.getFullYear()}`;
  }
  return String(v).trim();
}

function excelSerialToDate(n: number): string {
  const ms = Math.round((n - 25569) * 86400 * 1000);
  const d = new Date(ms);
  return `${String(d.getUTCDate()).padStart(2, "0")}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/${d.getUTCFullYear()}`;
}

export function ImportSpeseExcel({
  ragioniSociali, categorie, fornitori, pdvList, onImported,
}: {
  ragioniSociali: string[];
  categorie: CdgCategoria[];
  fornitori: CdgFornitore[];
  pdvList: { codice: string; nome: string; ragioneSociale: string }[];
  onImported?: () => void;
}) {
  const { toast } = useToast();
  const qc = useQueryClient();
  const fileRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<RawRow[]>([]);
  const [preview, setPreview] = useState<PreviewResp | null>(null);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(false);

  const downloadTemplate = () => {
    const wb = XLSX.utils.book_new();

    const spese = XLSX.utils.aoa_to_sheet([
      [...HEADERS],
      ["", "", "", "", "", "", "", "22", "", "", "", ""],
    ]);
    spese["!cols"] = HEADERS.map(h => ({ wch: Math.max(h.length + 2, 16) }));
    XLSX.utils.book_append_sheet(wb, spese, "Spese");

    const istruzioni = XLSX.utils.aoa_to_sheet([
      ["ISTRUZIONI — Import spese"],
      [""],
      ["Compila il foglio 'Spese', una riga per spesa. Le colonne con * sono obbligatorie."],
      [""],
      ["Ragione Sociale*", "Deve esistere già in piattaforma. Vedi elenco nel foglio 'Elenchi'."],
      ["Codice PDV", "Se il codice esiste già per quella Ragione Sociale, la spesa viene agganciata al PDV esistente; altrimenti il PDV viene creato automaticamente."],
      ["Nome PDV", "Usato solo se il PDV viene creato (facoltativo: se vuoto viene usato il codice)."],
      ["Categoria", "Se non esiste viene creata automaticamente e associata alla Ragione Sociale."],
      ["Fornitore", "Se non esiste viene creato automaticamente e associato alla Ragione Sociale."],
      ["Descrizione*", "Testo libero."],
      ["Imponibile*", "Importo senza IVA, es. 1250,50."],
      ["Aliquota IVA (%)", "Es. 22. Se vuota viene usata 22. IVA e totale sono calcolati automaticamente."],
      ["Data Pagamento*", "Formato GG/MM/AAAA, es. 13/08/2026."],
      ["Mese Competenza", "Formato MM/AAAA. Se vuoto viene usato il mese della data di pagamento."],
      ["Metodo Pagamento", "Es. Bonifico, Contanti, POS, RID/SDD…"],
      ["Note", "Facoltative."],
      [""],
      ["Dopo il caricamento vedrai un'anteprima riga per riga prima di confermare: nulla viene scritto senza la tua conferma."],
    ]);
    istruzioni["!cols"] = [{ wch: 24 }, { wch: 110 }];
    XLSX.utils.book_append_sheet(wb, istruzioni, "Istruzioni");

    const maxLen = Math.max(ragioniSociali.length, categorie.length, fornitori.length, pdvList.length, 1);
    const elenchi: (string | undefined)[][] = [[
      "Ragioni Sociali", "Categorie", "Fornitori", "PDV — Codice", "PDV — Nome", "PDV — Ragione Sociale",
    ]];
    for (let i = 0; i < maxLen; i++) {
      elenchi.push([
        ragioniSociali[i] || "", categorie[i]?.nome || "", fornitori[i]?.nome || "",
        pdvList[i]?.codice || "", pdvList[i]?.nome || "", pdvList[i]?.ragioneSociale || "",
      ]);
    }
    const elSheet = XLSX.utils.aoa_to_sheet(elenchi);
    elSheet["!cols"] = [{ wch: 30 }, { wch: 24 }, { wch: 24 }, { wch: 16 }, { wch: 26 }, { wch: 30 }];
    XLSX.utils.book_append_sheet(wb, elSheet, "Elenchi");

    XLSX.writeFile(wb, "template_import_spese.xlsx");
  };

  const handleFile = async (file: File) => {
    setLoading(true);
    try {
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: "array", cellDates: true });
      const sheetName = wb.SheetNames.includes("Spese") ? "Spese" : wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: true, defval: "" });
      if (aoa.length < 2) throw new Error("Il foglio non contiene righe da importare");
      const headerRow = aoa[0].map(h => String(h || "").replace(/\*/g, "").trim().toLowerCase());
      const colMap: (keyof RawRow | null)[] = headerRow.map(h => FIELD_BY_HEADER[h] || null);
      if (!colMap.includes("ragioneSociale") || !colMap.includes("descrizione")) {
        throw new Error("Intestazioni non riconosciute: usa il template scaricato dalla piattaforma");
      }
      const parsed: RawRow[] = [];
      for (let r = 1; r < aoa.length; r++) {
        const row: RawRow = {
          ragioneSociale: "", pdvCodice: "", pdvNome: "", categoria: "", fornitore: "",
          descrizione: "", imponibile: "", aliquotaIva: "", dataPagamento: "",
          meseCompetenza: "", metodoPagamento: "", note: "",
        };
        let any = false;
        for (let c = 0; c < colMap.length; c++) {
          const f = colMap[c];
          if (!f) continue;
          let v = aoa[r][c];
          if (f === "dataPagamento" && typeof v === "number") v = excelSerialToDate(v);
          const text = cellToText(v);
          if (text) any = true;
          row[f] = text;
        }
        if (any) parsed.push(row);
      }
      if (parsed.length === 0) throw new Error("Nessuna riga compilata trovata nel foglio");
      setRows(parsed);
      const res = await fetch(apiUrl("/api/cdg/spese/import/preview"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Errore ${res.status}`);
      setPreview(data as PreviewResp);
      setOpen(true);
    } catch (e) {
      toast({ title: "Import non riuscito", description: e instanceof Error ? e.message : "Errore lettura file", variant: "destructive" });
    } finally {
      setLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const confirmImport = async () => {
    setImporting(true);
    try {
      const res = await fetch(apiUrl("/api/cdg/spese/import/confirm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || `Errore ${res.status}`);
      const r = data as ConfirmResp;
      const extra: string[] = [];
      if (r.categorieCreate) extra.push(`${r.categorieCreate} categorie create`);
      if (r.fornitoriCreati) extra.push(`${r.fornitoriCreati} fornitori creati`);
      if (r.pdvCreati) extra.push(`${r.pdvCreati} PDV creati`);
      if (r.duplicati) extra.push(`${r.duplicati} già presenti (saltate)`);
      if (r.scartate) extra.push(`${r.scartate} righe scartate`);
      toast({
        title: `${r.importate} spese importate`,
        description: extra.length ? extra.join(" · ") : undefined,
      });
      qc.invalidateQueries({ queryKey: ["/api/cdg/spese"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/categorie"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/fornitori"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/pdv-by-rs", "all"] });
      qc.invalidateQueries({ queryKey: ["/api/cdg/pdv-manuali"] });
      setOpen(false);
      setPreview(null);
      setRows([]);
      onImported?.();
    } catch (e) {
      toast({ title: "Import non riuscito", description: e instanceof Error ? e.message : "Errore", variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  return (
    <>
      <Button variant="outline" size="sm" onClick={downloadTemplate} data-testid="button-template-import-spese">
        <Download className="h-4 w-4 mr-1" /> Scarica template
      </Button>
      <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} disabled={loading} data-testid="button-import-spese">
        {loading ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Upload className="h-4 w-4 mr-1" />} Importa da Excel
      </Button>
      <input
        ref={fileRef}
        type="file"
        accept=".xlsx,.xls"
        className="hidden"
        data-testid="input-import-spese-file"
        onChange={e => { const f = e.target.files?.[0]; if (f) void handleFile(f); }}
      />

      <Dialog open={open} onOpenChange={o => { if (!o) { setOpen(false); setPreview(null); setRows([]); } }}>
        <DialogContent className="max-w-4xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Anteprima import spese</DialogTitle>
            <DialogDescription>
              {preview ? `${preview.valide} righe pronte, ${preview.scartate} con errori (non verranno importate). Nulla è ancora stato scritto.` : ""}
            </DialogDescription>
          </DialogHeader>
          {preview && (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-10">#</TableHead>
                  <TableHead>Esito</TableHead>
                  <TableHead>Descrizione</TableHead>
                  <TableHead>RS / PDV</TableHead>
                  <TableHead>Imponibile</TableHead>
                  <TableHead>Dettagli</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {preview.righe.map(r => (
                  <TableRow key={r.index} data-testid={`row-import-preview-${r.index}`}>
                    <TableCell className="text-muted-foreground">{r.index + 2}</TableCell>
                    <TableCell>
                      {r.esito === "ok" ? (
                        <Badge variant="outline" className="text-green-600 border-green-300"><CheckCircle2 className="h-3 w-3 mr-1" /> OK</Badge>
                      ) : (
                        <Badge variant="destructive"><AlertTriangle className="h-3 w-3 mr-1" /> Errore</Badge>
                      )}
                    </TableCell>
                    <TableCell className="max-w-[220px] truncate">{r.dati.descrizione || "—"}</TableCell>
                    <TableCell className="text-sm">
                      {r.dati.ragioneSociale || "—"}
                      {r.dati.pdvCodice ? <span className="text-muted-foreground"> · {r.dati.pdvCodice}</span> : null}
                    </TableCell>
                    <TableCell>{r.dati.imponibile || "—"}</TableCell>
                    <TableCell className="text-xs">
                      {r.errori.map((e, i) => <div key={i} className="text-destructive">{e}</div>)}
                      {r.azioni.map((a, i) => <div key={i} className="text-amber-600">{a}</div>)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setOpen(false); setPreview(null); setRows([]); }}>Annulla</Button>
            <Button
              onClick={confirmImport}
              disabled={importing || !preview || preview.valide === 0}
              data-testid="button-confirm-import-spese"
            >
              {importing ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : null}
              Importa {preview?.valide || 0} righe
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
