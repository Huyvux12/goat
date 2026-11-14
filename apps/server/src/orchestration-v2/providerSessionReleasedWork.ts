import type { ThreadId } from "@goat/contracts";
import type * as IdAllocator from "@goat/provider-core/server/IdAllocator";
import type * as ProviderAdapter from "@goat/provider-core/server/ProviderAdapter";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import type * as EventSink from "./EventSink.ts";
import type * as ProjectionStore from "./ProjectionStore.ts";
import type { ProviderSessionReleaseReason } from "./ProviderSessionManager.ts";
import { releasedThreadIds } from "./providerSessionReleasedThreads.ts";

interface ReleasedSessionEntry {
  readonly attachedThreadIds: ReadonlySet<ThreadId>;
  readonly runtime: Pick<
    ProviderAdapter.ProviderAdapterV2SessionRuntime,
    "providerSessionId" | "backgroundTasksEndWithProcess"
  >;
}

export const makeReleasedBackgroundWork = ({
  projectionStore,
  eventSink,
  idAllocator,
}: {
  readonly projectionStore: ProjectionStore.ProjectionStoreV2["Service"];
  readonly eventSink: EventSink.EventSinkV2Shape;
  readonly idAllocator: IdAllocator.IdAllocatorV2["Service"];
}) => {
  // Read tasks as soon as the session leaves the live map, before a replacement reports its own.
  // Keep OpenCode's roster: its background subagents share a server and can outlive the session.
  const readReleasedBackgroundTasks = Effect.fn(
    "ProviderSessionManager.readReleasedBackgroundTasks",
  )(
    function* (input: {
      readonly entry: ReleasedSessionEntry;
      readonly reason: ProviderSessionReleaseReason;
      readonly detachedThreadId?: ThreadId;
    }) {
      if (
        input.reason === "server_shutdown" ||
        input.entry.runtime.backgroundTasksEndWithProcess !== true
      ) {
        return [];
      }
      const providerSessionId = input.entry.runtime.providerSessionId;
      const released = [];
      for (const threadId of releasedThreadIds(input)) {
        const projection = yield* projectionStore.getThreadRecords(threadId, ["providerThreads"]);
        for (const providerThread of projection.providerThreads) {
          const tasks = providerThread.pendingBackgroundTasks ?? [];
          if (providerThread.providerSessionId !== providerSessionId || tasks.length === 0) {
            continue;
          }
          released.push({
            threadId,
            providerSessionId,
            providerThreadId: providerThread.id,
            taskIds: new Set(tasks.map((task) => task.taskId)),
          });
        }
      }
      return released;
    },
    (effect, input) =>
      effect.pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("orchestration-v2.provider-session-release-roster-read-failed", {
            providerSessionId: input.entry.runtime.providerSessionId,
            cause,
          }).pipe(Effect.as([])),
        ),
      ),
  );
  type ReleasedBackgroundTasks = Effect.Success<
    ReturnType<typeof readReleasedBackgroundTasks>
  >[number];

  // Dead processes cannot report task endings; stale rosters keep threads Waiting.
  const writeReleasedBackgroundWorkEvents = (released: ReadonlyArray<ReleasedBackgroundTasks>) =>
    Effect.forEach(
      released,
      ({ threadId, providerSessionId, providerThreadId, taskIds }) =>
        Effect.gen(function* () {
          for (let attempt = 0; attempt < 3; attempt++) {
            const projection = yield* projectionStore.getThreadRecords(threadId, [
              "providerThreads",
            ]);
            const providerThread = projection.providerThreads.find(
              (candidate) => candidate.id === providerThreadId,
            );
            const tasks = providerThread?.pendingBackgroundTasks ?? [];
            const remaining = tasks.filter((task) => !taskIds.has(task.taskId));
            if (providerThread === undefined || remaining.length === tasks.length) return;
            const now = yield* DateTime.now;
            const { committed } = yield* eventSink.writeIfProviderThreadUnchanged({
              expected: providerThread,
              events: [
                {
                  id: yield* idAllocator.allocate.event({ threadId, providerSessionId }),
                  type: "provider-thread.updated",
                  threadId,
                  driver: providerThread.driver,
                  providerInstanceId: providerThread.providerInstanceId,
                  occurredAt: now,
                  payload: {
                    ...providerThread,
                    pendingBackgroundTasks: remaining,
                    updatedAt: now,
                  },
                },
              ],
            });
            if (committed) return;
          }
          yield* Effect.logWarning("orchestration-v2.provider-session-release-roster-conflict", {
            providerSessionId,
            providerThreadId,
          });
        }),
      { discard: true },
    );

  return { readReleasedBackgroundTasks, writeReleasedBackgroundWorkEvents };
};

export type ReleasedBackgroundTasks = Parameters<
  ReturnType<typeof makeReleasedBackgroundWork>["writeReleasedBackgroundWorkEvents"]
>[0][number];
