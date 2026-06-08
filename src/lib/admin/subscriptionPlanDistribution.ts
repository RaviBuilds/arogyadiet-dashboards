export function buildPlanDistribution(
  plans: { id: string; name: string }[],
  subscriptions: { plan_id: string | null; status: string }[],
  status: "ACTIVE" | "PENDING",
): { name: string; count: number }[] {
  const filtered = subscriptions.filter((s) => s.status === status);
  const rows = plans.map((plan) => ({
    name: plan.name,
    count: filtered.filter((s) => s.plan_id === plan.id).length,
  }));
  const customCount = filtered.filter((s) => !s.plan_id).length;
  rows.push({ name: "Custom Plan", count: customCount });
  return rows.sort((a, b) => b.count - a.count);
}
