export const TERMINAL_ORDER_STATUSES = ["DELIVERED", "FAILED"] as const;

export type TerminalOrderStatus = (typeof TERMINAL_ORDER_STATUSES)[number];

export type CategoryDeliveryStats = {
  assigned: number;
  delivered: number;
  failed: number;
};

export function isTerminalOrderStatus(
  status: string,
): status is TerminalOrderStatus {
  return TERMINAL_ORDER_STATUSES.includes(status as TerminalOrderStatus);
}

export function isCategoryComplete(stats: CategoryDeliveryStats): boolean {
  return stats.assigned > 0 && stats.delivered + stats.failed >= stats.assigned;
}

export function isBatchCompleteByCounts(stats: {
  mealCount: number;
  deliveredCount: number;
  failedCount: number;
}): boolean {
  return (
    stats.mealCount > 0 &&
    stats.deliveredCount + stats.failedCount >= stats.mealCount
  );
}

export function formatDeliveryCountBreakdown(stats: CategoryDeliveryStats): string {
  const base = `${stats.assigned} assigned / ${stats.delivered} delivered`;
  return stats.failed > 0 ? `${base} / ${stats.failed} failed` : base;
}

export function formatDeliveryCountBreakdownTitleCase(
  stats: CategoryDeliveryStats,
): string {
  const base = `${stats.assigned} Assigned • ${stats.delivered} Delivered`;
  return stats.failed > 0 ? `${base} • ${stats.failed} Failed` : base;
}
