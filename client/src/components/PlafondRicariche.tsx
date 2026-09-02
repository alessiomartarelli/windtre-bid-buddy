// Task #537/#538/#544 — Plafond ricariche per codice dealer.
//
// Mostra il saldo ricariche corrente per ogni CODICE DEALER ("8 miliardi")
// configurato sui PDV della Struttura: più codici POS possono condividere lo
// stesso dealer (stesso plafond), la stessa Ragione Sociale può contenere
// dealer diversi (saldi separati). Il saldo è derivato server-side dalle
// operazioni amministrative append-only + il consumo degli articoli RICARICHE
// non annullati. Le org senza dealer configurati mantengono le righe per RS.
// Gli admin possono "Aggiungi", "Imposta saldo", "Soglia avviso" e assegnare
// a un dealer le operazioni storiche registrate per RS ambigua.
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { apiUrl } from "@/lib/basePath";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Loader2, Wallet, Plus, Equal, History, Bell, AlertTriangle, Link2 } from "lucide-react";

export type PlafondSaldo = {
  codiceDealer: string;          // "" = riga legacy per RS
  ragioneSociale: string;
  ragioneSocialeId: string;
  pdv: Array<{ codicePos: string; nome: string }>;
  daAssegnare: boolean;          // op storiche per RS da assegnare a un dealer
  senzaDealer: boolean;          // consumo da PDV senza codice dealer
  saldo: number | null;
  consumoTotale: number;
  consumoDaCutoff: number;
  soglia: number | null;
  sogliaCustom: boolean;
  inAllerta: boolean;
  lastOpAt: string | null;
};

type StoricoRow = {
  id: string;
  ragioneSociale: string;
  codiceDealer: string;
  tipo: "aggiungi" | "imposta" | "soglia";
  importo: number;
  saldoPrima: number;
  saldoDopo: number;
  utente: string;
  createdAt: string | null;
};

const fmtEur = (n: number) =>
  new Intl.NumberFormat("it-IT", { style: "currency", currency: "EUR" }).format(n);

const fmtDateTime = (iso: string | null) =>
  iso
    ? new Intl.DateTimeFormat("it-IT", {
        timeZone: "Europe/Rome",
        day: "2-digit", month: "2-digit", year: "numeric",
        hour: "2-digit", minute: "2-digit",
      }).format(new Date(iso))
    : "—";

// Slug stabile per i data-testid (dealer/RS con spazi/punteggiatura).
const slug = (s: string) => s.replace(/[^a-z0-9]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase();

// Id riga per i testid: le righe dealer usano il codice dealer, quelle legacy
// per RS mantengono lo slug della RS (compatibilità test/consumatori).
const rowId = (s: Pick<PlafondSaldo, "codiceDealer" | "ragioneSociale">) =>
  s.codiceDealer ? slug(s.codiceDealer) : slug(s.ragioneSociale);

export function usePlafondRicariche(orgId: string) {
  return useQuery<{ saldi: PlafondSaldo[]; lastSync: string | null }>({
    queryKey: ["/api/ricariche-plafond", orgId],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/ricariche-plafond"), { credentials: "include" });
      if (!res.ok) throw new Error("Errore nel caricamento del plafond ricariche");
      return res.json();
    },
    enabled: !!orgId,
  });
}

export function formatLastSync(iso: string | null | undefined): string | null {
  return iso ? fmtDateTime(iso) : null;
}

type OpTarget = { codiceDealer: string; ragioneSociale: string; tipo: "aggiungi" | "imposta" | "soglia" };

