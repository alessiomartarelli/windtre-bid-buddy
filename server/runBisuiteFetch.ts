import { runBisuiteFetchForAllOrgs, runBisuiteFetchForOrg } from "./bisuiteFetch";

async function main() {
  const orgArg = process.argv[2];
  const startedAt = Date.now();
  if (orgArg) {
    console.log(`[runBisuiteFetch] fetch per org=${orgArg}`);
    const r = await runBisuiteFetchForOrg(orgArg);
    console.log(`[runBisuiteFetch] OK in ${Date.now() - startedAt} ms:`, r);
  } else {
    console.log(`[runBisuiteFetch] fetch per TUTTE le organizzazioni`);
    const r = await runBisuiteFetchForAllOrgs();
    console.log(
      `[runBisuiteFetch] completato in ${Date.now() - startedAt} ms — ` +
        `ok: ${r.ok.length}, failed: ${r.failed.length}`,
    );
    for (const o of r.ok) console.log("  OK ", o);
    for (const f of r.failed) console.log("  FAIL", f);
  }
}

main()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error("[runBisuiteFetch] errore fatale:", err);
    process.exit(1);
  });
