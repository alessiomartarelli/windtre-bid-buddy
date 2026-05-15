// Sezione Categorie (Task #145).
// CRUD categorie E/U con color picker. Sorgente: index.html ~righe 3252-3268.
// La cancellazione NON tocca le transazioni esistenti (compat iframe).

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Plus, Trash2 } from "lucide-react";
import type { FinplanCategory, FinplanCompanySnapshot, FinplanSnapshot, TxType } from "@shared/finplanSchema";
import type { FinplanUpdater } from "@/hooks/useFinplan";

const DEFAULT_COLORS = ["#10B981", "#3B82F6", "#8B5CF6", "#F59E0B", "#EF4444", "#EC4899", "#14B8A6", "#6366F1"];

interface Props {
  snapshot: FinplanSnapshot | null;
  companyIndex: number;
  scheduleSave: (s: FinplanSnapshot | FinplanUpdater) => void;
}

function patchCo(prev: FinplanSnapshot | null, snapshot: FinplanSnapshot | null, ci: number, fn: (co: FinplanCompanySnapshot) => FinplanCompanySnapshot) {
  const base: FinplanSnapshot = prev && prev.data ? prev : (snapshot ?? { data: [] });
  const data = (base.data ?? []).slice();
  data[ci] = fn(data[ci] ?? {});
  return { ...base, data };
}

function newCatId(existing: FinplanCategory[], type: TxType): string {
  const prefix = type === "E" ? "e" : "u";
  let n = existing.length + 1;
  while (existing.some(c => c.id === `${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export function Categorie({ snapshot, companyIndex, scheduleSave }: Props) {
  const co = snapshot?.data?.[companyIndex];
  const cats = (co?.cats ?? []) as FinplanCategory[];
  const usageCount = (catId: string) =>
    (co?.transactions ?? []).filter(t => t.catId === catId).length;

  const addCat = (type: TxType, name: string, color: string) => {
    if (!name.trim()) return;
    scheduleSave(prev => patchCo(prev, snapshot, companyIndex, c => {
      const list = ((c.cats ?? []) as FinplanCategory[]).slice();
      list.push({ id: newCatId(list, type), name: name.trim(), type, color });
      return { ...c, cats: list };
    }));
  };

  const updateCat = (id: string, patch: Partial<FinplanCategory>) => {
    scheduleSave(prev => patchCo(prev, snapshot, companyIndex, c => ({
      ...c,
      cats: ((c.cats ?? []) as FinplanCategory[]).map(x => x.id === id ? { ...x, ...patch } : x),
    })));
  };

  const removeCat = (id: string) => {
    scheduleSave(prev => patchCo(prev, snapshot, companyIndex, c => ({
      ...c,
      cats: ((c.cats ?? []) as FinplanCategory[]).filter(x => x.id !== id),
    })));
  };

  return (
    <div data-testid="finplan-categorie">
      <Tabs defaultValue="E">
        <TabsList>
          <TabsTrigger value="E" data-testid="tab-cats-E">Entrate ({cats.filter(c => c.type === "E").length})</TabsTrigger>
          <TabsTrigger value="U" data-testid="tab-cats-U">Uscite ({cats.filter(c => c.type === "U").length})</TabsTrigger>
        </TabsList>
        {(["E", "U"] as TxType[]).map(type => (
          <TabsContent key={type} value={type} className="mt-4">
            <CatList
              type={type}
              cats={cats.filter(c => c.type === type)}
              usageCount={usageCount}
              onAdd={addCat}
              onUpdate={updateCat}
              onRemove={removeCat}
            />
          </TabsContent>
        ))}
      </Tabs>
    </div>
  );
}

interface CatListProps {
  type: TxType;
  cats: FinplanCategory[];
  usageCount: (id: string) => number;
  onAdd: (type: TxType, name: string, color: string) => void;
  onUpdate: (id: string, patch: Partial<FinplanCategory>) => void;
  onRemove: (id: string) => void;
}

function CatList({ type, cats, usageCount, onAdd, onUpdate, onRemove }: CatListProps) {
  const [draftName, setDraftName] = useState("");
  const [draftColor, setDraftColor] = useState(DEFAULT_COLORS[0]);

  const submit = () => {
    if (!draftName.trim()) return;
    onAdd(type, draftName, draftColor);
    setDraftName("");
  };

  return (
    <div className="space-y-3">
      <Card>
        <CardHeader className="pb-2"><CardTitle className="text-sm">Aggiungi categoria {type === "E" ? "Entrate" : "Uscite"}</CardTitle></CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-12 gap-2">
            <div className="md:col-span-7 space-y-1">
              <Label className="text-xs">Nome</Label>
              <Input value={draftName} onChange={e => setDraftName(e.target.value)} className="h-8" placeholder="es. Servizi cloud" data-testid={`input-cat-name-${type}`} />
            </div>
            <div className="md:col-span-3 space-y-1">
              <Label className="text-xs">Colore</Label>
              <div className="flex items-center gap-2">
                <Input type="color" value={draftColor} onChange={e => setDraftColor(e.target.value)} className="h-8 w-14 p-1" data-testid={`input-cat-color-${type}`} />
                <span className="text-xs font-mono text-muted-foreground">{draftColor}</span>
              </div>
            </div>
            <div className="md:col-span-2 flex items-end">
              <Button onClick={submit} size="sm" className="w-full" data-testid={`button-cat-add-${type}`}>
                <Plus className="h-3.5 w-3.5 mr-1" /> Aggiungi
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-3 space-y-2">
          {cats.length === 0 ? (
            <p className="text-sm text-muted-foreground" data-testid={`text-no-cats-${type}`}>Nessuna categoria di tipo {type}.</p>
          ) : cats.map(c => {
            const used = usageCount(c.id);
            return (
              <div key={c.id} className="flex items-center gap-2 rounded border p-2" data-testid={`row-cat-${c.id}`}>
                <Input
                  type="color"
                  defaultValue={c.color ?? "#64748B"}
                  onBlur={e => onUpdate(c.id, { color: e.target.value })}
                  className="h-8 w-12 p-1"
                  data-testid={`input-cat-color-edit-${c.id}`}
                />
                <Input
                  defaultValue={c.name ?? ""}
                  onBlur={e => onUpdate(c.id, { name: e.target.value })}
                  className="h-8 flex-1"
                  data-testid={`input-cat-name-edit-${c.id}`}
                />
                <Badge variant="outline" className="text-[10px] font-mono">{c.id}</Badge>
                <Badge variant="secondary" className="text-[10px]">{used} tx</Badge>
                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7"
                  onClick={() => {
                    if (used > 0 && !confirm(`La categoria "${c.name}" è usata da ${used} transazioni. Le transazioni resteranno con catId orfano. Procedere?`)) return;
                    onRemove(c.id);
                  }}
                  data-testid={`button-cat-del-${c.id}`}
                >
                  <Trash2 className="h-3.5 w-3.5 text-rose-500" />
                </Button>
              </div>
            );
          })}
        </CardContent>
      </Card>
    </div>
  );
}
