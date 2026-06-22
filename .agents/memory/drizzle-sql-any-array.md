---
name: Drizzle sql`= ANY(${jsArray})` expands to multiple placeholders
description: Postgres 42809 "op ANY/ALL (array) requires array on right side" with Drizzle raw sql
---

In a Drizzle `sql\`\`` template, interpolating a JS array (`sql\`... = ANY(${arr})\``)
does NOT bind it as one Postgres array param — it expands into a comma list of
placeholders (`= ANY($1, $2)`), which Postgres rejects with
**error 42809 "op ANY/ALL (array) requires array on right side"**.

**How to apply:** build a real PG array instead. Either
`sql\`ARRAY[${sql.join(arr.map((n) => sql\`${n}\`), sql\`, \`)}]::int[]\``
inside `ANY(...)`, or `sql.raw('ARRAY[' + ints.join(',') + ']')` when the
values are guaranteed integers. Same trap applies to `IN (...)` with raw sql.
Hit in storage.aggregateAccessoriServizi (Incentivazione dashboard live data).
