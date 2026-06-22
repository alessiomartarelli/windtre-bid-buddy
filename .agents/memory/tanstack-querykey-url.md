---
name: TanStack default fetcher builds URL from queryKey via join("/")
description: queryKey array segments become URL path segments, not query params
---

The app's default `getQueryFn` (client/src/lib/queryClient.ts) builds the
request URL as `queryKey.join("/")`. So a queryKey like
`["/api/x/dashboard", month, year]` requests `/api/x/dashboard/6/2026`
(path segments), NOT `/api/x/dashboard?month=6&year=2026`.

**How to apply:** when adding a new query, the matching Express route must read
**path params** (`/api/x/dashboard/:month/:year`, `req.params`), not query
params. A mismatch yields a 404 even though the POST that saves data works.
Keep array queryKeys for clean cache invalidation by prefix.
