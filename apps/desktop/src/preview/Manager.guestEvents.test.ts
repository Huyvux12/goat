import { it as effectIt } from "@effect/vitest";
import * as NodeCrypto from "@effect/platform-node/NodeCrypto";
import * as HostProcess from "@goat/shared/HostProcess";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Layer from "effect/Layer";
import * as Path from "effect/Path";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";
import { describe, expect, vi } from "vite-plus/test";

import * as DesktopEnvironment from "../app/DesktopEnvironment.ts";
import * as DesktopRendererHistory from "../telemetry/DesktopRendererHistory.ts";
import * as BrowserSession from "./BrowserSession.ts";
import * as DesktopBrowserHost from "./DesktopBrowserHost.ts";
import * as PreviewManager from "./Manager.ts";
import * as PreviewPasskeys from "./Passkeys.ts";

const { fromId } = vi.hoisted(() => ({
  fromId: vi.fn<(_id?: number) => Electron.WebContents | null>((_id?: number) => null),
}));
vi.mock("electron", () => ({
  BrowserWindow: vi.fn(),
  clipboard: { write: vi.fn() },
  nativeImage: { createFromPath: vi.fn() },
  shell: { showItemInFolder: vi.fn() },
  session: { fromPartition: vi.fn() },
  webContents: { fromId, getFocusedWebContents: vi.fn(() => null) },
}));

const managerLayer = () =>
  PreviewManager.layer.pipe(
    Layer.provideMerge(
      Layer.succeed(DesktopRendererHistory.DesktopRendererHistory, {
        register: () => Effect.void,
        recordMetrics: () => Effect.void,
        shutdown: Effect.void,
      }),
    ),
    Layer.provideMerge(DesktopBrowserHost.layer),
    Layer.provideMerge(
      Layer.succeed(
        BrowserSession.BrowserSession,
        BrowserSession.BrowserSession.of({
          getPartition: () => Effect.succeed("preview-test"),
          isPartition: () => true,
          getSession: () => Effect.succeed({ on: () => {} } as unknown as Electron.Session),
          clearCookies: () => Effect.void,
          cookiesCleared: () => Effect.void,
          clearCache: () => Effect.void,
        }),
      ),
    ),
    Layer.provideMerge(
      Layer.mock(PreviewPasskeys.PreviewPasskeys)({
        bridgeEnabled: false,
        installSessionHandlers: () => {},
        attachGuest: () => () => {},
      }),
    ),
    Layer.provideMerge(
      Layer.succeed(DesktopEnvironment.DesktopEnvironment, {
        browserArtifactsDir: "/tmp/preview-artifacts",
        dirname: "/tmp/preview",
        path: { join: (...parts: string[]) => parts.join("/") },
      } as DesktopEnvironment.DesktopEnvironment["Service"]),
    ),
    Layer.provideMerge(FileSystem.layerNoop({})),
    Layer.provideMerge(Path.layer),
    Layer.provideMerge(NodeCrypto.layer),
    Layer.provideMerge(Layer.succeed(HostProcess.Platform, "darwin")),
  );

interface TestCapturedPreviewImage {
  readonly toJPEG: () => Buffer;
  readonly getSize: () => { readonly width: number; readonly height: number };
}

const makeTestPreviewWebContents = (
  capturePage: () => Promise<TestCapturedPreviewImage>,
  id = 42,
) =>
  ({
    id,
    mainFrame: { routingId: id },
    hostWebContents: {
      id: 7,
      mainFrame: { frameTreeNodeId: 7 },
      executeJavaScript: vi.fn(async () => true),
      isDestroyed: () => false,
      session: { setDisplayMediaRequestHandler: vi.fn() },
    },
    executeJavaScript: vi.fn(async () => ({ width: 1280, height: 720 })),
    isDestroyed: () => false,
    getType: () => "webview",
    getURL: () => "https://example.com",
    getTitle: () => "Example",
    isLoadingMainFrame: () => false,
    isDevToolsOpened: () => false,
    reload: vi.fn(),
    loadURL: vi.fn(async () => undefined),
    getZoomFactor: () => 1,
    setZoomFactor: vi.fn(),
    setAudioMuted: vi.fn(),
    setBackgroundThrottling: vi.fn(),
    isCurrentlyAudible: () => false,
    on: vi.fn(),
    off: vi.fn(),
    ipc: { on: vi.fn(), off: vi.fn() },
    send: vi.fn(),
    navigationHistory: { canGoBack: () => false, canGoForward: () => false },
    setIgnoreMenuShortcuts: vi.fn(),
    setWindowOpenHandler: vi.fn(),
    debugger: {
      isAttached: () => false,
      attach: vi.fn(),
      sendCommand: vi.fn(async () => undefined),
      on: vi.fn(),
      off: vi.fn(),
    },
    capturePage,
  }) as unknown as Electron.WebContents;

