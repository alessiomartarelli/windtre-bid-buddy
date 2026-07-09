import { useEffect, useState } from 'react';
import { apiUrl } from '@/lib/basePath';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useToast } from '@/hooks/use-toast';
import { Loader2, Plus, Tag, Pencil, Trash2, Check, X } from 'lucide-react';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';

interface Organization {
  id: string;
  name: string;
}

interface Brand {
  id: string;
  name: string;
  orgCount: number;
}

// Card "Brand (operatori)" nel pannello super admin (Task #277):
// catalogo globale di brand + associazione multiselect (badge toggle) per org.
export function BrandsCard({ organizations }: { organizations: Organization[] }) {
  const { toast } = useToast();
  const [brands, setBrands] = useState<Brand[]>([]);
  const [orgBrandMap, setOrgBrandMap] = useState<Record<string, string[]>>({});
  const [loading, setLoading] = useState(true);
  const [newName, setNewName] = useState('');
  const [creating, setCreating] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingName, setEditingName] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<Brand | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [savingOrgId, setSavingOrgId] = useState<string | null>(null);

  const fetchAll = async () => {
    try {
      const [brandsRes, mapRes] = await Promise.all([
        fetch(apiUrl('/api/admin/brands'), { credentials: 'include' }),
        fetch(apiUrl('/api/admin/organization-brands'), { credentials: 'include' }),
      ]);
      if (brandsRes.ok) setBrands(await brandsRes.json());
      if (mapRes.ok) setOrgBrandMap(await mapRes.json());
    } catch (err) {
      console.error('Error fetching brands:', err);
    }
    setLoading(false);
  };

  useEffect(() => {
    fetchAll();
  }, []);

  const handleCreate = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = newName.trim();
    if (name.length < 2) {
      toast({ title: 'Nome troppo corto', description: 'Il nome brand deve avere almeno 2 caratteri', variant: 'destructive' });
      return;
    }
    setCreating(true);
    const res = await fetch(apiUrl('/api/admin/brands'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setCreating(false);
    if (!res.ok) {
      toast({ title: 'Errore', description: data?.message || 'Errore nella creazione del brand', variant: 'destructive' });
    } else {
      toast({ title: 'Brand creato', description: `Brand "${name}" creato` });
      setNewName('');
      fetchAll();
    }
  };

  const handleRename = async (brandId: string) => {
    const name = editingName.trim();
    if (name.length < 2) {
      toast({ title: 'Nome troppo corto', description: 'Il nome brand deve avere almeno 2 caratteri', variant: 'destructive' });
      return;
    }
    setBusyId(brandId);
    const res = await fetch(apiUrl(`/api/admin/brands/${brandId}`), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ name }),
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    if (!res.ok) {
      toast({ title: 'Errore', description: data?.message || 'Errore nella modifica del brand', variant: 'destructive' });
    } else {
      toast({ title: 'Brand rinominato', description: `Nuovo nome: "${name}"` });
      setEditingId(null);
      fetchAll();
    }
  };

  const handleDelete = async (brand: Brand) => {
    setBusyId(brand.id);
    const res = await fetch(apiUrl(`/api/admin/brands/${brand.id}`), {
      method: 'DELETE',
      credentials: 'include',
    });
    const data = await res.json().catch(() => ({}));
    setBusyId(null);
    setDeleteTarget(null);
    if (!res.ok) {
      toast({ title: 'Errore', description: data?.message || "Errore nell'eliminazione del brand", variant: 'destructive' });
    } else {
      toast({
        title: 'Brand eliminato',
        description: data?.removedAssociations > 0
          ? `"${brand.name}" eliminato (rimosse ${data.removedAssociations} associazioni)`
          : `"${brand.name}" eliminato`,
      });
      fetchAll();
    }
  };

  const toggleOrgBrand = async (orgId: string, brandId: string) => {
    const current = orgBrandMap[orgId] ?? [];
    const next = current.includes(brandId)
      ? current.filter((id) => id !== brandId)
      : [...current, brandId];
    setSavingOrgId(orgId);
    const res = await fetch(apiUrl(`/api/admin/organizations/${orgId}/brands`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ brandIds: next }),
    });
    const data = await res.json().catch(() => ({}));
    setSavingOrgId(null);
    if (!res.ok) {
      toast({ title: 'Errore', description: data?.message || 'Errore nel salvataggio dei brand', variant: 'destructive' });
    } else {
      setOrgBrandMap((prev) => ({ ...prev, [orgId]: data.brandIds ?? next }));
      // Aggiorna i contatori senza rifetch completo.
      fetchAll();
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Tag className="h-5 w-5" />
          Brand (operatori) ({brands.length})
        </CardTitle>
        <CardDescription>
          Catalogo globale degli operatori telefonici e associazione alle organizzazioni
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {loading ? (
          <div className="flex justify-center py-4">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <>
            {/* Crea brand */}
            <form onSubmit={handleCreate} className="flex gap-2">
              <Input
                placeholder="Nuovo brand (es. WindTre)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                data-testid="input-new-brand"
              />
              <Button type="submit" disabled={creating} data-testid="button-create-brand">
                {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
                <span className="ml-1 hidden sm:inline">Crea</span>
              </Button>
            </form>

            {/* Lista brand */}
            {brands.length === 0 ? (
              <p className="text-sm text-muted-foreground" data-testid="text-no-brands">
                Nessun brand creato. Aggiungi il primo (es. WindTre, Vodafone…).
              </p>
            ) : (
              <div className="space-y-2">
                {brands.map((b) => (
                  <div
                    key={b.id}
                    className="flex items-center gap-2 rounded-md border px-3 py-2"
                    data-testid={`row-brand-${b.id}`}
                  >
                    {editingId === b.id ? (
                      <>
                        <Input
                          value={editingName}
                          onChange={(e) => setEditingName(e.target.value)}
                          className="h-8"
                          autoFocus
                          data-testid={`input-rename-brand-${b.id}`}
                        />
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          disabled={busyId === b.id}
                          onClick={() => handleRename(b.id)}
                          data-testid={`button-save-rename-brand-${b.id}`}
                        >
                          {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => setEditingId(null)}
                          data-testid={`button-cancel-rename-brand-${b.id}`}
                        >
                          <X className="h-4 w-4" />
                        </Button>
                      </>
                    ) : (
                      <>
                        <span className="font-medium flex-1" data-testid={`text-brand-name-${b.id}`}>{b.name}</span>
                        <span className="text-xs text-muted-foreground">
                          {b.orgCount} org
                        </span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8"
                          onClick={() => { setEditingId(b.id); setEditingName(b.name); }}
                          title="Rinomina"
                          data-testid={`button-rename-brand-${b.id}`}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => setDeleteTarget(b)}
                          disabled={busyId === b.id}
                          title="Elimina"
                          data-testid={`button-delete-brand-${b.id}`}
                        >
                          {busyId === b.id ? <Loader2 className="h-4 w-4 animate-spin" /> : <Trash2 className="h-4 w-4" />}
                        </Button>
                      </>
                    )}
                  </div>
                ))}
              </div>
            )}

            {/* Associazione per organizzazione */}
            {brands.length > 0 && organizations.length > 0 && (
              <div className="space-y-3">
                <p className="text-sm font-medium">Brand per organizzazione</p>
                <p className="text-xs text-muted-foreground">
                  Clicca un brand per attivarlo/disattivarlo sull'organizzazione.
                </p>
                {organizations.map((org) => {
                  const selected = orgBrandMap[org.id] ?? [];
                  return (
                    <div key={org.id} className="rounded-md border px-3 py-2" data-testid={`row-org-brands-${org.id}`}>
                      <div className="flex items-center gap-2 mb-1.5">
                        <span className="text-sm font-medium">{org.name}</span>
                        {savingOrgId === org.id && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
                      </div>
                      <div className="flex flex-wrap gap-1.5">
                        {brands.map((b) => {
                          const active = selected.includes(b.id);
                          return (
                            <button
                              key={b.id}
                              type="button"
                              onClick={() => toggleOrgBrand(org.id, b.id)}
                              disabled={savingOrgId === org.id}
                              data-testid={`toggle-org-${org.id}-brand-${b.id}`}
                              className="disabled:opacity-60"
                            >
                              <Badge variant={active ? 'default' : 'outline'} className="cursor-pointer">
                                {b.name}
                              </Badge>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </CardContent>

      <AlertDialog open={!!deleteTarget} onOpenChange={(o) => { if (!o) setDeleteTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Elimina brand</AlertDialogTitle>
            <AlertDialogDescription>
              Sei sicuro di voler eliminare <strong>{deleteTarget?.name}</strong>?
              {deleteTarget && deleteTarget.orgCount > 0 && (
                <> Il brand è associato a {deleteTarget.orgCount} organizzazion{deleteTarget.orgCount === 1 ? 'e' : 'i'}: le associazioni verranno rimosse.</>
              )}
              {' '}L'azione è irreversibile.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel data-testid="button-cancel-delete-brand">Annulla</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => { if (deleteTarget) handleDelete(deleteTarget); }}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              data-testid="button-confirm-delete-brand"
            >
              Elimina
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  );
}
