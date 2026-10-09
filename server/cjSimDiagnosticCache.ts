import type { CjSimDetail, CjSimDiagnosticPage } from "../shared/customerJourneyDiagnostics";

// Serialized strings are immutable; callers always receive newly parsed objects.
// This is a complete classification context, not a cache of unvalidated pages.
export class CjSimDiagnosticCache {
  private entries = new Map<string, {
    token: string; expires: number; bytes: number;
    summary: string; details: readonly string[];
  }>();
  private bytes = 0;

  constructor(
    readonly contextLimit = 8 * 1024 * 1024,
    private readonly totalLimit = 32 * 1024 * 1024,
    private readonly maxEntries = 8,
    private readonly ttlMs = 60_000,
    private readonly now = () => performance.now(),
  ) {}

  private remove(key: string) {
    const entry = this.entries.get(key);
    if (entry) this.bytes -= entry.bytes;
    this.entries.delete(key);
  }

  clear() {
    this.entries.clear();
    this.bytes = 0;
  }

  private prune() {
    for (const [key, entry] of this.entries) {
      if (entry.expires <= this.now()) this.remove(key);
    }
  }

  get(key: string, token: string, page: number, detail: boolean): CjSimDiagnosticPage | undefined {
    this.prune();
    const entry = this.entries.get(key);
    if (!entry || entry.token !== token) return undefined;
    // LRU order changes, but expiry is absolute, never extended by reads.
    this.entries.delete(key);
    this.entries.set(key, entry);
    const summary: CjSimDiagnosticPage = JSON.parse(entry.summary);
    return {
      ...summary, page,
      details: detail ? entry.details.slice(page * 50, (page + 1) * 50).map(s => JSON.parse(s)) : [],
      ...(detail ? { diagnostics: undefined } : {}),
    };
  }

  collector() {
    let details: string[] | undefined = [];
    let bytes = 0;
    return {
      add: (detail: CjSimDetail) => {
        if (!details) return;
        const text = JSON.stringify(detail);
        // Include conservative per-string/container overhead as well as UTF-8 data.
        bytes += Buffer.byteLength(text) + text.length * 2 + 64;
        if (bytes > this.contextLimit) details = undefined;
        else details.push(text);
      },
      finish: () => details == null ? undefined : { details, bytes },
    };
  }

  put(key: string, token: string, summary: CjSimDiagnosticPage, collected: ReturnType<ReturnType<CjSimDiagnosticCache["collector"]>["finish"]>) {
    this.prune();
    this.remove(key);
    if (!collected) return; // Oversized contexts continue using bounded streaming.
    const text = JSON.stringify({ ...summary, details: [], page: 0 });
    const bytes = collected.bytes + Buffer.byteLength(text) + text.length * 2 + key.length * 2 + 256;
    if (bytes > this.contextLimit || bytes > this.totalLimit || this.maxEntries <= 0) return;
    while (this.entries.size >= this.maxEntries || this.bytes + bytes > this.totalLimit) {
      this.remove(this.entries.keys().next().value!);
    }
    this.entries.set(key, {
      token, summary: text, details: Object.freeze([...collected.details]),
      bytes, expires: this.now() + this.ttlMs,
    });
    this.bytes += bytes;
  }
}
