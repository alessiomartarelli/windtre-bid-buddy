Source: client/src/pages/DashboardGaraReale.tsx
Commit: d02a276489c4358d98c986337d36d596cf6e62e2
Captured: 2026-08-19
Purpose: immutable baseline of the production dashboard before Prisma Light preview changes.
SHA-256: 96728cc5f7d2a804417638491bd6287808d2f6a2653e3c4a9d2dfd62838aafd6

Editable visual derivative:
src/components/mockups/prisma-light/PrismaLightDashboard.tsx

Database snapshot:
src/components/mockups/prisma-light/dashboardSnapshot.ts
- Period: August 2026
- Source: development database, CMS S.R.L Gara Reale configuration
- Scope: non-cancelled BiSuite sales for the 12 configured stores on their competition days
- Piste: computed with the production aggregateMappedSales helper and effective mapping rules
- Privacy: aggregated store/category metrics only; no customer, employee, account, or credential data