describe("PreviewManager guest events", () => {
  effectIt.effect("reports early and subsequent load failures for the current guest", () =>
    Effect.gen(function* () {
      const host = yield* DesktopBrowserHost.DesktopBrowserHost;
      const serverTab = { threadId: "thread-1", tabId: "server-tab-1" };
      const lines = yield* Queue.unbounded<string>();
      yield* host.events.pipe(
        Stream.runForEach((line) => Queue.offer(lines, new TextDecoder().decode(line))),
        Effect.forkScoped({ startImmediately: true }),
      );
      const makeGuest = (id: number) => {
        const listeners = new Map<string, Array<(...args: unknown[]) => void>>();
        const wc = Object.assign(
          makeTestPreviewWebContents(
            async () => ({
              toJPEG: () => Buffer.from("jpeg"),
              getSize: () => ({ width: 100, height: 80 }),
            }),
            id,
          ),
          {
            isDevToolsOpened: () => false,
            getUserAgent: () => "Electron",
            once: vi.fn(),
            on: (event: string, listener: (...args: unknown[]) => void) => {
              listeners.set(event, [...(listeners.get(event) ?? []), listener]);
            },
          },
        );
        const emit = (event: string, ...args: unknown[]) => {
          for (const listener of listeners.get(event) ?? []) listener(...args);
        };
        return {
          wc,
          emit,
          fail: (url: string) =>
            emit("did-fail-load", {}, -202, "ERR_CERT_AUTHORITY_INVALID", url, true),
        };
      };
      const initial = makeGuest(42);
      const replacement = makeGuest(43);
      const manager = yield* PreviewManager.PreviewManager;
      const statuses: PreviewManager.PreviewNavStatus[] = [];
      yield* manager.subscribeStateChanges((_tabId, state) =>
        Effect.sync(() => {
          statuses.push(state.navStatus);
        }),
      );
      yield* manager.createTab("tab_1", { serverTab });
      yield* manager.prepareWebview(initial.wc);
      yield* manager.prepareWebview(replacement.wc);
      initial.fail("https://first.local/");
      initial.emit("did-start-navigation", { isMainFrame: false, isSameDocument: false });
      initial.emit("did-start-loading");
      replacement.fail("https://second.local/");
      const failure = (url: string) => ({
        type: "loadFailed",
        ...serverTab,
        url,
        code: -202,
        description: "ERR_CERT_AUTHORITY_INVALID",
      });

      fromId.mockReturnValue(initial.wc);
      yield* manager.registerWebview("tab_1", 42);
      expect(JSON.parse(yield* Queue.take(lines))).toEqual({ type: "attached", ...serverTab });
      expect(JSON.parse(yield* Queue.take(lines))).toEqual(failure("https://first.local/"));

      fromId.mockReturnValue(replacement.wc);
      yield* manager.registerWebview("tab_1", 43);
      expect(JSON.parse(yield* Queue.take(lines))).toEqual({ type: "detached", ...serverTab });
      expect(JSON.parse(yield* Queue.take(lines))).toEqual({ type: "attached", ...serverTab });
      expect(JSON.parse(yield* Queue.take(lines))).toEqual(failure("https://second.local/"));

      // A callback queued by the old guest must not report a failure for its replacement.
      initial.fail("https://stale.local/");
      replacement.fail("https://current.local/");
      expect(JSON.parse(yield* Queue.take(lines))).toEqual(failure("https://current.local/"));
      expect(statuses).not.toContainEqual(expect.objectContaining({ url: "https://stale.local/" }));

      const retried = makeGuest(44);
      yield* manager.prepareWebview(retried.wc);
      retried.fail("https://retry.local/");
      retried.emit("did-start-navigation", { isMainFrame: true, isSameDocument: false });
      fromId.mockReturnValue(retried.wc);
      yield* manager.registerWebview("tab_1", 44);
      expect(JSON.parse(yield* Queue.take(lines))).toEqual({ type: "detached", ...serverTab });
      expect(JSON.parse(yield* Queue.take(lines))).toEqual({ type: "attached", ...serverTab });
      expect(statuses.at(-1)?.kind).toBe("Success");
    }).pipe(Effect.provide(managerLayer()), Effect.scoped),
  );
});
