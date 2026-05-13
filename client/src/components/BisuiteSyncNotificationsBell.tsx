import { useState } from 'react';
import { useLocation } from 'wouter';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Bell, AlertTriangle, XCircle, ExternalLink, CheckCheck } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { ScrollArea } from '@/components/ui/scroll-area';
import { apiRequest, queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';

interface BisuiteSyncNotification {
  id: string;
  organizationId: string;
  status: 'partial' | 'failed' | string;
  failedMonths: string[] | null;
  errorMessage: string | null;
  createdAt: string;
  readAt: string | null;
}

interface NotificationsResponse {
  items: BisuiteSyncNotification[];
  unread: number;
}

function formatTs(iso: string): string {
  try {
    return new Intl.DateTimeFormat('it-IT', {
      dateStyle: 'short',
      timeStyle: 'short',
    }).format(new Date(iso));
  } catch {
    return iso;
  }
}

export function BisuiteSyncNotificationsBell() {
  const [, setLocation] = useLocation();
  const [open, setOpen] = useState(false);
  const { toast } = useToast();

  const { data } = useQuery<NotificationsResponse>({
    queryKey: ['/api/bisuite-notifications'],
    refetchInterval: 60_000,
    staleTime: 30_000,
  });

  const items = data?.items ?? [];
  const unread = data?.unread ?? 0;

  const markRead = useMutation({
    mutationFn: async (id: string) => {
      await apiRequest('POST', `/api/bisuite-notifications/${id}/read`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bisuite-notifications'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Errore aggiornamento notifica';
      toast({ title: 'Errore', description: msg, variant: 'destructive' });
    },
  });

  const markAllRead = useMutation({
    mutationFn: async () => {
      await apiRequest('POST', '/api/bisuite-notifications/mark-all-read');
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/bisuite-notifications'] });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : 'Errore aggiornamento notifiche';
      toast({ title: 'Errore', description: msg, variant: 'destructive' });
    },
  });

  const goToVendite = (notif: BisuiteSyncNotification) => {
    if (!notif.readAt) {
      markRead.mutate(notif.id);
    }
    setOpen(false);
    setLocation('/vendite-bisuite');
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative h-9 w-9 rounded-lg"
          data-testid="button-bisuite-notifications"
          aria-label="Notifiche sync BiSuite"
        >
          <Bell className="h-4 w-4" />
          {unread > 0 && (
            <Badge
              variant="destructive"
              className="absolute -top-0.5 -right-0.5 h-4 min-w-4 px-1 text-[10px] leading-none flex items-center justify-center rounded-full"
              data-testid="badge-bisuite-notifications-unread"
            >
              {unread > 9 ? '9+' : unread}
            </Badge>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96 p-0" data-testid="popover-bisuite-notifications">
        <div className="flex items-center justify-between px-4 py-3 border-b">
          <div>
            <p className="text-sm font-semibold">Sync BiSuite</p>
            <p className="text-xs text-muted-foreground">
              {unread > 0 ? `${unread} non lette` : 'Nessuna notifica nuova'}
            </p>
          </div>
          {unread > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="text-xs h-7"
              onClick={() => markAllRead.mutate()}
              disabled={markAllRead.isPending}
              data-testid="button-mark-all-bisuite-notifications-read"
            >
              <CheckCheck className="h-3.5 w-3.5 mr-1" />
              Segna tutte
            </Button>
          )}
        </div>
        <ScrollArea className="max-h-96">
          {items.length === 0 ? (
            <div className="p-6 text-center text-sm text-muted-foreground" data-testid="text-no-bisuite-notifications">
              Nessuna sync notturna BiSuite con problemi.
            </div>
          ) : (
            <ul className="divide-y">
              {items.map((n) => {
                const isFailed = n.status === 'failed';
                const Icon = isFailed ? XCircle : AlertTriangle;
                const tone = isFailed ? 'text-red-600' : 'text-amber-600';
                const months = Array.isArray(n.failedMonths) ? n.failedMonths : [];
                return (
                  <li
                    key={n.id}
                    className={`px-4 py-3 hover:bg-muted/50 transition-colors ${n.readAt ? 'opacity-70' : ''}`}
                    data-testid={`item-bisuite-notification-${n.id}`}
                  >
                    <div className="flex items-start gap-2">
                      <Icon className={`h-4 w-4 mt-0.5 shrink-0 ${tone}`} />
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center justify-between gap-2">
                          <p className="text-sm font-medium">
                            {isFailed ? 'Sync fallita' : 'Sync parziale'}
                          </p>
                          <span className="text-[11px] text-muted-foreground shrink-0">
                            {formatTs(n.createdAt)}
                          </span>
                        </div>
                        {isFailed ? (
                          <p className="text-xs text-muted-foreground mt-0.5 break-words">
                            {n.errorMessage || 'Errore sconosciuto'}
                          </p>
                        ) : months.length > 0 ? (
                          <p className="text-xs text-muted-foreground mt-0.5 break-words">
                            Mesi mancanti: <span className="font-medium text-foreground">{months.join(', ')}</span>
                          </p>
                        ) : (
                          <p className="text-xs text-muted-foreground mt-0.5">
                            Alcuni chunk non sono stati scaricati.
                          </p>
                        )}
                        <div className="flex items-center gap-2 mt-2">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-7 text-xs"
                            onClick={() => goToVendite(n)}
                            data-testid={`button-go-vendite-${n.id}`}
                          >
                            <ExternalLink className="h-3 w-3 mr-1" />
                            Vai a Vendite BiSuite
                          </Button>
                          {!n.readAt && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-7 text-xs"
                              onClick={() => markRead.mutate(n.id)}
                              disabled={markRead.isPending}
                              data-testid={`button-mark-read-${n.id}`}
                            >
                              Segna letta
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </ScrollArea>
      </PopoverContent>
    </Popover>
  );
}
