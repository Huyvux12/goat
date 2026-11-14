import { assert, it } from "@effect/vitest";
import type { OrchestrationV2ProviderThread } from "@goat/contracts";
import * as IdAllocator from "@goat/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import type * as Fixture from "./ProviderSessionManager.test.ts";
import {
  CODEX_DRIVER,
  ExclusiveCapabilities,
  emptyState,
  makeProviderThread,
  modelSelection,
  runtimePolicy,
} from "./ProviderSessionFixture.testkit.ts";

export function registerReleasedBackgroundWorkChecks({
  makeThreadCreatedEvent,
  layerTest,
}: {
  makeThreadCreatedEvent: typeof Fixture.makeThreadCreatedEvent;
  layerTest: typeof Fixture.layerTest;
}) {
  const openSessionWithBackgroundCommand = (fixtureName: string) =>
    Effect.gen(function* () {
      const eventSink = yield* EventSink.EventSinkV2;
      const idAllocator = yield* IdAllocator.IdAllocatorV2;
      const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
      const now = yield* DateTime.now;
      const threadId = yield* idAllocator.allocate.thread({
        fixtureName,
        projectId: yield* idAllocator.allocate.project({ fixtureName }),
      });
      const providerSessionId = yield* idAllocator.allocate.providerSession({
        providerInstanceId: modelSelection.instanceId,
        threadId,
      });
      const otherProviderSessionId = yield* idAllocator.allocate.providerSession({
        providerInstanceId: modelSelection.instanceId,
        threadId,
      });
      const pendingBackgroundTasks = [
        { taskId: "dev-server", kind: "command", description: "python3 -m http.server" },
      ] as const;
      const providerThreads = [
        {
          ...makeProviderThread({ idAllocator, threadId, providerSessionId, now }),
          pendingBackgroundTasks,
        },
        {
          ...makeProviderThread({
            idAllocator,
            threadId,
            providerSessionId: otherProviderSessionId,
            now,
            nativeThreadId: "native-thread-other-session",
          }),
          pendingBackgroundTasks,
        },
      ] as const;
      const writeProviderThread = (payload: OrchestrationV2ProviderThread) =>
        Effect.gen(function* () {
          yield* eventSink.write({
            events: [
              {
                id: yield* idAllocator.allocate.event({ threadId }),
                type: "provider-thread.updated",
                threadId,
                driver: CODEX_DRIVER,
                occurredAt: now,
                payload,
              },
            ],
          });
        });
      yield* eventSink.write({
        events: [yield* makeThreadCreatedEvent({ idAllocator, threadId, now })],
      });
      yield* Effect.forEach(providerThreads, writeProviderThread);
      yield* manager.open({ threadId, providerSessionId, modelSelection, runtimePolicy });
      const rosters = Effect.gen(function* () {
        const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
        const projection = yield* projectionStore.getThreadProjection(threadId);
        return providerThreads.map((seeded) =>
          (
            projection.providerThreads.find((thread) => thread.id === seeded.id)
              ?.pendingBackgroundTasks ?? []
          ).map((task) => task.taskId),
        );
      });
      return { threadId, providerSessionId, providerThreads, writeProviderThread, rosters };
    });
  it.effect(
    "ProviderSessionManagerV2 clears the background roster of a session a detach releases",
    () =>
      Effect.gen(function* () {
        const state = yield* Ref.make(emptyState);
        const effect = Effect.gen(function* () {
          const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
          const { threadId, providerSessionId, rosters } = yield* openSessionWithBackgroundCommand(
            "provider-session-manager-detach-roster",
          );
          assert.deepStrictEqual(yield* rosters, [["dev-server"], ["dev-server"]]);
          yield* manager.detach({ providerSessionId, threadId, detail: "Thread settled." });
          assert.isTrue(Option.isNone(yield* manager.get(providerSessionId)));
          assert.deepStrictEqual(yield* rosters, [[], ["dev-server"]]);
        });
        yield* effect.pipe(
          Effect.provide(
            layerTest({ state, idleTimeoutMs: 60_000, capabilities: ExclusiveCapabilities }),
          ),
        );
      }),
  );
  it.effect(
    "ProviderSessionManagerV2 keeps the roster of a runtime whose tasks can outlive it",
    () =>
      Effect.gen(function* () {
        const state = yield* Ref.make(emptyState);
        const effect = Effect.gen(function* () {
          const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
          const { providerSessionId, rosters } = yield* openSessionWithBackgroundCommand(
            "provider-session-manager-outliving-roster",
          );
          yield* manager.close(providerSessionId);
          assert.deepStrictEqual(yield* rosters, [["dev-server"], ["dev-server"]]);
        });
        yield* effect.pipe(
          Effect.provide(
            layerTest({ state, idleTimeoutMs: 60_000, backgroundTasksEndWithProcess: false }),
          ),
        );
      }),
  );
  it.effect(
    "ProviderSessionManagerV2 keeps a provider update that lands while release clears",
    () =>
      Effect.gen(function* () {
        const state = yield* Ref.make(emptyState);
        const beforeUnchangedWrite = yield* Ref.make<Effect.Effect<void>>(Effect.void);
        const effect = Effect.gen(function* () {
          const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
          const { providerSessionId, providerThreads, writeProviderThread, rosters } =
            yield* openSessionWithBackgroundCommand("provider-session-manager-raced-roster");
          const seeded = providerThreads[0];
          yield* Ref.set(
            beforeUnchangedWrite,
            writeProviderThread({
              ...seeded,
              pendingBackgroundTasks: [
                ...seeded.pendingBackgroundTasks,
                { taskId: "replacement-task", kind: "command" },
              ],
            }).pipe(Effect.orDie),
          );
          yield* manager.close(providerSessionId);
          assert.deepStrictEqual(yield* rosters, [["replacement-task"], ["dev-server"]]);
        });
        yield* effect.pipe(
          Effect.provide(layerTest({ state, idleTimeoutMs: 60_000, beforeUnchangedWrite })),
        );
      }),
  );
}
