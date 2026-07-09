import { useMemo, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Link } from "wouter";
import { AppNavbar } from "@/components/AppNavbar";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiRequest, queryClient } from "@/lib/queryClient";
import {
  normalizeConfig, defaultConfig,
  type IncentivazioneConfig, type Section, type Track,
} from "@shared/incentivazione";
import {
  Plus, Pencil, Copy, Trash2, Settings, AlertCircle, ArrowLeft, Medal,
} from "lucide-react";

interface ConfigListItem {
  id: string;
  month: number;
  year: number;
  name: string;
  updatedAt: string | null;
  createdAt: string | null;
}

interface ConfigDetail {
  id: string;
  month: number;
  year: number;
  name: string;
  config: IncentivazioneConfig;
}

const MONTHS = [
  "Gennaio", "Febbraio", "Marzo", "Aprile", "Maggio", "Giugno",
  "Luglio", "Agosto", "Settembre", "Ottobre", "Novembre", "Dicembre",
];

export default function IncentivazioneConfigAdmin() {
  const now = new Date();
  const { profile } = useAuth();
  const { toast } = useToast();
  const isAdmin = ["super_admin", "admin"].includes(profile?.role || "");

  const [month, setMonth] = useState(now.getMonth() + 1);
  const [year, setYear] = useState(now.getFullYear());

  const [createOpen, setCreateOpen] = useState(false);
  const [createName, setCreateName] = useState("");
  const [createSourceId, setCreateSourceId] = useState<string>("none");
  const [renameTarget, setRenameTarget] = useState<ConfigListItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleteTarget, setDeleteTarget] = useState<ConfigListItem | null>(null);
  const [editTargetId, setEditTargetId] = useState<string | null>(null);

  const { data: allConfigs, isLoading, isError } = useQuery<ConfigListItem[]>({
    queryKey: ["/api/incentivazione/configs"],
    enabled: isAdmin,
  });

  const periodConfigs = useMemo(
    () => (allConfigs ?? []).filter((c) => c.month === month && c.year === year),
    [allConfigs, month, year],
  );

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["/api/incentivazione/configs"] });
    queryClient.invalidateQueries({ queryKey: ["/api/incentivazione/dashboard"] });
  };

  const createMut = useMutation({
    mutationFn: async () => {
      const body: Record<string, unknown> = { month, year, name: createName.trim() };
      if (createSourceId !== "none") body.sourceId = createSourceId;
      const res = await apiRequest("POST", "/api/incentivazione/configs", body);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configurazione creata" });
      setCreateOpen(false);
      setCreateName("");
      setCreateSourceId("none");
      invalidate();
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const renameMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/incentivazione/configs/${renameTarget!.id}`, { name: renameValue.trim() });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configurazione rinominata" });
      setRenameTarget(null);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const deleteMut = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("DELETE", `/api/incentivazione/configs/${deleteTarget!.id}`);
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configurazione eliminata" });
      setDeleteTarget(null);
      invalidate();
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const yearOptions = [now.getFullYear() - 1, now.getFullYear(), now.getFullYear() + 1];

  if (!isAdmin) {
    return (
      <div className="min-h-screen bg-background">
        <AppNavbar title="Incentivazione interna" />
        <div className="container mx-auto px-3 sm:px-6 py-10">
          <Card className="p-8 text-center text-sm text-muted-foreground">
            <AlertCircle className="h-6 w-6 mx-auto mb-2" />
            Sezione riservata agli amministratori.
          </Card>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <AppNavbar title="Incentivazione interna" />
      <div className="container mx-auto px-3 sm:px-6 py-5 space-y-5">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-bold tracking-tight flex items-center gap-2">
              <Medal className="h-5 w-5" /> Configurazioni gara
            </h2>
            <p className="text-sm text-muted-foreground">
              Gestisci le gare del periodo: crea, duplica, rinomina e modifica le regole.
              Le valenze Excel restano condivise tra le gare dello stesso mese.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Link href="/incentivazione-interna">
              <Button variant="ghost" size="sm" data-testid="link-back-dashboard">
                <ArrowLeft className="h-4 w-4 mr-1" /> Dashboard
              </Button>
            </Link>
            <Select value={String(month)} onValueChange={(v) => setMonth(parseInt(v, 10))}>
              <SelectTrigger className="w-[140px]" data-testid="select-config-month"><SelectValue /></SelectTrigger>
              <SelectContent>
                {MONTHS.map((m, i) => (
                  <SelectItem key={i} value={String(i + 1)}>{m}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Select value={String(year)} onValueChange={(v) => setYear(parseInt(v, 10))}>
              <SelectTrigger className="w-[100px]" data-testid="select-config-year"><SelectValue /></SelectTrigger>
              <SelectContent>
                {yearOptions.map((y) => (
                  <SelectItem key={y} value={String(y)}>{y}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" onClick={() => { setCreateName(""); setCreateSourceId("none"); setCreateOpen(true); }} data-testid="button-create-config">
              <Plus className="h-4 w-4 mr-1" /> Nuova gara
            </Button>
          </div>
        </div>

        {isError && (
          <Card className="p-4 flex items-center gap-2 text-sm text-red-600">
            <AlertCircle className="h-4 w-4" /> Errore nel caricamento delle configurazioni.
          </Card>
        )}

        {isLoading ? (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {Array.from({ length: 3 }).map((_, i) => <Skeleton key={i} className="h-28" />)}
          </div>
        ) : periodConfigs.length === 0 ? (
          <Card className="p-10 text-center text-sm text-muted-foreground" data-testid="text-no-configs">
            Nessuna configurazione per {MONTHS[month - 1]} {year}.
            Creane una con "Nuova gara": finché non esiste, la dashboard usa le regole di default.
          </Card>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {periodConfigs.map((c, idx) => (
              <Card key={c.id} className="p-4 space-y-3" data-testid={`card-config-${c.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="font-semibold truncate" data-testid={`text-config-name-${c.id}`}>{c.name}</div>
                  {idx === 0 && <Badge variant="secondary">Predefinita</Badge>}
                </div>
                <div className="text-xs text-muted-foreground">
                  {MONTHS[c.month - 1]} {c.year}
                  {c.updatedAt && <> · agg. {new Date(c.updatedAt).toLocaleDateString("it-IT")}</>}
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <Button size="sm" variant="outline" onClick={() => setEditTargetId(c.id)} data-testid={`button-edit-rules-${c.id}`}>
                    <Settings className="h-3.5 w-3.5 mr-1" /> Regole
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setRenameTarget(c); setRenameValue(c.name); }} data-testid={`button-rename-${c.id}`}>
                    <Pencil className="h-3.5 w-3.5 mr-1" /> Rinomina
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setCreateName(`${c.name} (copia)`); setCreateSourceId(c.id); setCreateOpen(true); }} data-testid={`button-duplicate-${c.id}`}>
                    <Copy className="h-3.5 w-3.5 mr-1" /> Duplica
                  </Button>
                  <Button size="sm" variant="ghost" className="text-red-600 hover:text-red-600" onClick={() => setDeleteTarget(c)} data-testid={`button-delete-${c.id}`}>
                    <Trash2 className="h-3.5 w-3.5 mr-1" /> Elimina
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </div>

      {/* Create / duplicate dialog */}
      <Dialog open={createOpen} onOpenChange={setCreateOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Nuova gara · {MONTHS[month - 1]} {year}</DialogTitle>
          </DialogHeader>
          <div className="space-y-3">
            <div>
              <Label className="text-xs">Nome della gara</Label>
              <Input
                value={createName}
                onChange={(e) => setCreateName(e.target.value)}
                placeholder="Es. Gara Accessori, Spinta Fisso…"
                data-testid="input-config-name"
              />
            </div>
            <div>
              <Label className="text-xs">Copia regole da</Label>
              <Select value={createSourceId} onValueChange={setCreateSourceId}>
                <SelectTrigger data-testid="select-config-source"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Regole di default</SelectItem>
                  {(allConfigs ?? []).map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name} · {MONTHS[c.month - 1]} {c.year}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setCreateOpen(false)}>Annulla</Button>
            <Button onClick={() => createMut.mutate()} disabled={!createName.trim() || createMut.isPending} data-testid="button-confirm-create">
              {createMut.isPending ? "Creo…" : "Crea"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Rename dialog */}
      <Dialog open={!!renameTarget} onOpenChange={(o) => { if (!o) setRenameTarget(null); }}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Rinomina gara</DialogTitle>
          </DialogHeader>
          <div>
            <Label className="text-xs">Nuovo nome</Label>
            <Input value={renameValue} onChange={(e) => setRenameValue(e.target.value)} data-testid="input-rename" />
          </div>
          <DialogFooter>
            <Button variant="ghost" onClick={() => setRenameTarget(null)}>Annulla</Button>
            <Button onClick={() => renameMut.mutate()} disabled={!renameValue.trim() || renameMut.isPending} data-testid="button-confirm-rename">
              {renameMut.isPending ? "Salvo…" : "Rinomina"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Delete confirm */}
      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare "{deleteTarget?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              Le regole di questa gara verranno eliminate. Le valenze Excel del mese
              restano condivise e NON vengono toccate.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Annulla</AlertDialogCancel>
            <AlertDialogAction
              className="bg-red-600 hover:bg-red-700"
              onClick={() => deleteMut.mutate()}
              data-testid="button-confirm-delete"
            >
              {deleteMut.isPending ? "Elimino…" : "Elimina"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Rules editor */}
      {editTargetId && (
        <RulesEditorDialog
          configId={editTargetId}
          onClose={() => setEditTargetId(null)}
          onSaved={() => { setEditTargetId(null); invalidate(); }}
        />
      )}
    </div>
  );
}

