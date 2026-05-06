import { useEffect, useState } from 'react';
import {
  Dialog, DialogContent, DialogDescription, DialogFooter,
  DialogHeader, DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Switch } from '@/components/ui/switch';
import { Label } from '@/components/ui/label';
import { Loader2 } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { apiUrl } from '@/lib/basePath';
import { MODULES, defaultEnabledModules } from '@shared/modules';

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  organizationId: string;
  organizationName: string;
}

export function ModulesDialog({ open, onOpenChange, organizationId, organizationName }: Props) {
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [flags, setFlags] = useState<Record<string, boolean>>(defaultEnabledModules());

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    fetch(apiUrl(`/api/super-admin/organizations/${organizationId}/modules`), { credentials: 'include' })
      .then(r => r.json())
      .then(data => {
        const stored = (data.enabledModules || {}) as Record<string, boolean>;
        const merged = defaultEnabledModules();
        for (const k of Object.keys(merged)) {
          if (k in stored) merged[k] = stored[k] !== false;
        }
        setFlags(merged);
      })
      .catch(() => toast({ title: 'Errore', description: 'Impossibile caricare moduli', variant: 'destructive' }))
      .finally(() => setLoading(false));
  }, [open, organizationId, toast]);

  const handleToggle = (key: string, value: boolean) => {
    setFlags(prev => ({ ...prev, [key]: value }));
  };

  const handleSave = async () => {
    setSaving(true);
    const res = await fetch(apiUrl(`/api/super-admin/organizations/${organizationId}/modules`), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ enabledModules: flags }),
    });
    setSaving(false);
    if (res.ok) {
      toast({ title: 'Moduli aggiornati', description: organizationName });
      onOpenChange(false);
    } else {
      const data = await res.json().catch(() => ({}));
      toast({ title: 'Errore', description: data?.message || 'Errore salvataggio', variant: 'destructive' });
    }
  };

  const pagine = MODULES.filter(m => m.group === 'pagine' && !m.superOnly);
  const prodotti = MODULES.filter(m => m.group === 'prodotti');

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Moduli abilitati</DialogTitle>
          <DialogDescription>{organizationName}</DialogDescription>
        </DialogHeader>

        {loading ? (
          <div className="flex justify-center py-8">
            <Loader2 className="h-6 w-6 animate-spin" />
          </div>
        ) : (
          <div className="space-y-6 py-2">
            <section>
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Pagine</h3>
              <div className="space-y-3">
                {pagine.map(m => (
                  <div key={m.key} className="flex items-center justify-between">
                    <div className="space-y-0.5">
                      <Label htmlFor={`mod-${m.key}`} className="text-sm font-medium">{m.label}</Label>
                      {m.description && <p className="text-xs text-muted-foreground">{m.description}</p>}
                    </div>
                    <Switch
                      id={`mod-${m.key}`}
                      checked={flags[m.key] !== false}
                      onCheckedChange={(v) => handleToggle(m.key, v)}
                      data-testid={`switch-module-${m.key}`}
                    />
                  </div>
                ))}
              </div>
            </section>

            <section>
              <h3 className="text-sm font-semibold mb-3 text-muted-foreground uppercase tracking-wide">Prodotti del simulatore</h3>
              <div className="space-y-3">
                {prodotti.map(m => (
                  <div key={m.key} className="flex items-center justify-between">
                    <Label htmlFor={`mod-${m.key}`} className="text-sm font-medium">{m.label}</Label>
                    <Switch
                      id={`mod-${m.key}`}
                      checked={flags[m.key] !== false}
                      onCheckedChange={(v) => handleToggle(m.key, v)}
                      data-testid={`switch-module-${m.key}`}
                    />
                  </div>
                ))}
              </div>
            </section>
          </div>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>Annulla</Button>
          <Button onClick={handleSave} disabled={loading || saving} data-testid="button-save-modules">
            {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Salva
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
