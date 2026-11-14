import { assert, it } from "@effect/vitest";
import {
  ThreadId,
  type OrchestrationV2ProviderTurn,
  type ProviderReplayEntry,
} from "@goat/contracts";
import * as McpProviderSessions from "@goat/provider-core/server/McpProviderSessions";
import * as ProviderContinuationRequests from "@goat/provider-core/server/ProviderContinuationRequests";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Stream from "effect/Stream";
import {
  CHILD,
  SESSION,
  backgroundLaunch,
  continuationTurn,
  event,
  out,
  reply,
  replyData,
  resumed,
  sessionInfo,
  withLineage,
} from "./OpenCode2AdapterV2.fixtures.testkit.ts";

it.layer(McpProviderSessions.layer)("OpenCode2 continuations", (it) => {
  const continued = (after: ReadonlyArray<ProviderReplayEntry>) =>
    Effect.gen(function* () {
      const offers: Array<ProviderContinuationRequests.ProviderContinuationRequest> = [];
      const offered = yield* Deferred.make<void>();
      const { runtime, thread } = yield* resumed([
        ...backgroundLaunch(CHILD),
        event("session.execution.succeeded", { sessionID: SESSION }),
        event("session.execution.succeeded", { sessionID: CHILD }),
        event("session.inbox.enqueued", {
          inboxID: "msg_report",
          sessionID: SESSION,
          item: {
            type: "synthetic",
            payload: {
              text: CONTINUED_REPORT,
              description: "Sleep",
              metadata: {
                source: "subagent",
                childID: CHILD,
                agent: "General",
                state: "completed",
              },
            },
            delivery: "steer",
          },
        }),
        event("session.execution.started", { sessionID: SESSION }),
        event("session.inbox.delivered", { sessionID: SESSION, inboxID: "msg_report" }),
        event("session.text.ended", {
          sessionID: SESSION,
          assistantMessageID: "msg_followup",
          ordinal: 0,
          text: "CHILD_OK",
        }),
        event("session.execution.succeeded", { sessionID: SESSION }),
        ...after,
      ]).pipe(
        Effect.provideService(ProviderContinuationRequests.ProviderContinuationRequests, {
          offer: (request) =>
            Effect.sync(() => void offers.push(request)).pipe(
              Effect.andThen(Deferred.succeed(offered, undefined)),
              Effect.asVoid,
            ),
          take: Effect.never,
        }),
      );
      const turns: Array<OrchestrationV2ProviderTurn> = [];
      const bothEnded = yield* Deferred.make<void>();
      yield* runtime.events.pipe(
        Stream.tap((event) =>
          Effect.gen(function* () {
            if (event.type === "provider_turn.updated" && event.providerTurn.status !== "running") {
              turns.push(event.providerTurn);
              if (turns.length === 2) yield* Deferred.succeed(bothEnded, undefined);
            }
          }),
        ),
        Stream.runDrain,
        Effect.forkScoped,
      );
      yield* runtime.startTurn(withLineage(thread));
      yield* Deferred.await(offered);
      yield* runtime.startTurn(continuationTurn(thread, offers[0]!));
      yield* Deferred.await(bothEnded);
      const [first, second] = turns;
      return { runtime, thread, first: first!, second: second! };
    });
  const CONTINUED_PROMPT = `msg_t3_turn_${SESSION}:attempt:attempt:opencode2-adapter`;
  const CONTINUED_REPORT = `<subagent sessionID="${CHILD}" state="completed" description="Sleep">\nCHILD_OK\n</subagent>`;
  const continuedHistory = {
    data: [
      { id: "msg_report", time: { created: 2 }, text: CONTINUED_REPORT, type: "synthetic" },
      { id: CONTINUED_PROMPT, time: { created: 1 }, text: "hi", type: "user" },
    ],
    cursor: {},
  };

  it.effect("forks before a continuation's report, so the fork leaves out its answer", () =>
    Effect.gen(function* () {
      const FORK = "ses_f1484db83ffeLGtrRCFimo1H0e";
      const { runtime, thread, first, second } = yield* continued([
        out("message.list", { sessionID: SESSION, limit: "100", type: "user" }),
        reply("message.list", { data: [continuedHistory.data[1]], cursor: {} }),
        out("message.list", { sessionID: SESSION, limit: "100", type: "synthetic" }),
        reply("message.list", {
          data: [
            { id: "msg_later_report", time: { created: 3 }, text: "later", type: "synthetic" },
          ],
          cursor: { next: "synthetic-page-2" },
        }),
        out("message.list", {
          sessionID: SESSION,
          limit: "100",
          type: "synthetic",
          cursor: "synthetic-page-2",
        }),
        reply("message.list", { data: [continuedHistory.data[0]], cursor: {} }),
        out("session.fork", { sessionID: SESSION, before: "msg_report" }),
        replyData("session.fork", sessionInfo({ id: FORK })),
        out("session.update", { sessionID: FORK, permissions: "<any>" }),
        reply("session.update", null),
      ]);
      const forked = yield* runtime.forkThread({
        sourceProviderThread: thread,
        targetThreadId: ThreadId.make("thread:opencode2-adapter:fork"),
        providerTurnId: first.id,
        sourceProviderTurns: [first, second],
      });
      assert.equal(forked.nativeThreadRef?.nativeId, FORK);
    }).pipe(Effect.scoped),
  );
});
