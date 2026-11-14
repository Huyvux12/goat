type CompactionTurnRow = {
  readonly item: {
    readonly type: string;
    readonly runId: string | null;
    readonly status?: unknown;
  };
};

/** The open chat's compaction: a running compaction, or a /compact request not yet settled. */
export function chatCompactionState(input: {
  readonly turnItems: ReadonlyArray<CompactionTurnRow>;
  readonly activityRunId: string | undefined;
  readonly activeRunId: string | null | undefined;
  readonly compactRequestIsActive: boolean;
  readonly busy: boolean;
}) {
  const compactionSettled = input.turnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId === input.activityRunId &&
      (item.status === "completed" ||
        item.status === "failed" ||
        item.status === "interrupted" ||
        item.status === "cancelled"),
  );
  const compactionRunning = input.turnItems.some(
    ({ item }) =>
      item.type === "compaction" &&
      item.runId !== null &&
      item.runId === input.activeRunId &&
      item.status === "running",
  );
  const isCompacting =
    input.busy && (compactionRunning || (input.compactRequestIsActive && !compactionSettled));
  return { isCompacting };
}
