import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as SessionEnvironment from "./sessionEnvironment.ts";

it.effect("a session retains its environment when the host changes", () =>
  Effect.gen(function* () {
    const host = { PATH: "/old", CURSOR_API_KEY: "old-key" };
    const source = Effect.sync(() => host);
    const first = yield* SessionEnvironment.forSession(source);
    host.PATH = "/new";
    host.CURSOR_API_KEY = "new-key";
    const second = yield* SessionEnvironment.forSession(source);
    expect(first.environment.PATH).toBe("/old");
    expect(first.environment.CURSOR_API_KEY).toBe("old-key");
    expect(second.environment.PATH).toBe("/new");
    expect(second.apiKey).toBe("new-key");
  }),
);

it.effect(
  "a session whose Cursor configuration selects another agent transport asks for a restart",
  () =>
    Effect.gen(function* () {
      const session = yield* SessionEnvironment.forSession(
        { CURSOR_CONFIG_DIR: "/http1-config" },
        { agentTransportMatches: () => Effect.succeed(false) },
      );
      const error = yield* session.validate.pipe(Effect.flip);
      expect(String(error.cause)).toContain("Restart GOAT");
    }),
);
