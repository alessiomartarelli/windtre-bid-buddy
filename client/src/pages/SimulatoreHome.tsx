import { useMemo, useState } from "react";
import { DataTableSkeleton } from "@/components/skeletons";
import { useLocation } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useToast } from "@/hooks/use-toast";
import { apiUrl } from "@/lib/basePath";
import { AppNavbar } from "@/components/AppNavbar";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  FilePlus,
  FolderOpen,
  Loader2,
  Search,
  Trash2,
  Clock,
  Calendar,
  User as UserIcon,
  AlertCircle,
} from "lucide-react";

interface PreventivoListItem {
  id: string;
  name: string;
  organizationId: string;
  createdBy: string;
  createdByName?: string | null;
  createdByEmail?: string | null;
  createdAt: string;
  updatedAt: string;
  data?: any;
}

function formatDate(iso?: string | null): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return new Intl.DateTimeFormat("it-IT", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    }).format(d);
  } catch {
    return "—";
  }
}

export default function SimulatoreHome() {
  const [, setLocation] = useLocation();
  const { profile, loading: authLoading } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState("");
  const [toDelete, setToDelete] = useState<PreventivoListItem | null>(null);

  const { data, isLoading, isError, refetch, isFetching } = useQuery<PreventivoListItem[]>({
    queryKey: ["/api/preventivi"],
    queryFn: async () => {
      const res = await fetch(apiUrl("/api/preventivi"), { credentials: "include" });
      if (!res.ok) throw new Error("Errore nel caricamento delle simulazioni");
      return res.json();
    },
    enabled: !authLoading,
  });

  const showLoading = authLoading || isLoading;

  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(apiUrl(`/api/preventivi/${id}`), {
        method: "DELETE",
        credentials: "include",
      });
      if (!res.ok && res.status !== 204) {
        throw new Error("Errore durante l'eliminazione");
      }
    },
    onSuccess: () => {
      toast({ title: "Simulazione eliminata" });
      queryClient.invalidateQueries({ queryKey: ["/api/preventivi"] });
      setToDelete(null);
    },
    onError: (err: Error) => {
      toast({
        title: "Errore",
        description: err.message,
        variant: "destructive",
      });
    },
  });

  const sorted = useMemo(() => {
    const list = (data ?? []).slice();
    list.sort((a, b) => {
      const ta = new Date(a.updatedAt || a.createdAt || 0).getTime();
      const tb = new Date(b.updatedAt || b.createdAt || 0).getTime();
      return tb - ta;
    });
    if (!search.trim()) return list;
    const q = search.trim().toLowerCase();
    return list.filter((p) => (p.name || "").toLowerCase().includes(q));
  }, [data, search]);

  const goToNew = () => setLocation("/preventivatore?new=true");
  const openSim = (id: string) => setLocation(`/preventivatore?id=${encodeURIComponent(id)}`);

  return (
    <div className="min-h-screen">
      <AppNavbar title="Simulatore" />
      <main className="container mx-auto px-3 sm:px-6 py-6 space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-end sm:justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
              <FolderOpen className="h-6 w-6 text-primary" />
              Simulazioni
            </h1>
            <p className="text-sm text-muted-foreground mt-1">
              Apri una simulazione esistente o avviane una nuova.
            </p>
          </div>
          <Button
            size="lg"
            onClick={goToNew}
            data-testid="button-nuova-simulazione"
            className="shrink-0"
          >
            <FilePlus className="h-4 w-4 mr-2" />
            Nuova Simulazione
          </Button>
        </div>

        <Card>
          <CardContent className="p-4 sm:p-6 space-y-4">
            <div className="flex flex-col sm:flex-row gap-2 sm:items-center sm:justify-between">
              <div className="relative w-full sm:max-w-sm">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Cerca per nome..."
                  className="pl-9"
                  data-testid="input-search-simulazioni"
                />
              </div>
              <div className="text-xs text-muted-foreground">
                {showLoading
                  ? "Caricamento..."
                  : `${sorted.length} ${sorted.length === 1 ? "simulazione" : "simulazioni"}${
                      search ? " filtrate" : ""
                    }`}
              </div>
            </div>

            {showLoading ? (
              <DataTableSkeleton rows={6} columns={4} className="py-4" />
            ) : isError ? (
              <div className="flex flex-col items-center justify-center py-16 gap-3 text-center">
                <AlertCircle className="h-10 w-10 text-destructive" />
                <p className="text-sm text-muted-foreground">
                  Impossibile caricare le simulazioni.
                </p>
                <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
                  Riprova
                </Button>
              </div>
            ) : sorted.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16 gap-4 text-center">
                <FolderOpen className="h-12 w-12 text-muted-foreground/50" />
                <div>
                  <p className="font-medium">
                    {search ? "Nessuna simulazione trovata" : "Nessuna simulazione ancora"}
                  </p>
                  <p className="text-sm text-muted-foreground mt-1">
                    {search
                      ? "Prova a modificare il testo di ricerca."
                      : "Crea la prima simulazione per iniziare."}
                  </p>
                </div>
                {!search && (
                  <Button onClick={goToNew} data-testid="button-nuova-simulazione-empty">
                    <FilePlus className="h-4 w-4 mr-2" />
                    Crea la prima simulazione
                  </Button>
                )}
              </div>
            ) : (
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {sorted.map((p) => {
                  const isMine = profile?.id && p.createdBy === profile.id;
                  const authorLabel =
                    (p.createdByName && p.createdByName.trim()) ||
                    (p.createdByEmail && p.createdByEmail.trim()) ||
                    "Sconosciuto";
                  return (
                    <Card
                      key={p.id}
                      className="group hover-elevate cursor-pointer transition-all"
                      onClick={() => openSim(p.id)}
                      data-testid={`card-simulazione-${p.id}`}
                    >
                      <CardContent className="p-4 space-y-3">
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0 flex-1">
                            <h3
                              className="font-semibold truncate"
                              title={p.name}
                              data-testid={`text-sim-name-${p.id}`}
                            >
                              {p.name || "Senza nome"}
                            </h3>
                          </div>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 shrink-0 opacity-0 group-hover:opacity-100 transition-opacity"
                            onClick={(e) => {
                              e.stopPropagation();
                              setToDelete(p);
                            }}
                            data-testid={`button-delete-sim-${p.id}`}
                            title="Elimina"
                          >
                            <Trash2 className="h-4 w-4 text-destructive" />
                          </Button>
                        </div>

                        <div className="space-y-1.5 text-xs text-muted-foreground">
                          <div className="flex items-center gap-1.5">
                            <Clock className="h-3.5 w-3.5" />
                            <span>Aggiornata: {formatDate(p.updatedAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5">
                            <Calendar className="h-3.5 w-3.5" />
                            <span>Creata: {formatDate(p.createdAt)}</span>
                          </div>
                          <div className="flex items-center gap-1.5 min-w-0">
                            <UserIcon className="h-3.5 w-3.5 shrink-0" />
                            <span
                              className="truncate"
                              title={authorLabel}
                              data-testid={`text-sim-author-${p.id}`}
                            >
                              {authorLabel}
                            </span>
                            {isMine && (
                              <Badge
                                variant="outline"
                                className="text-[10px] py-0 px-1.5 h-4 shrink-0"
                                data-testid={`badge-sim-author-tu-${p.id}`}
                              >
                                Tu
                              </Badge>
                            )}
                          </div>
                        </div>

                        <div className="pt-2 border-t flex justify-end">
                          <Button
                            size="sm"
                            variant="ghost"
                            className="h-8 text-xs"
                            onClick={(e) => {
                              e.stopPropagation();
                              openSim(p.id);
                            }}
                            data-testid={`button-open-sim-${p.id}`}
                          >
                            <FolderOpen className="h-3.5 w-3.5 mr-1.5" />
                            Apri
                          </Button>
                        </div>
                      </CardContent>
                    </Card>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </main>

      <AlertDialog open={!!toDelete} onOpenChange={(open) => !open && setToDelete(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Eliminare la simulazione?</AlertDialogTitle>
            <AlertDialogDescription>
              Verrà eliminata definitivamente la simulazione
              {toDelete ? ` "${toDelete.name}"` : ""}. L'azione non può essere annullata.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deleteMutation.isPending}>Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={(e) => {
                e.preventDefault();
                if (toDelete) deleteMutation.mutate(toDelete.id);
              }}
              disabled={deleteMutation.isPending}
              data-testid="button-confirm-delete-sim"
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending ? (
                <>
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                  Eliminazione...
                </>
              ) : (
                "Elimina"
              )}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
