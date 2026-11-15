import * as NodeServices from "@effect/platform-node/NodeServices";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import * as AgentSessionScanner from "./AgentSessionScanner.ts";
import { layerScannerTest, makeTempDir, writeTranscript } from "./AgentSessionScanner.testkit.ts";

const encodeTranscriptRecord = Schema.encodeUnknownSync(Schema.fromJsonString(Schema.Unknown));

it.layer(NodeServices.layer)("AgentSessionScanner imported transcripts", (it) => {
  describe("recentThreads", () => {
    it.effect("excludes Codex subagents from discovery and the recent-thread budget", () =>
      Effect.gen(function* () {
        const path = yield* Path.Path;
        const nowMs = Date.parse("2026-08-24T12:00:00.000Z");
        yield* TestClock.setTime(nowMs);
        const claudeHomePath = yield* makeTempDir("goat-claude-home-");
        const codexHomePath = yield* makeTempDir("goat-codex-home-");
        const workspace = yield* makeTempDir("goat-workspace-");
        const subagentSources = [
          { subagent: { thread_spawn: { parent_thread_id: "session-100", depth: 1 } } },
          { subagent: "review" },
          { subagent: { other: "guardian" } },
          { subAgent: "compact" },
        ];
        // Newer subagents would exhaust the 100-transcript import budget before any parent.
        const sources = [
          ...Array.from({ length: 100 }, (_, index) => subagentSources[index % 4]),
          "vscode",
          undefined,
          null,
          { custom: "launcher" },
        ];
        for (const [index, source] of sources.entries()) {
          yield* writeTranscript({
            filePath: path.join(
              codexHomePath,
              "sessions",
              "2026",
              "08",
              "24",
              `rollout-${index}.jsonl`,
            ),
            contents: [
              { type: "session_meta", payload: { id: `session-${index}`, cwd: workspace, source } },
              // A later cwd must not make an excluded rollout eligible again.
              { type: "turn_context", payload: { cwd: workspace } },
              {
                type: "event_msg",
                payload: { type: "user_message", message: "Import this prompt" },
              },
            ]
              .map((record) => encodeTranscriptRecord(record))
              .join("\n"),
            mtimeMs: nowMs - index * 60_000,
          });
        }

        yield* Effect.gen(function* () {
          const scanner = yield* AgentSessionScanner.AgentSessionScanner;
          const scan = yield* scanner.scan({ includePi: true });
          expect.soft(scan.candidates.map((candidate) => candidate.threadCount)).toEqual([4]);
          const outcomes = yield* Stream.runCollect(scanner.recentThreads(workspace));
          expect(
            outcomes.map((outcome) =>
              outcome._tag === "Importable" ? outcome.thread.providerSessionId : outcome._tag,
            ),
          ).toEqual(["session-100", "session-101", "session-102", "session-103"]);
        }).pipe(Effect.provide(layerScannerTest({ claudeHomePath, codexHomePath })));
      }),
    );
  });
});
