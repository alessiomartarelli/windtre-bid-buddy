---
name: Static asset precompression via build sidecars
description: Prod boot must never compress assets synchronously; use build-time .gz/.br sidecars + async warm-up fallback.
---

Rule: never run gzip-9/brotli-11 synchronously at server boot — on a multi-MB dist it costs many seconds and blocks the app after every restart.

**Why:** prod boot blew past its 2s budget (~15s of sync compression) and users saw connection errors after each deploy until sidecars were introduced.

**How to apply:**
- Deploy generates `.gz`/`.br` sidecars next to compressible static files at BUILD time; the server loads fresh sidecars from disk at boot (mtime freshness with ~2s slack for tar rounding, verified by decompress-and-compare).
- Files without sidecars must be compressed asynchronously in background after boot, never synchronously during startup.
- Sidecar generation rules (compressible regex, size thresholds, index.html skip) are duplicated between the build script and the server middleware: change both together.
- The static middleware must NOT serve `.gz`/`.br` URLs as raw assets.
