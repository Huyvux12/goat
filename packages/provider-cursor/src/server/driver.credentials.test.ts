import type { AgentOptions } from "@cursor/sdk";
import * as HostProcess from "@goat/shared/HostProcess";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { expect, it } from "@effect/vitest";
import { ProviderInstanceId, ProviderSessionId, ThreadId } from "@goat/contracts";
import * as Cause from "effect/Cause";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Exit from "effect/Exit";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as HttpClient from "effect/http/HttpClient";
import * as HttpClientResponse from "effect/http/HttpClientResponse";

import * as ProviderEventLoggers from "@goat/provider-core/server/ProviderEventLoggers";
import * as TestProviderHost from "@goat/provider-testing/TestProviderHost";
import { CursorDriver } from "./driver.ts";
import * as CursorAgentSdk from "./CursorAgentSdk.ts";
import * as CursorSdk from "./CursorSdk.ts";
import * as CursorKeychain from "./CursorKeychain.ts";
import * as IdAllocator from "@goat/provider-core/server/IdAllocator";
import * as McpProviderSessions from "@goat/provider-core/server/McpProviderSessions";
import * as ProviderAdapter from "@goat/provider-core/server/ProviderAdapter";

const layerTest = TestProviderHost.layer({ runBackgroundWork: false }).pipe(
  Layer.provideMerge(NodeServices.layer),
  Layer.provideMerge(IdAllocator.layer),
  Layer.provideMerge(McpProviderSessions.layer),
  Layer.provideMerge(CursorSdk.layer.pipe(Layer.provide(NodeServices.layer))),
  Layer.provideMerge(
    Layer.mock(CursorAgentSdk.CursorAgentSdkRunner)({
      open: () => Effect.die("Maintenance resolution must not open a Cursor session"),
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(CursorKeychain.CursorKeychain, {
      accessToken: Effect.die("The driver test must not read the Keychain"),
    }),
  ),
  Layer.provideMerge(
    Layer.succeed(
      ProviderEventLoggers.ProviderEventLoggers,
      ProviderEventLoggers.NoOpProviderEventLoggers,
    ),
  ),
  Layer.provideMerge(
    Layer.succeed(
      HttpClient.HttpClient,
      HttpClient.make(() => Effect.die("Disabled Cursor must not make an HTTP request")),
    ),
  ),
);

it.layer(layerTest)("CursorDriver credentials and environment", (it) => {
  it.effect("a session uses catalog defaults only from its own account's catalog", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-account-" });
      const client = HttpClient.make((request) =>
        Effect.succeed(
          request.url.endsWith("/v1/me")
            ? HttpClientResponse.fromWeb(
                request,
                Response.json({ apiKeyName: "T3 Code", createdAt: "2026-01-01T00:00:00.000Z" }),
              )
            : HttpClientResponse.fromWeb(
                request,
                Response.json({
                  items: [
                    {
                      id: "claude-opus-5-5",
                      displayName: "Claude Opus 5.5",
                      parameters: [
                        {
                          id: "context",
                          displayName: "Context",
                          values: [{ value: "300k" }, { value: "1m" }],
                        },
                      ],
                      variants: [
                        {
                          displayName: "Claude Opus 5.5",
                          isDefault: true,
                          params: [{ id: "context", value: "1m" }],
                        },
                      ],
                    },
                  ],
                }),
              ),
        ),
      );
      const host: NodeJS.ProcessEnv = { CURSOR_API_KEY: "account-a-key" };
      const instanceId = ProviderInstanceId.make("cursor-catalog-account");
      const openedModels: Array<AgentOptions["model"]> = [];
      const instance = yield* CursorDriver.create({
        instanceId,
        displayName: "Cursor",
        enabled: true,
        environment: [],
        config: CursorDriver.defaultConfig(),
      }).pipe(
        Effect.provideService(HostProcess.Environment, host),
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: (request) =>
            Effect.sync(() => {
              openedModels.push(request.options.model);
              return {
                agentId: "native-cursor-account-" + openedModels.length,
                listMessages: Effect.succeed([]),
                close: Effect.void,
                send: () => Effect.die("no turns in this test"),
              };
            }),
        }),
      );
      expect((yield* instance.snapshot.refresh).status).toBe("ready");
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const modelSelection = { instanceId, model: "claude-opus-5-5" };
      const open = (name: string) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make(name);
          const runtime = yield* instance.orchestrationAdapter.openSession({
            threadId,
            providerSessionId: ProviderSessionId.make(name),
            modelSelection,
            runtimePolicy,
          });
          yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
        });
      yield* open("account-a");
      // Another account's key, before any check has loaded its catalog.
      host.CURSOR_API_KEY = "account-b-key";
      yield* open("account-b");
      expect(openedModels[0]).toEqual({
        id: "claude-opus-5-5",
        params: [{ id: "context", value: "1m" }],
      });
      expect(openedModels[1]).toEqual({ id: "claude-opus-5-5" });
    }).pipe(Effect.scoped),
  );

  it.effect(
    "a status check sends the instance's key only to the backend its environment names",
    () =>
      Effect.gen(function* () {
        const requested: Array<string> = [];
        const client = HttpClient.make((request) =>
          Effect.sync(() => {
            requested.push(request.url);
            return request.url.endsWith("/v1/me")
              ? HttpClientResponse.fromWeb(
                  request,
                  Response.json({ apiKeyName: "T3 Code", createdAt: "2026-01-01T00:00:00.000Z" }),
                )
              : HttpClientResponse.fromWeb(request, Response.json({ items: [] }));
          }),
        );
        const instance = yield* CursorDriver.create({
          instanceId: ProviderInstanceId.make("cursor-catalog-backend"),
          displayName: "Cursor",
          enabled: true,
          environment: [
            { name: "CURSOR_API_KEY", value: "private-key", sensitive: true },
            { name: "CURSOR_BACKEND_URL", value: "https://private.invalid", sensitive: false },
          ],
          config: CursorDriver.defaultConfig(),
        }).pipe(
          Effect.provideService(HostProcess.Environment, {}),
          Effect.provideService(HttpClient.HttpClient, client),
        );
        yield* instance.snapshot.refresh;
        expect(requested.toSorted()).toEqual([
          "https://private.invalid/v1/me",
          "https://private.invalid/v1/models",
        ]);
      }).pipe(Effect.scoped),
  );

  it.effect("a status check reads the host environment once", () =>
    Effect.gen(function* () {
      // Every way to read the host object: enumeration, a property, `in`, a descriptor.
      let reads = 0;
      const target: NodeJS.ProcessEnv = { CURSOR_API_KEY: "host-key" };
      const host = new Proxy<NodeJS.ProcessEnv>(target, {
        ownKeys: (object) => {
          reads++;
          return Reflect.ownKeys(object);
        },
        get: (object, key) => {
          reads++;
          return Reflect.get(object, key);
        },
        has: (object, key) => {
          reads++;
          return Reflect.has(object, key);
        },
        getOwnPropertyDescriptor: (object, key) => {
          reads++;
          return Reflect.getOwnPropertyDescriptor(object, key);
        },
      });
      // What one copy of the host costs, measured on the same object.
      const beforeCopy = reads;
      void { ...host };
      const oneCopy = reads - beforeCopy;
      const catalogRequested = yield* Deferred.make<void>();
      const client = HttpClient.make((request) =>
        Deferred.succeed(catalogRequested, undefined).pipe(
          Effect.as(
            request.url.endsWith("/v1/me")
              ? HttpClientResponse.fromWeb(
                  request,
                  Response.json({ apiKeyName: "T3 Code", createdAt: "2026-01-01T00:00:00.000Z" }),
                )
              : HttpClientResponse.fromWeb(request, Response.json({ items: [] })),
          ),
        ),
      );
      const instance = yield* CursorDriver.create({
        instanceId: ProviderInstanceId.make("cursor-one-read"),
        displayName: "Cursor",
        enabled: true,
        environment: [],
        config: CursorDriver.defaultConfig(),
      }).pipe(
        Effect.provideService(HostProcess.Environment, host),
        Effect.provideService(HttpClient.HttpClient, client),
      );
      // The initial snapshot sends nothing, so the first request is the creation-time check's, made
      // while it holds the refresh permit; a refresh started now runs after it.
      yield* Deferred.await(catalogRequested);
      yield* instance.snapshot.refresh;
      const before = reads;
      yield* instance.snapshot.refresh;
      // One copy gives the key, the backend and the sign-in label the same environment.
      expect(reads - before).toBe(oneCopy);
    }).pipe(Effect.scoped),
  );

  it.effect("a new session reads the transport setting under the host's current HOME", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const before = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-home-a-" });
      const after = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-home-b-" });
      yield* fileSystem.makeDirectory(`${after}/.cursor`, { recursive: true });
      // Unreadable, so the session is refused whatever transport this process started with.
      yield* fileSystem.writeFileString(`${after}/.cursor/cli-config.json`, "{ not json");
      const host: NodeJS.ProcessEnv = { HOME: before, CURSOR_API_KEY: "home-key" };
      const instanceId = ProviderInstanceId.make("cursor-home-moves");
      const opened: Array<string> = [];
      const instance = yield* CursorDriver.create({
        instanceId,
        displayName: "Cursor",
        enabled: true,
        environment: [],
        config: CursorDriver.defaultConfig(),
      }).pipe(
        Effect.provideService(HostProcess.Environment, host),
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: (request) =>
            Effect.sync(() => ({
              agentId: "native-cursor-home-" + opened.push(request.options.model?.id ?? ""),
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: () => Effect.die("no turns in this test"),
            })),
        }),
      );
      host.HOME = after;
      const threadId = ThreadId.make("home-moved");
      const modelSelection = { instanceId, model: "claude-opus-5-5" };
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: before,
      });
      const runtime = yield* instance.orchestrationAdapter.openSession({
        threadId,
        providerSessionId: ProviderSessionId.make("home-moved"),
        modelSelection,
        runtimePolicy,
      });
      const exit = yield* Effect.exit(
        runtime.ensureThread({ threadId, modelSelection, runtimePolicy }),
      );
      expect(Exit.isFailure(exit)).toBe(true);
      expect(String(Exit.isFailure(exit) ? Cause.pretty(exit.cause) : "")).toContain(
        `${after}/.cursor/cli-config.json`,
      );
      expect(opened).toEqual([]);
    }).pipe(Effect.scoped),
  );

  it.effect("catalog defaults from one backend never fill a session on another", () =>
    Effect.gen(function* () {
      const fileSystem = yield* FileSystem.FileSystem;
      const workspace = yield* fileSystem.makeTempDirectoryScoped({ prefix: "cursor-backends-" });
      // The same key string is valid at two backends whose catalogs default differently.
      const client = HttpClient.make((request) =>
        Effect.succeed(
          request.url.endsWith("/v1/me")
            ? HttpClientResponse.fromWeb(
                request,
                Response.json({ apiKeyName: "T3 Code", createdAt: "2026-01-01T00:00:00.000Z" }),
              )
            : HttpClientResponse.fromWeb(
                request,
                Response.json({
                  items: [
                    {
                      id: "claude-opus-5-5",
                      displayName: "Claude Opus 5.5",
                      parameters: [
                        {
                          id: "context",
                          displayName: "Context",
                          values: [{ value: "300k" }, { value: "1m" }],
                        },
                      ],
                      variants: [
                        {
                          displayName: "Claude Opus 5.5",
                          isDefault: true,
                          params: [
                            {
                              id: "context",
                              value: request.url.startsWith("https://b.invalid/") ? "300k" : "1m",
                            },
                          ],
                        },
                      ],
                    },
                  ],
                }),
              ),
        ),
      );
      const host: NodeJS.ProcessEnv = { CURSOR_API_KEY: "same-key" };
      const instanceId = ProviderInstanceId.make("cursor-catalog-backends");
      const openedModels: Array<AgentOptions["model"]> = [];
      const instance = yield* CursorDriver.create({
        instanceId,
        displayName: "Cursor",
        enabled: true,
        environment: [],
        config: CursorDriver.defaultConfig(),
      }).pipe(
        Effect.provideService(HostProcess.Environment, host),
        Effect.provideService(HttpClient.HttpClient, client),
        Effect.provideService(CursorAgentSdk.CursorAgentSdkRunner, {
          assertComplete: Effect.void,
          open: (request) =>
            Effect.sync(() => ({
              agentId: "native-cursor-backends-" + openedModels.push(request.options.model),
              listMessages: Effect.succeed([]),
              close: Effect.void,
              send: () => Effect.die("no turns in this test"),
            })),
        }),
      );
      const runtimePolicy = ProviderAdapter.ProviderAdapterV2RuntimePolicy.make({
        runtimeMode: "full-access",
        interactionMode: "default",
        cwd: workspace,
      });
      const modelSelection = { instanceId, model: "claude-opus-5-5" };
      const open = (name: string) =>
        Effect.gen(function* () {
          const threadId = ThreadId.make(name);
          const runtime = yield* instance.orchestrationAdapter.openSession({
            threadId,
            providerSessionId: ProviderSessionId.make(name),
            modelSelection,
            runtimePolicy,
          });
          yield* runtime.ensureThread({ threadId, modelSelection, runtimePolicy });
        });
      yield* instance.snapshot.refresh;
      yield* open("default-backend");
      // A check under backend B, with the same key, loads B's catalog.
      host.CURSOR_BACKEND_URL = "https://b.invalid";
      yield* instance.snapshot.refresh;
      delete host.CURSOR_BACKEND_URL;
      yield* open("default-backend-again");
      expect(openedModels).toEqual([
        { id: "claude-opus-5-5", params: [{ id: "context", value: "1m" }] },
        { id: "claude-opus-5-5" },
      ]);
    }).pipe(Effect.scoped),
  );
});
