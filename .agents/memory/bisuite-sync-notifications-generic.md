---
name: BiSuite sync notifications as generic admin alerts
description: How to add a new admin-facing alert type reusing bisuite_sync_notifications and the navbar bell
---
Rule: `bisuite_sync_notifications.status` is free text (no CHECK); the list route doesn't filter by status. A new alert type = pick a status constant in shared/, write the human text into `errorMessage`, and add a branch in the client Bell (title/icon/target link) — otherwise it renders as "Sync parziale" pointing to Vendite.

**Why:** the CJ "T0 spostati in massa" alert (threshold = max(3, min(10, ceil(5% journeys)))) was added this way instead of a new table; the threshold is deliberately silent on 0 shifts and on 1–2 shifts in small orgs.

**How to apply:** any nightly/background anomaly that admins should see; keep the pure threshold logic in shared/ so tsx tests cover it.