export default function PlafondRicariche({ orgId, isAdmin }: { orgId: string; isAdmin: boolean }) {
  const queryClient = useQueryClient();
  const { data, isLoading } = usePlafondRicariche(orgId);
  const [opDialog, setOpDialog] = useState<OpTarget | null>(null);
  const [importo, setImporto] = useState("");
  const [opError, setOpError] = useState<string | null>(null);
  const [storicoOpen, setStoricoOpen] = useState(false);
  // Assegnazione op storiche per RS → dealer (Task #544).
  const [assegnaDialog, setAssegnaDialog] = useState<{ rs: string } | null>(null);
  const [assegnaDealer, setAssegnaDealer] = useState("");
  const [assegnaError, setAssegnaError] = useState<string | null>(null);

  const { data: storicoData, isLoading: storicoLoading } = useQuery<{ storico: StoricoRow[] }>({
    queryKey: ["/api/ricariche-plafond/storico", orgId],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/ricariche-plafond/storico"), { credentials: "include" });
      if (!res.ok) throw new Error("Errore nel caricamento dello storico");
      return res.json();
    },
    enabled: !!orgId && storicoOpen,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/ricariche-plafond", orgId] });
    queryClient.invalidateQueries({ queryKey: ["/api/ricariche-plafond/storico", orgId] });
  };

  const opMutation = useMutation({
    mutationFn: async ({ target, value }: { target: OpTarget; value: number }) => {
      const body: Record<string, unknown> = { tipo: target.tipo, importo: value };
      if (target.codiceDealer) body.codiceDealer = target.codiceDealer;
      else body.ragioneSociale = target.ragioneSociale;
      const res = await fetch(apiUrl("/api/ricariche-plafond"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore nel salvataggio");
      return data;
    },
    onSuccess: () => {
      setOpDialog(null);
      setImporto("");
      setOpError(null);
      invalidate();
    },
    onError: (e: Error) => setOpError(e.message),
  });

  const assegnaMutation = useMutation({
    mutationFn: async ({ rs, codiceDealer }: { rs: string; codiceDealer: string }) => {
      const res = await fetch(apiUrl("/api/ricariche-plafond/assegna"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ ragioneSociale: rs, codiceDealer }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Errore nell'assegnazione");
      return data;
    },
    onSuccess: () => {
      setAssegnaDialog(null);
      setAssegnaDealer("");
      setAssegnaError(null);
      invalidate();
    },
    onError: (e: Error) => setAssegnaError(e.message),
  });

  const saldi = data?.saldi ?? [];
  // Un'op storica può essere assegnata SOLO a un dealer della stessa RS
  // (il server rifiuta comunque i dealer di altre RS).
  const dealerOptionsForRs = (rs: string) =>
    saldi.filter((s) => s.codiceDealer && s.ragioneSociale.split(" / ").includes(rs));
  if (!isLoading && saldi.length === 0) return null;

  const confirmDisabled =
    opMutation.isPending ||
    !importo.trim() ||
    !Number.isFinite(Number(importo.replace(",", "."))) ||
    (opDialog?.tipo === "aggiungi"
      ? Number(importo.replace(",", ".")) <= 0
      : Number(importo.replace(",", ".")) < 0);

  const opLabel = (t: OpTarget | null) =>
    t ? (t.codiceDealer ? `dealer ${t.codiceDealer}` : t.ragioneSociale) : "";

  return (
    <Card data-testid="card-plafond-ricariche">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between flex-wrap gap-2">
          <CardTitle className="flex items-center gap-2 text-base">
            <Wallet className="h-5 w-5 text-primary" />
            Plafond Ricariche per Codice Dealer
          </CardTitle>
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs"
            onClick={() => setStoricoOpen(true)}
            data-testid="button-plafond-storico"
          >
            <History className="h-3.5 w-3.5 mr-1" /> Storico
          </Button>
        </div>
        <p className="text-xs text-muted-foreground">
          Saldo già decurtato delle ricariche vendute (escluse le annullate). Più
          punti vendita con lo stesso codice dealer condividono lo stesso plafond.
        </p>
      </CardHeader>
      <CardContent className="pt-0">
        {isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
            <Loader2 className="h-4 w-4 animate-spin" /> Caricamento plafond...
          </div>
        ) : (
          <div className="space-y-2">
            {saldi.map((s) => {
              const id = rowId(s);
              const pdvLabel = s.pdv.map((p) => p.nome || p.codicePos).filter(Boolean).join(", ");
              return (
                <div
                  key={s.codiceDealer || `rs:${s.ragioneSociale}`}
                  className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 border rounded-lg px-3 py-2"
                  data-testid={`row-plafond-${id}`}
                >
                  <div className="min-w-0">
                    <div className="font-semibold text-sm truncate">
                      {s.codiceDealer ? (
                        <>Dealer {s.codiceDealer}<span className="font-normal text-muted-foreground"> · {s.ragioneSociale}</span></>
                      ) : (
                        s.ragioneSociale
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {pdvLabel && <>PDV: {pdvLabel} · </>}
                      Ricariche vendute: {fmtEur(s.consumoTotale)}
                      {s.saldo !== null && s.soglia !== null && (
                        <> · Soglia avviso: {fmtEur(s.soglia)}{s.sogliaCustom ? "" : " (default)"}</>
                      )}
                    </div>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    {s.senzaDealer && (
                      <Badge
                        className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20"
                        data-testid={`badge-plafond-senza-dealer-${id}`}
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        PDV senza codice dealer
                      </Badge>
                    )}
                    {s.daAssegnare && (
                      <Badge
                        className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20"
                        data-testid={`badge-plafond-da-assegnare-${id}`}
                      >
                        <AlertTriangle className="h-3 w-3 mr-1" />
                        Operazioni da assegnare
                      </Badge>
                    )}
                    {s.saldo === null ? (
                      <Badge variant="outline" className="text-xs" data-testid={`text-plafond-saldo-${id}`}>
                        Plafond non configurato
                      </Badge>
                    ) : (
                      <>
                        {/* Task #538 — avviso sotto-soglia (saldo ancora positivo) */}
                        {s.inAllerta && s.saldo >= 0 && (
                          <Badge
                            className="text-xs bg-amber-500/10 text-amber-600 border-amber-500/20"
                            data-testid={`badge-plafond-allerta-${id}`}
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Sotto soglia{s.soglia !== null ? ` (${fmtEur(s.soglia)})` : ""}
                          </Badge>
                        )}
                        {s.inAllerta && s.saldo < 0 && (
                          <Badge
                            className="text-xs bg-red-500/10 text-red-600 border-red-500/20"
                            data-testid={`badge-plafond-allerta-${id}`}
                          >
                            <AlertTriangle className="h-3 w-3 mr-1" />
                            Plafond esaurito
                          </Badge>
                        )}
                        <Badge
                          className={`text-sm font-bold tabular-nums py-1 ${
                            s.saldo < 0
                              ? "bg-red-500/10 text-red-600 border-red-500/20"
                              : s.inAllerta
                                ? "bg-amber-500/10 text-amber-600 border-amber-500/20"
                                : "bg-green-500/10 text-green-600 border-green-500/20"
                          }`}
                          data-testid={`text-plafond-saldo-${id}`}
                        >
                          {fmtEur(s.saldo)}
                        </Badge>
                      </>
                    )}
                    {isAdmin && s.daAssegnare && dealerOptionsForRs(s.ragioneSociale).length > 0 && (
                      <Button
                        variant="outline"
                        size="sm"
                        className="h-7 text-xs"
                        onClick={() => { setAssegnaDialog({ rs: s.ragioneSociale }); setAssegnaDealer(""); setAssegnaError(null); }}
                        data-testid={`button-plafond-assegna-${id}`}
                      >
                        <Link2 className="h-3.5 w-3.5 mr-1" /> Assegna a dealer
                      </Button>
                    )}
                    {/* Le op vanno registrate sulla chiave contabile: sulle
                        righe "da assegnare" prima si assegnano le storiche. */}
                    {isAdmin && !s.daAssegnare && !(s.senzaDealer && s.saldo === null) && (
                      <>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setOpDialog({ codiceDealer: s.codiceDealer, ragioneSociale: s.ragioneSociale, tipo: "aggiungi" }); setImporto(""); setOpError(null); }}
                          data-testid={`button-plafond-aggiungi-${id}`}
                        >
                          <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setOpDialog({ codiceDealer: s.codiceDealer, ragioneSociale: s.ragioneSociale, tipo: "imposta" }); setImporto(""); setOpError(null); }}
                          data-testid={`button-plafond-imposta-${id}`}
                        >
                          <Equal className="h-3.5 w-3.5 mr-1" /> Imposta saldo
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-7 text-xs"
                          onClick={() => { setOpDialog({ codiceDealer: s.codiceDealer, ragioneSociale: s.ragioneSociale, tipo: "soglia" }); setImporto(""); setOpError(null); }}
                          data-testid={`button-plafond-soglia-${id}`}
                        >
                          <Bell className="h-3.5 w-3.5 mr-1" /> Soglia avviso
                        </Button>
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </CardContent>

      {/* Dialog operazione admin (aggiungi/imposta/soglia) con conferma esplicita */}
      <Dialog open={!!opDialog} onOpenChange={(o) => { if (!o) setOpDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>
              {opDialog?.tipo === "aggiungi"
                ? "Aggiungi credito al plafond"
                : opDialog?.tipo === "soglia"
                  ? "Imposta soglia di avviso"
                  : "Imposta nuovo saldo"}
            </DialogTitle>
            <DialogDescription>
              {opDialog?.tipo === "aggiungi"
                ? `L'importo verrà sommato al saldo corrente di ${opLabel(opDialog)}.`
                : opDialog?.tipo === "soglia"
                  ? `Quando il saldo di ${opLabel(opDialog)} scende sotto questa soglia compare un avviso (0 = disattiva la soglia, resta l'avviso per saldo negativo).`
                  : `Il saldo di ${opLabel(opDialog)} verrà impostato a questo valore; il consumo riparte da ora.`}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Input
              type="number"
              inputMode="decimal"
              min="0"
              step="0.01"
              placeholder="Importo in €"
              value={importo}
              onChange={(e) => setImporto(e.target.value)}
              data-testid="input-plafond-importo"
            />
            {opError && <p className="text-xs text-red-600" data-testid="text-plafond-error">{opError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpDialog(null)} data-testid="button-plafond-cancel">
              Annulla
            </Button>
            <Button
              disabled={confirmDisabled}
              onClick={() => {
                if (!opDialog) return;
                opMutation.mutate({ target: opDialog, value: Number(importo.replace(",", ".")) });
              }}
              data-testid="button-plafond-confirm"
            >
              {opMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Conferma
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Assegnazione op storiche per RS → dealer (Task #544) */}
      <Dialog open={!!assegnaDialog} onOpenChange={(o) => { if (!o) setAssegnaDialog(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Assegna le operazioni a un dealer</DialogTitle>
            <DialogDescription>
              Le operazioni plafond registrate per {assegnaDialog?.rs} verranno
              attribuite al codice dealer scelto (nessun importo viene duplicato).
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Select value={assegnaDealer} onValueChange={setAssegnaDealer}>
              <SelectTrigger data-testid="select-plafond-assegna-dealer">
                <SelectValue placeholder="Scegli il codice dealer" />
              </SelectTrigger>
              <SelectContent>
                {(assegnaDialog ? dealerOptionsForRs(assegnaDialog.rs) : []).map((d) => (
                  <SelectItem key={d.codiceDealer} value={d.codiceDealer} data-testid={`option-plafond-dealer-${slug(d.codiceDealer)}`}>
                    {d.codiceDealer} · {d.ragioneSociale}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {assegnaError && <p className="text-xs text-red-600" data-testid="text-plafond-assegna-error">{assegnaError}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setAssegnaDialog(null)} data-testid="button-plafond-assegna-cancel">
              Annulla
            </Button>
            <Button
              disabled={assegnaMutation.isPending || !assegnaDealer}
              onClick={() => {
                if (!assegnaDialog || !assegnaDealer) return;
                assegnaMutation.mutate({ rs: assegnaDialog.rs, codiceDealer: assegnaDealer });
              }}
              data-testid="button-plafond-assegna-confirm"
            >
              {assegnaMutation.isPending && <Loader2 className="h-4 w-4 mr-1 animate-spin" />}
              Assegna
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Storico consultabile (append-only, nessuna modifica) */}
      <Dialog open={storicoOpen} onOpenChange={setStoricoOpen}>
        <DialogContent className="sm:max-w-2xl max-h-[80vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Storico operazioni plafond</DialogTitle>
            <DialogDescription>
              Registro non modificabile delle aggiunte e impostazioni di saldo.
            </DialogDescription>
          </DialogHeader>
          {storicoLoading ? (
            <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
              <Loader2 className="h-4 w-4 animate-spin" /> Caricamento...
            </div>
          ) : (storicoData?.storico?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground py-2" data-testid="text-plafond-storico-empty">
              Nessuna operazione registrata.
            </p>
          ) : (
            <div className="space-y-2" data-testid="list-plafond-storico">
              {storicoData!.storico.map((op) => (
                <div key={op.id} className="border rounded-lg px-3 py-2 text-sm" data-testid={`row-storico-${op.id}`}>
                  <div className="flex items-center justify-between gap-2 flex-wrap">
                    <span className="font-semibold truncate">
                      {op.codiceDealer
                        ? <>Dealer {op.codiceDealer}{op.ragioneSociale ? <span className="font-normal text-muted-foreground"> · {op.ragioneSociale}</span> : null}</>
                        : (op.ragioneSociale || "N/D")}
                    </span>
                    <Badge variant="outline" className="text-xs">
                      {op.tipo === "aggiungi" ? "Aggiunta" : op.tipo === "soglia" ? "Soglia avviso" : "Imposta saldo"}
                    </Badge>
                  </div>
                  <div className="text-xs text-muted-foreground mt-1">
                    {op.tipo === "aggiungi" ? "+" : op.tipo === "soglia" ? "⚑" : "="} {fmtEur(op.importo)}
                    {op.tipo === "soglia" ? " (soglia di avviso, saldo invariato)" : <> · saldo {fmtEur(op.saldoPrima)} → {fmtEur(op.saldoDopo)}</>}
                  </div>
                  <div className="text-xs text-muted-foreground">
                    {op.utente} · {fmtDateTime(op.createdAt)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </DialogContent>
      </Dialog>
    </Card>
  );
}
