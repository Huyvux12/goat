import { assert, it } from "@effect/vitest";
import * as IdAllocator from "@goat/provider-core/server/IdAllocator";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as EventSink from "./EventSink.ts";
import * as ProjectionStore from "./ProjectionStore.ts";
import * as ProviderSessionManager from "./ProviderSessionManager.ts";
import type * as Fixture from "./ProviderSessionManager.test.ts";
import { emptyState, modelSelection, runtimePolicy } from "./ProviderSessionFixture.testkit.ts";

export function registerSessionScopedArtifactCheck({
  makeThreadCreatedEvent,
  makeProviderThread,
  makePendingRuntimeRequestEvents,
  layerTest,
}: {
  makeThreadCreatedEvent: typeof Fixture.makeThreadCreatedEvent;
  makeProviderThread: typeof Fixture.makeProviderThread;
  makePendingRuntimeRequestEvents: typeof Fixture.makePendingRuntimeRequestEvents;
  layerTest: typeof Fixture.layerTest;
}) {
  it.effect("ProviderSessionManagerV2 persists session-scoped runtime requests without a run", () =>
    Effect.gen(function* () {
      const state = yield* Ref.make(emptyState);
      const effect = Effect.gen(function* () {
        const eventSink = yield* EventSink.EventSinkV2;
        const idAllocator = yield* IdAllocator.IdAllocatorV2;
        const manager = yield* ProviderSessionManager.ProviderSessionManagerV2;
        const projectionStore = yield* ProjectionStore.ProjectionStoreV2;
        const now = yield* DateTime.now;
        const projectId = yield* idAllocator.allocate.project({
          fixtureName: "provider-session-manager-session-request",
        });
        const threadId = yield* idAllocator.allocate.thread({
          fixtureName: "provider-session-manager-session-request",
          projectId,
        });
        const providerSessionId = yield* idAllocator.allocate.providerSession({
          providerInstanceId: modelSelection.instanceId,
          threadId,
        });
        const providerThread = makeProviderThread({
          idAllocator,
          threadId,
          providerSessionId,
          now,
        });

        yield* eventSink.write({
          events: [yield* makeThreadCreatedEvent({ idAllocator, threadId, now })],
        });
        yield* manager.open({
          threadId,
          providerSessionId,
          modelSelection,
          runtimePolicy,
        });
        const pendingRequest = yield* makePendingRuntimeRequestEvents({
          idAllocator,
          threadId,
          providerSessionId,
          providerThread,
          now,
        });
        const afterSequence = yield* eventSink.latestSequence({ threadId });
        const persistedFiber = yield* eventSink.stream({ threadId, afterSequence }).pipe(
          Stream.filter(
            (stored) =>
              stored.event.type === "runtime-request.updated" ||
              stored.event.type === "node.updated" ||
              stored.event.type === "turn-item.updated",
          ),
          Stream.take(3),
          Stream.runCollect,
          Effect.forkScoped,
        );
        const adapterEvents = (yield* Ref.get(state)).eventQueues.get(String(providerSessionId));
        assert.isDefined(adapterEvents);
        yield* Queue.offerAll(adapterEvents, pendingRequest.providerEvents);
        const persisted = Array.from(yield* Fiber.join(persistedFiber));

        assert.sameMembers(
          persisted.map((stored) => stored.event.type),
          ["runtime-request.updated", "node.updated", "turn-item.updated"],
        );
        const projection = yield* projectionStore.getThreadProjection(threadId);
        const request = projection.runtimeRequests.find(
          (candidate) => candidate.id === pendingRequest.requestId,
        );
        const node = projection.nodes.find((candidate) => candidate.id === pendingRequest.nodeId);
        const turnItem = projection.turnItems.find(
          (candidate) =>
            candidate.type === "approval_request" &&
            candidate.requestId === pendingRequest.requestId,
        );
        assert.equal(request?.status, "pending");
        assert.equal(request?.providerTurnId, null);
        assert.equal(node?.runId, null);
        assert.equal(node?.status, "waiting");
        assert.equal(turnItem?.runId, null);
        assert.equal(turnItem?.status, "waiting");
      });

      yield* effect.pipe(Effect.provide(layerTest({ state, idleTimeoutMs: 1000 })));
    }),
  );
}
