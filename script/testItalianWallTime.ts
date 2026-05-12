import { toItalianWallTime } from "../server/bisuiteFetch";

type Case = { input: unknown; expected: string | null; desc: string };

const cases: Case[] = [
  { input: "2026-03-31T22:00:00.000Z", expected: "2026-04-01T00:00:00.000Z", desc: "ISO Z, CEST (+2): 31/03 22:00 UTC -> 01/04 00:00 italiano" },
  { input: "2026-10-25T23:00:00.000Z", expected: "2026-10-26T00:00:00.000Z", desc: "ISO Z, CET (+1): 25/10 23:00 UTC -> 26/10 00:00 italiano (post-DST)" },
  { input: "2026-04-01T00:00:00", expected: "2026-04-01T00:00:00.000Z", desc: "naive datetime: gia wall-time italiano, mantenuto" },
  { input: "2026-04-01", expected: "2026-04-01T00:00:00.000Z", desc: "date-only YYYY-MM-DD" },
  { input: "2026-04-01T00:00:00+02:00", expected: "2026-04-01T00:00:00.000Z", desc: "ISO con offset esplicito CEST" },
  { input: null, expected: null, desc: "null" },
  { input: "", expected: null, desc: "stringa vuota" },
  { input: undefined, expected: null, desc: "undefined" },
  { input: "not a date", expected: null, desc: "stringa non parsabile" },
  { input: "2026-12-25T11:00:00.000Z", expected: "2026-12-25T12:00:00.000Z", desc: "ISO Z, CET inverno: 11:00 UTC -> 12:00 italiano" },
  { input: "2026-07-15T10:00:00.000Z", expected: "2026-07-15T12:00:00.000Z", desc: "ISO Z, CEST estate: 10:00 UTC -> 12:00 italiano" },
];

let failed = 0;
for (const c of cases) {
  const got = toItalianWallTime(c.input as any);
  const gotStr = got ? got.toISOString() : null;
  const ok = gotStr === c.expected;
  console.log(`${ok ? "PASS" : "FAIL"}  ${c.desc}`);
  if (!ok) {
    console.log(`      input:    ${JSON.stringify(c.input)}`);
    console.log(`      expected: ${c.expected}`);
    console.log(`      got:      ${gotStr}`);
    failed++;
  }
}

console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed === 0 ? 0 : 1);