// ── Rules editor (ex ConfigEditor della dashboard, ora per-configurazione) ──
function RulesEditorDialog(props: { configId: string; onClose: () => void; onSaved: () => void }) {
  const { configId, onClose, onSaved } = props;
  const { toast } = useToast();

  const { data, isLoading } = useQuery<ConfigDetail>({
    queryKey: ["/api/incentivazione/configs", configId],
  });

  return (
    <Dialog open onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent className="max-w-3xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>
            {data ? <>Regole · {data.name} · {MONTHS[data.month - 1]} {data.year}</> : "Regole gara"}
          </DialogTitle>
        </DialogHeader>
        {isLoading || !data ? (
          <div className="space-y-3">
            <Skeleton className="h-10" />
            <Skeleton className="h-40" />
          </div>
        ) : (
          <RulesEditorForm detail={data} onClose={onClose} onSaved={onSaved} toast={toast} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function RulesEditorForm(props: {
  detail: ConfigDetail;
  onClose: () => void;
  onSaved: () => void;
  toast: ReturnType<typeof useToast>["toast"];
}) {
  const { detail, onClose, onSaved, toast } = props;
  const initial = useMemo(
    () => normalizeConfig(detail.config ?? defaultConfig(detail.year), detail.year),
    [detail],
  );
  const [draft, setDraft] = useState<IncentivazioneConfig>(() => JSON.parse(JSON.stringify(initial)));
  const [editSection, setEditSection] = useState(initial.sections[0]?.id ?? "ss_w3");

  const save = useMutation({
    mutationFn: async () => {
      const res = await apiRequest("PATCH", `/api/incentivazione/configs/${detail.id}`, { config: draft });
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Configurazione salvata" });
      queryClient.invalidateQueries({ queryKey: ["/api/incentivazione/configs", detail.id] });
      onSaved();
    },
    onError: (e: any) => toast({ title: "Errore", description: String(e.message || e), variant: "destructive" }),
  });

  const updateSection = (id: string, patch: Partial<Section>) => {
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.id === id ? { ...s, ...patch } : s) }));
  };
  const updateTrack = (sid: string, tid: string, patch: Partial<Track>) => {
    setDraft((d) => ({
      ...d,
      sections: d.sections.map((s) => s.id === sid
        ? { ...s, tracks: s.tracks.map((t) => t.id === tid ? { ...t, ...patch } : t) }
        : s),
    }));
  };
  const addTrack = (sid: string) => {
    const newTrack: Track = { id: `track_${Date.now()}`, name: "Nuova pista", target: 1, unit: "pz", isLock: false };
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.id === sid ? { ...s, tracks: [...s.tracks, newTrack] } : s) }));
  };
  const removeTrack = (sid: string, tid: string) => {
    setDraft((d) => ({ ...d, sections: d.sections.map((s) => s.id === sid ? { ...s, tracks: s.tracks.filter((t) => t.id !== tid) } : s) }));
  };

  const sec = draft.sections.find((s) => s.id === editSection) || draft.sections[0];

  return (
    <>
      {/* Global cats */}
      <div className="grid sm:grid-cols-2 gap-3">
        <div>
          <Label className="text-xs">Categorie Accessori (id, separati da virgola)</Label>
          <Input
            value={draft.catAcc.join(",")}
            onChange={(e) => setDraft((d) => ({ ...d, catAcc: parseIds(e.target.value) }))}
            data-testid="input-cat-acc"
          />
        </div>
        <div>
          <Label className="text-xs">Categorie Servizi (id, separati da virgola)</Label>
          <Input
            value={draft.catServ.join(",")}
            onChange={(e) => setDraft((d) => ({ ...d, catServ: parseIds(e.target.value) }))}
            data-testid="input-cat-serv"
          />
        </div>
      </div>

      {/* Section selector */}
      <div className="flex flex-wrap gap-1">
        {draft.sections.map((s) => (
          <Button key={s.id} variant={editSection === s.id ? "secondary" : "ghost"} size="sm" onClick={() => setEditSection(s.id)}>
            {s.op} · {s.label}
          </Button>
        ))}
      </div>

      {sec && (
        <div className="space-y-3 border rounded-lg p-3">
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex items-center gap-2">
              <Label className="text-xs">Attiva (ready)</Label>
              <Switch checked={sec.ready} onCheckedChange={(v) => updateSection(sec.id, { ready: v })} data-testid={`switch-ready-${sec.id}`} />
            </div>
            <div className="flex items-center gap-2">
              <Label className="text-xs">Base €</Label>
              <Input
                type="number"
                className="w-24 h-8"
                value={sec.base ?? ""}
                onChange={(e) => updateSection(sec.id, { base: e.target.value === "" ? null : Number(e.target.value) })}
                data-testid={`input-base-${sec.id}`}
              />
            </div>
            <Button variant="outline" size="sm" onClick={() => addTrack(sec.id)}><Plus className="h-4 w-4 mr-1" /> Pista</Button>
          </div>

          <div className="space-y-2">
            {sec.tracks.map((t) => (
              <div key={t.id} className="grid grid-cols-12 gap-2 items-center text-xs">
                <Input className="col-span-4 h-8" value={t.name} onChange={(e) => updateTrack(sec.id, t.id, { name: e.target.value })} placeholder="Nome" />
                <Input className="col-span-2 h-8" type="number" value={t.target} onChange={(e) => updateTrack(sec.id, t.id, { target: Number(e.target.value) })} placeholder="Target" />
                <Input className="col-span-1 h-8" value={t.unit} onChange={(e) => updateTrack(sec.id, t.id, { unit: e.target.value })} placeholder="u." />
                <Input className="col-span-1 h-8" value={t.excelCol ?? ""} onChange={(e) => updateTrack(sec.id, t.id, { excelCol: e.target.value.toUpperCase() || undefined })} placeholder="Col" disabled={t.live} />
                <label className="col-span-1 flex items-center gap-1" title="Lucchetto bloccante">
                  <Switch checked={t.isLock} onCheckedChange={(v) => updateTrack(sec.id, t.id, { isLock: v })} /> 🔒
                </label>
                <label className="col-span-1 flex items-center gap-1" title="Sotto-pista (non conta nello stato)">
                  <Switch checked={!!t.sub} onCheckedChange={(v) => updateTrack(sec.id, t.id, { sub: v })} /> sub
                </label>
                <label className="col-span-1 flex items-center gap-1" title="Dato live da BiSuite">
                  <Switch checked={!!t.live} onCheckedChange={(v) => updateTrack(sec.id, t.id, { live: v })} /> live
                </label>
                <Button variant="ghost" size="icon" className="col-span-1 h-8 w-8" onClick={() => removeTrack(sec.id, t.id)}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
            {sec.tracks.length === 0 && <div className="text-xs text-muted-foreground">Nessuna pista. Aggiungine una.</div>}
          </div>
        </div>
      )}

      <DialogFooter>
        <Button variant="ghost" onClick={onClose}>Annulla</Button>
        <Button onClick={() => save.mutate()} disabled={save.isPending} data-testid="button-save-config">
          {save.isPending ? "Salvo…" : "Salva configurazione"}
        </Button>
      </DialogFooter>
    </>
  );
}

function parseIds(s: string): number[] {
  return s.split(",").map((x) => parseInt(x.trim(), 10)).filter((n) => !Number.isNaN(n));
}
