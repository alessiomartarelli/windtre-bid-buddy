/** Date-input values must use the browser's local calendar, not UTC. */
export function currentRechargePeriod(now = new Date()) {
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  return { from: `${yearMonth}-01`, to: `${yearMonth}-${String(now.getDate()).padStart(2, "0")}` };
}
