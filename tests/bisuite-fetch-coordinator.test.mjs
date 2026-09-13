import assert from "node:assert/strict";
import test from "node:test";
import {
  BISUITE_AUTO_FETCH_COOLDOWN_MS,
  BisuiteFetchCoordinator,
} from "../server/bisuiteFetchCoordinator.ts";

const today = {
  startDate: "2026-09-13",
  endDate: "2026-09-13",
  todayRange: true,
};

test("concurrent automatic requests for one organization share one fetch", async () => {
  const coordinator = new BisuiteFetchCoordinator();
  let resolveFetch;
  let calls = 0;
  const fetch = () => {
    calls++;
    return new Promise((resolve) => { resolveFetch = resolve; });
  };

  const first = coordinator.run({ orgId: "org-1", automatic: true, fetch, ...today });
  const second = coordinator.run({ orgId: "org-1", automatic: true, fetch, ...today });
  assert.equal(calls, 1);

  resolveFetch({ inserted: 3 });
  const [a, b] = await Promise.all([first, second]);
  assert.deepEqual(a, { kind: "completed", result: { inserted: 3 } });
  assert.deepEqual(b, a);
});

test("a second automatic request within five minutes is skipped", async () => {
  let now = 1_000_000;
  const coordinator = new BisuiteFetchCoordinator(
    BISUITE_AUTO_FETCH_COOLDOWN_MS,
    () => now,
  );
  let calls = 0;
  const fetch = async () => ({ call: ++calls });

  await coordinator.run({ orgId: "org-1", automatic: true, fetch, ...today });
  now += BISUITE_AUTO_FETCH_COOLDOWN_MS - 1;
  const second = await coordinator.run({ orgId: "org-1", automatic: true, fetch, ...today });

  assert.deepEqual(second, { kind: "skipped", status: "fresh" });
  assert.equal(calls, 1);
});

test("a successful manual sync for today refreshes the automatic cooldown", async () => {
  let now = 2_000_000;
  const coordinator = new BisuiteFetchCoordinator(
    BISUITE_AUTO_FETCH_COOLDOWN_MS,
    () => now,
  );
  let calls = 0;
  const fetch = async () => ({ call: ++calls });

  await coordinator.run({ orgId: "org-1", automatic: false, fetch, ...today });
  now += 60_000;
  const automatic = await coordinator.run({ orgId: "org-1", automatic: true, fetch, ...today });

  assert.deepEqual(automatic, { kind: "skipped", status: "fresh" });
  assert.equal(calls, 1);
});

test("a successful historical manual sync does not affect automatic polling", async () => {
  let now = 3_000_000;
  const coordinator = new BisuiteFetchCoordinator(
    BISUITE_AUTO_FETCH_COOLDOWN_MS,
    () => now,
  );
  let calls = 0;
  const fetch = async () => ({ call: ++calls });

  await coordinator.run({
    orgId: "org-1",
    automatic: false,
    todayRange: false,
    startDate: "2026-08-01",
    endDate: "2026-08-31",
    fetch,
  });
  const automatic = await coordinator.run({
    orgId: "org-1",
    automatic: true,
    fetch,
    ...today,
  });

  assert.equal(automatic.kind, "completed");
  assert.equal(calls, 2);
});