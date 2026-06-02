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
