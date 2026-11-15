import * as NodeServices from "@effect/platform-node/NodeServices";
import { assert, describe, it } from "@effect/vitest";
import { ProviderInstanceId } from "@goat/contracts";
import * as TestProviderHost from "@goat/provider-testing/TestProviderHost";
import * as ProviderHost from "@goat/provider-core/server/ProviderHost";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";

import * as CursorAccountReader from "./CursorAccountReader.ts";
import * as CursorUsageAccounts from "./CursorUsageAccounts.ts";

describe("CursorUsageAccounts", () => {
  it.effect("runs at most two account refreshes at once and settles all of them", () => {
    let inFlight = 0;
    let mostInFlight = 0;
    const reachedTwo = Deferred.makeUnsafe<void>();
    const gate = Deferred.makeUnsafe<void>();
    const reader = Layer.succeed(CursorAccountReader.CursorAccountReader, {
      read: () =>
        Effect.gen(function* () {
          inFlight++;
          mostInFlight = Math.max(mostInFlight, inFlight);
          if (inFlight === 2) yield* Deferred.succeed(reachedTwo, undefined);
          yield* Deferred.await(gate);
          return { accountKey: null, records: [], missing: false, error: null };
        }).pipe(
          Effect.ensuring(
            Effect.sync(() => {
              inFlight--;
            }),
          ),
        ),
    });
    const scan = (awaitRefresh: boolean) =>
      Effect.gen(function* () {
        const accounts = yield* CursorUsageAccounts.CursorUsageAccounts;
        return yield* accounts.scan({
          instances: ["one", "two", "three", "four"].map((key) => ({
            instanceId: ProviderInstanceId.make(`cursor-${key}`),
            environment: { CURSOR_API_KEY: `${key}-key` },
          })),
          keychainUsageEnabled: false,
          windowStartMs: 0,
          retentionCutoffMs: 0,
          awaitRefresh,
        });
      });
    return Effect.gen(function* () {
      const first = yield* Effect.forkChild(scan(true));
      yield* Deferred.await(reachedTwo);
      assert.strictEqual(inFlight, 2);
      yield* Deferred.succeed(gate, undefined);
      yield* Fiber.join(first);
      assert.strictEqual(mostInFlight, 2);
      assert.strictEqual(inFlight, 0);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          CursorUsageAccounts.layer.pipe(Layer.provide(reader)),
          Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer),
        ),
      ),
    );
  });

  it.effect("does not read usage with a key issued by another Cursor backend", () => {
    const read: Array<unknown> = [];
    const reader = Layer.succeed(CursorAccountReader.CursorAccountReader, {
      read: (credentialSource) =>
        Effect.sync(() => {
          read.push(credentialSource);
          return { accountKey: null, records: [], missing: false, error: null };
        }),
    });
    return Effect.gen(function* () {
      const accounts = yield* CursorUsageAccounts.CursorUsageAccounts;
      yield* accounts.scan({
        instances: [
          {
            instanceId: ProviderInstanceId.make("cursor-private"),
            environment: {
              CURSOR_API_KEY: "private-key",
              CURSOR_BACKEND_URL: "https://private.invalid",
            },
          },
          {
            instanceId: ProviderInstanceId.make("cursor-public"),
            environment: {
              CURSOR_API_KEY: "public-key",
              CURSOR_BACKEND_URL: "https://api2.cursor.sh/",
            },
          },
        ],
        keychainUsageEnabled: false,
        windowStartMs: 0,
        retentionCutoffMs: 0,
        awaitRefresh: true,
      });
      assert.deepStrictEqual(read, [{ kind: "apiKey", apiKey: "public-key" }]);
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          CursorUsageAccounts.layer.pipe(Layer.provide(reader)),
          Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer),
        ),
      ),
    );
  });

  it.effect("does not read usage with a stored sign-in made against another backend", () => {
    const read: Array<unknown> = [];
    const reader = Layer.succeed(CursorAccountReader.CursorAccountReader, {
      read: (credentialSource) =>
        Effect.sync(() => {
          read.push(credentialSource);
          return { accountKey: null, records: [], missing: true, error: null };
        }),
    });
    return Effect.gen(function* () {
      const instanceId = ProviderInstanceId.make("cursor-stored-private");
      const credentials = yield* (yield* ProviderHost.ProviderHost).credentials(
        "cursor",
        instanceId,
      );
      yield* credentials.set(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            backendUrl: "https://private.invalid",
            apiKey: "stored-private-key",
            createdAtMs: 0,
          }),
        ),
      );
      const accounts = yield* CursorUsageAccounts.CursorUsageAccounts;
      yield* accounts.scan({
        instances: [{ instanceId, environment: {} }],
        keychainUsageEnabled: false,
        windowStartMs: 0,
        retentionCutoffMs: 0,
        awaitRefresh: true,
      });
      assert.deepStrictEqual(
        read.filter((source) => typeof source !== "string"),
        [],
      );
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          CursorUsageAccounts.layer.pipe(Layer.provide(reader)),
          Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer),
        ),
      ),
    );
  });

  it.effect("shows no host account's history when every instance is on another backend", () => {
    const read: Array<unknown> = [];
    const reader = Layer.succeed(CursorAccountReader.CursorAccountReader, {
      read: (credentialSource) =>
        Effect.sync(() => {
          read.push(credentialSource);
          return { accountKey: null, records: [], missing: true, error: null };
        }),
    });
    return Effect.gen(function* () {
      const accounts = yield* CursorUsageAccounts.CursorUsageAccounts;
      const scans = yield* accounts.scan({
        instances: [
          {
            instanceId: ProviderInstanceId.make("cursor-private-only"),
            environment: {
              CURSOR_API_KEY: "private-key",
              CURSOR_BACKEND_URL: "https://private.invalid",
            },
          },
        ],
        keychainUsageEnabled: true,
        windowStartMs: 0,
        retentionCutoffMs: 0,
        awaitRefresh: true,
      });
      assert.deepStrictEqual(read, []);
      assert.strictEqual(scans.length, 1);
      assert.include(scans[0]?.message ?? "", "another Cursor backend");
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          CursorUsageAccounts.layer.pipe(Layer.provide(reader)),
          Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer),
        ),
      ),
    );
  });

  it.effect(
    "shows no host account's history when the stored sign-in belongs to another backend",
    () => {
      const read: Array<unknown> = [];
      const reader = Layer.succeed(CursorAccountReader.CursorAccountReader, {
        read: (credentialSource) =>
          Effect.sync(() => {
            read.push(credentialSource);
            return { accountKey: null, records: [], missing: true, error: null };
          }),
      });
      return Effect.gen(function* () {
        const instanceId = ProviderInstanceId.make("cursor-moved-to-production");
        const credentials = yield* (yield* ProviderHost.ProviderHost).credentials(
          "cursor",
          instanceId,
        );
        yield* credentials.set(
          new TextEncoder().encode(
            JSON.stringify({
              version: 1,
              backendUrl: "https://private.invalid",
              apiKey: "stored-private-key",
              createdAtMs: 0,
            }),
          ),
        );
        const accounts = yield* CursorUsageAccounts.CursorUsageAccounts;
        // The instance now selects Cursor's backend; its sign-in was made against another one.
        const scans = yield* accounts.scan({
          instances: [{ instanceId, environment: {} }],
          keychainUsageEnabled: true,
          windowStartMs: 0,
          retentionCutoffMs: 0,
          awaitRefresh: true,
        });
        assert.deepStrictEqual(read, []);
        assert.strictEqual(scans.length, 1);
        assert.include(scans[0]?.message ?? "", "another Cursor backend");
      }).pipe(
        Effect.provide(
          Layer.provideMerge(
            CursorUsageAccounts.layer.pipe(Layer.provide(reader)),
            Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer),
          ),
        ),
      );
    },
  );

  it.effect("shows no host account's history for an expired or unreadable stored sign-in", () => {
    const read: Array<unknown> = [];
    const reader = Layer.succeed(CursorAccountReader.CursorAccountReader, {
      read: (credentialSource) =>
        Effect.sync(() => {
          read.push(credentialSource);
          return { accountKey: null, records: [], missing: true, error: null };
        }),
    });
    return Effect.gen(function* () {
      const host = yield* ProviderHost.ProviderHost;
      const expired = ProviderInstanceId.make("cursor-expired-private");
      const unreadable = ProviderInstanceId.make("cursor-unreadable");
      yield* (yield* host.credentials("cursor", expired)).set(
        new TextEncoder().encode(
          JSON.stringify({
            version: 1,
            backendUrl: "https://private.invalid",
            apiKey: "expired-private-key",
            createdAtMs: 0,
            apiKeyExpiresAtMs: 1,
          }),
        ),
      );
      yield* (yield* host.credentials("cursor", unreadable)).set(
        new TextEncoder().encode("not a stored sign-in"),
      );
      const accounts = yield* CursorUsageAccounts.CursorUsageAccounts;
      for (const instanceId of [expired, unreadable]) {
        const scans = yield* accounts.scan({
          instances: [{ instanceId, environment: {} }],
          keychainUsageEnabled: true,
          windowStartMs: 0,
          retentionCutoffMs: 0,
          awaitRefresh: true,
        });
        // No host login was read in its place.
        assert.deepStrictEqual(read, []);
        assert.strictEqual(scans.length, 1);
        assert.include(scans[0]?.message ?? "", "another Cursor backend");
      }
    }).pipe(
      Effect.provide(
        Layer.provideMerge(
          CursorUsageAccounts.layer.pipe(Layer.provide(reader)),
          Layer.provideMerge(TestProviderHost.layer(), NodeServices.layer),
        ),
      ),
    );
  });
});
