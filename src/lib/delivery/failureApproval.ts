type StatusLogRow = {
  note: string | null;
  status: string;
  created_at: string;
};

export function getFailureReasonFromLogs(
  logs: StatusLogRow[] | null | undefined,
): string {
  const list = logs ?? [];
  const pendingLog = list
    .filter((l) => l.status === "PENDING_FAILURE_APPROVAL")
    .sort(
      (a, b) =>
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
    )[0];
  if (pendingLog?.note) return pendingLog.note;

  const latest = [...list].sort(
    (a, b) =>
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  )[0];
  return latest?.note ?? "No reason provided";
}
