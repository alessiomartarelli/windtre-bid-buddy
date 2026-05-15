import { QueryClient, QueryFunction } from "@tanstack/react-query";
import { BASE_PATH } from "./basePath";

async function throwIfResNotOk(res: Response) {
  if (!res.ok) {
    const text = (await res.text()) || res.statusText;
    throw new Error(`${res.status}: ${text}`);
  }
}

export async function apiRequest(
  method: string,
  url: string,
  data?: unknown | undefined,
): Promise<Response> {
  const fullUrl = url.startsWith('/') ? `${BASE_PATH}${url}` : url;
  const res = await fetch(fullUrl, {
    method,
    headers: data ? { "Content-Type": "application/json" } : {},
    body: data ? JSON.stringify(data) : undefined,
    credentials: "include",
  });

  await throwIfResNotOk(res);
  return res;
}

type UnauthorizedBehavior = "returnNull" | "throw";
export const getQueryFn: <T>(options: {
  on401: UnauthorizedBehavior;
}) => QueryFunction<T> =
  ({ on401: unauthorizedBehavior }) =>
  async ({ queryKey }) => {
    const url = queryKey.join("/") as string;
    const fullUrl = url.startsWith('/') ? `${BASE_PATH}${url}` : url;
    const res = await fetch(fullUrl, {
      credentials: "include",
    });

    if (unauthorizedBehavior === "returnNull" && res.status === 401) {
      return null;
    }

    await throwIfResNotOk(res);
    return await res.json();
  };

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      queryFn: getQueryFn({ on401: "throw" }),
      refetchInterval: false,
      refetchOnWindowFocus: false,
      // Tempo "stale" predefinito: 60s. Le navigazioni interne in <1 minuto
      // riusano la cache senza refetch (UX più rapida), mentre dopo 60s
      // i dati vengono rinfrescati al mount/focus successivo. Le pagine che
      // hanno bisogno di freschezza diversa possono passare il proprio
      // staleTime nella useQuery.
      staleTime: 60_000,
      gcTime: 5 * 60_000,
      retry: false,
    },
    mutations: {
      retry: false,
    },
  },
});
