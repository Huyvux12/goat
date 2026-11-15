import { forgetNewBotEnvironment, newBotSlot, startNewBot } from "@goat/client-runtime/goatBot";
import { BotId, ChannelTaskId, EnvironmentId, OrchestrationV2TurnItemJson } from "@goat/contracts";
import * as Schema from "effect/Schema";
import { Profiler, cloneElement } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";
import { act, render } from "../../test/render";
import { navigationBlocked } from "../lib/navigationHolds";
import { observeResize } from "../lib/observeResize";

const state = vi.hoisted(() => ({
  beside: true,
  supported: true,
  task: undefined as string | undefined,
  sessions: [] as { marker: object }[],
  chatSession: null as object | null,
  paneSession: null as object | null,
  navigate: vi.fn(),
  bots: [] as Array<object>,
  botsLoaded: true,
  shellRefs: [] as Array<unknown>,
  memberArgs: [] as Array<unknown>,
  restore: vi.fn(async () => true),
  items: [] as Array<unknown>,
  sessionReads: [] as Array<string>,
  boundedSnapshots: true,
  /** The chat shows Home docked beside its conversation. */
  homeDocked: false,
  homeListeners: new Set<() => void>(),
}));
vi.mock("../hooks/useSettings", () => ({ useClientSettings: () => state.beside }));
vi.mock("../state/entities", () => ({
  useThreadShell: (ref: unknown) => {
    state.shellRefs.push(ref);
    return {};
  },
  resolveThreadDetailRef: () => null,
  useThreadVisibleTurnItems: () => state.items,
  // Activity lines read a session only from a server that sends a thread's newest part.
  useServerConfigs: () =>
    new Map([
      ["env", { environment: { capabilities: { goatBotOpenAsks: state.boundedSnapshots } } }],
    ]),
}));
// Records which threads' steps a view reads; reading one is what subscribes to it.
vi.mock("../state/threads", async (importOriginal) => {
  const { Atom } = await import("effect/reactivity");
  const quiet = new Map<string, unknown>();
  const history = Atom.make({ hasMoreHistory: false });
  const actual = await importOriginal<typeof import("../state/threads")>();
  return {
    ...actual,
    environmentThreadDetails: {
      ...actual.environmentThreadDetails,
      quietVisibleTurnItemsAtom: (ref: { threadId: string }) => {
        if (!quiet.has(ref.threadId))
          quiet.set(
            ref.threadId,
            Atom.make(() => {
              state.sessionReads.push(ref.threadId);
              return [];
            }),
          );
        return quiet.get(ref.threadId);
      },
      historyAtom: () => history,
    },
  };
});
// The real chat reads its steps through GoatBotStepsReader around its conversation, paused while
// hidden, and its composer keeps a draft in its own state.
vi.mock("../components/goatBot/GoatBotChatView", async () => {
  const { GoatBotStepsReader } = await import("../components/goatBot/GoatBotStepsProvider");
  // A held draft, open file or edited name: the real surfaces render this hold.
  const { HoldsNavigation } = await import("../lib/navigationHolds");
  const { createPortal } = await import("react-dom");
  const { useContext, useSyncExternalStore } = await import("react");
  const { GoatBotChatHidden, GoatBotHomeDockedRegistry } =
    await import("../components/goatBot/goatBotLayout");
  return {
    GoatBotChatView: (props: { removal?: string | null; onRestore?: () => void }) => {
      state.chatSession = props;
      const hidden = useContext(GoatBotChatHidden);
      const registerHomeDocked = useContext(GoatBotHomeDockedRegistry);
      // Home opens and closes inside the chat, without the route rendering again.
      const homeDocked = useSyncExternalStore(
        (listener) => {
          state.homeListeners.add(listener);
          return () => state.homeListeners.delete(listener);
        },
        () => state.homeDocked,
      );
      return (
        <GoatBotStepsReader rows={[]} paused={hidden}>
          <div>
            Main chat
            <input aria-label="Message" />
            {homeDocked ? (
              <aside ref={registerHomeDocked} data-goat-bot-home-docked aria-label="Home">
                <input aria-label="New wording" />
              </aside>
            ) : null}
            <HoldsNavigation />
            {/* A chat menu or Home's sheet renders outside the row, as Base UI portals do. */}
            {createPortal(
              <div role="dialog" aria-label="Chat popup">
                <button type="button">In popup</button>
              </div>,
              document.body,
            )}
            {props.removal === "deleted" ? <span>Chat removed</span> : null}
            {props.onRestore ? (
              <button type="button" onClick={props.onRestore}>
                Restore
              </button>
            ) : null}
          </div>
        </GoatBotStepsReader>
      );
    },
  };
});
vi.mock("../components/goatBot/useBotManage", () => ({
  useBotManage: () => ({ canManage: true, restore: state.restore }),
}));
vi.mock("../components/goatBot/GoatBotTaskPane", async () => {
  const { createPortal } = await import("react-dom");
  return {
    GoatBotTaskPane: ({ narrow, session }: { narrow: boolean; session: object }) => {
      state.paneSession = session;
      return (
        <section>
          <h2 tabIndex={-1} data-goat-bot-task-heading>
            Task heading
          </h2>
          <div>{narrow ? "Back to Tasks" : "Close"}</div>
          {/* The task pane's own menus portal out of the row too. */}
          {createPortal(
            <div role="menu" aria-label="Task menu">
              <button type="button">In task menu</button>
            </div>,
            document.body,
          )}
        </section>
      );
    },
  };
});
vi.mock("../components/goatBot/useGoatBotSession", () => ({
  useGoatBotSession: (items: unknown, _task: unknown, member: unknown) => {
    state.memberArgs.push(member ?? null);
    const session = {
      availability: { kind: "ready", bot: { environmentId: "env", threadId: "bot" } },
      supportsTaskThreads: state.supported,
      rows: [],
      visibleTurnItems: items,
      marker: {},
    };
    state.sessions.push(session);
    return session;
  },
}));
vi.mock("../components/goatBot/useBotRoster", () => ({
  useBotRoster: () => ({
    bots: state.bots,
    botsLoaded: state.botsLoaded,
    botsPending: false,
    environmentId: "env",
  }),
}));
vi.mock("../components/goatBot/goatBotHooks", () => ({ useLegacyGlobalAgentRoute: () => null }));
vi.mock("../components/goatBot/useGoatBotHome", () => ({ useGoatBotHomeSettings: () => ({}) }));
vi.mock("@tanstack/react-router", async (original) => ({
  ...(await original<typeof import("@tanstack/react-router")>()),
  useNavigate: () => state.navigate,
}));
import { GoatBotTaskRoute, Route } from "./_chat.bot";
import type { useGoatBotSession } from "../components/goatBot/useGoatBotSession";

/** The test window's width, which decides the 980px gate; restored on dispose. */
async function windowWidth(width: number) {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, 900);
  return { [Symbol.asyncDispose]: () => page.viewport(before.width, before.height) };
}

/** A container that sizes the route's row, as the sidebar leaves it. */
function row(width: number) {
  const container = document.createElement("div");
  container.style.width = `${width}px`;
  return container;
}

const taskRoute = (
  <GoatBotTaskRoute
    environmentId={EnvironmentId.make("env")}
    session={{ visibleTurnItems: [], rows: [] } as unknown as ReturnType<typeof useGoatBotSession>}
    taskId={ChannelTaskId.make("task")}
  />
);

it.each([
  { window: 1440, width: 720, setting: true, overlay: false },
  { window: 1440, width: 719, setting: true, overlay: true },
  { window: 960, width: 1600, setting: true, overlay: true },
  { window: 1440, width: 1128, setting: false, overlay: true },
])(
  "the task sits beside the chat only while the chat keeps 400px: window $window, row $width, setting $setting",
  async ({ window, width, setting, overlay }) => {
    state.beside = setting;
    await using _window = await windowWidth(window);
    // Navigation is not exercised here.
    await using screen = await render(taskRoute, { router: false, container: row(width) });
    await expect.element(screen.getByText(overlay ? "Back to Tasks" : "Close")).toBeVisible();
    if (overlay) await expect.element(screen.getByText("Main chat")).not.toBeVisible();
    else await expect.element(screen.getByText("Main chat")).toBeVisible();
  },
);

it("a draft in the chat survives the task replacing it and the chat coming back", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const container = row(1000);
  await using screen = await render(taskRoute, { router: false, container }); // No navigation.
  await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "Keep this draft");
  container.style.width = "700px";
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  container.style.width = "1000px";
  await expect.element(screen.getByText("Close")).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "Message" }))
    .toHaveValue("Keep this draft");
});

it("focus in the chat moves to the task heading when the task replaces it; focus elsewhere stays", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const container = row(1000);
  await using screen = await render(
    <>
      <button type="button">Search</button>
      {taskRoute}
    </>,
    { router: false, container }, // No navigation.
  );
  const message = screen.getByRole("textbox", { name: "Message" });
  await userEvent.click(message);
  container.style.width = "700px";
  await expect.element(screen.getByRole("heading", { name: "Task heading" })).toHaveFocus();

  container.style.width = "1000px";
  await expect.element(screen.getByText("Close")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "Search" }));
  container.style.width = "700px";
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  await expect.element(screen.getByRole("button", { name: "Search" })).toHaveFocus();
});

it("a chat the task replaces holds no navigation, and holds again once shown", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const container = row(1000);
  await using screen = await render(taskRoute, { router: false, container }); // No navigation.
  await expect.element(screen.getByText("Close")).toBeVisible();
  expect(navigationBlocked()).toBe(true);
  container.style.width = "700px";
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  expect(navigationBlocked()).toBe(false);
  container.style.width = "1000px";
  await expect.element(screen.getByText("Close")).toBeVisible();
  expect(navigationBlocked()).toBe(true);
});

it("focus in a popup the chat portalled out moves to the task heading when the task replaces the chat", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const container = row(1000);
  await using screen = await render(taskRoute, { router: false, container }); // No navigation.
  await expect.element(screen.getByText("Close")).toBeVisible();
  await userEvent.click(screen.getByRole("button", { name: "In popup" }));
  container.style.width = "700px";
  await expect.element(screen.getByRole("heading", { name: "Task heading" })).toHaveFocus();
});

it.each(["dialog", "menu"] as const)(
  "focus in a %s the chat does not own (the command palette, a sidebar menu) stays when the task replaces the chat",
  async (role) => {
    state.beside = true;
    await using _window = await windowWidth(1440);
    const container = row(1000);
    await using screen = await render(
      <>
        {taskRoute}
        <div role={role} aria-label="Elsewhere">
          <button type="button">Outside the chat</button>
        </div>
      </>,
      { router: false, container }, // No navigation.
    );
    await expect.element(screen.getByText("Close")).toBeVisible();
    await userEvent.click(screen.getByRole("button", { name: "Outside the chat" }));
    container.style.width = "700px";
    await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
    await expect.element(screen.getByRole("button", { name: "Outside the chat" })).toHaveFocus();
  },
);

it("the window narrowing past 980px alone also replaces the chat and hands focus to the task", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  await using screen = await render(taskRoute, { router: false, container: row(925) }); // No navigation.
  await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
  await page.viewport(979, 900);
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Task heading" })).toHaveFocus();
});

it("turning the beside setting off while the task sits beside replaces the chat, and on brings it back", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  // Navigation is not exercised here.
  await using screen = await render(taskRoute, { router: false, container: row(1000) });
  await expect.element(screen.getByText("Close")).toBeVisible();
  await userEvent.click(screen.getByRole("textbox", { name: "Message" }));
  state.beside = false;
  // A fresh element: the setting is read through a mock, not a subscription.
  await screen.rerender(cloneElement(taskRoute));
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  await expect.element(screen.getByText("Main chat")).not.toBeVisible();
  await expect.element(screen.getByRole("heading", { name: "Task heading" })).toHaveFocus();
  state.beside = true;
  // A fresh element: the setting is read through a mock, not a subscription.
  await screen.rerender(cloneElement(taskRoute));
  await expect.element(screen.getByText("Close")).toBeVisible();
  await expect.element(screen.getByText("Main chat")).toBeVisible();
});

it("performance invariant: sweeping the window from 1440 to 960 commits the route once per threshold at most", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const sidebar = 312;
  const container = row(1440 - sidebar);
  let commits = 0;
  await using screen = await render(
    <Profiler id="task-route" onRender={() => commits++}>
      {taskRoute}
    </Profiler>,
    { router: false, container }, // No navigation.
  );
  await expect.element(screen.getByText("Close")).toBeVisible();
  let resized = () => {};
  const stop = observeResize(container, () => resized());
  try {
    commits = 0;
    for (let width = 1424; width >= 960; width -= 16) {
      await page.viewport(width, 900);
      const delivered = new Promise<void>((resolve) => (resized = resolve));
      container.style.width = `${width - sidebar}px`;
      await delivered;
    }
  } finally {
    stop();
  }
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  expect(commits).toBeGreaterThan(0);
  expect(commits).toBeLessThanOrEqual(2);
});

it("shares the entry session between main chat and task pane", async () => {
  state.beside = true;
  state.supported = true;
  state.sessions = [];
  state.chatSession = null;
  state.paneSession = null;
  await using _window = await windowWidth(1440);
  using _search = vi
    .spyOn(Route, "useSearch")
    .mockReturnValue({ task: ChannelTaskId.make("task") });
  const Component = Route.options.component;
  if (!Component) throw new Error("missing route component");
  await using screen = await render(<Component />, { router: false }); // Search and navigation are mocked.
  await expect.element(screen.getByText("Main chat")).toBeVisible();
  expect(state.sessions).toHaveLength(1);
  expect(state.paneSession).toBe(state.sessions[0]);
  expect(state.chatSession).toMatchObject({ marker: state.sessions[0]?.marker });
});

it("ignores a task query when the server lacks task threads", async () => {
  state.supported = false;
  state.navigate.mockClear();
  using _search = vi
    .spyOn(Route, "useSearch")
    .mockReturnValue({ task: ChannelTaskId.make("task") });
  const Component = Route.options.component;
  if (!Component) throw new Error("missing route component");
  await using screen = await render(<Component />, { router: false }); // Search and navigation are mocked.
  await expect.element(screen.getByText("Main chat")).toBeVisible();
  expect(screen.getByText("Close").query()).toBeNull();
  expect(state.navigate).toHaveBeenCalledWith(
    expect.objectContaining({ to: "/$environmentId/$threadId", replace: true }),
  );
});

it("opens a member's task with that member's own conversation, never the main bot's", async () => {
  state.supported = true;
  state.shellRefs = [];
  state.memberArgs = [];
  await using _window = await windowWidth(1440);
  state.bots = [
    { botId: "research", role: "member", environmentId: "env", sessionThreadId: "thread-research" },
  ];
  using _search = vi
    .spyOn(Route, "useSearch")
    .mockReturnValue({ task: ChannelTaskId.make("task"), bot: BotId.make("research") });
  const Component = Route.options.component;
  if (!Component) throw new Error("missing route component");
  try {
    await using screen = await render(<Component />, { router: false }); // Search and navigation are mocked.
    await expect.element(screen.getByText("Main chat")).toBeVisible();
    expect(state.memberArgs.at(-1)).toMatchObject({ botId: "research" });
    expect(state.shellRefs.at(-1)).toMatchObject({ threadId: "thread-research" });
  } finally {
    state.bots = [];
  }
});

it("says a named bot isn't available instead of opening the main bot", async () => {
  state.memberArgs = [];
  using _search = vi
    .spyOn(Route, "useSearch")
    .mockReturnValue({ task: ChannelTaskId.make("task"), bot: BotId.make("unknown") });
  const Component = Route.options.component;
  if (!Component) throw new Error("missing route component");
  await using screen = await render(<Component />);
  await expect.element(screen.getByText("This bot isn't available")).toBeVisible();
  expect(screen.getByText("Main chat").query()).toBeNull();
});

it("opens a bot the create just returned when the list read after it failed, instead of waiting", async () => {
  const environmentId = EnvironmentId.make("env");
  forgetNewBotEnvironment(environmentId);
  const fresh = {
    botId: "fresh",
    role: "member",
    name: "New bot",
    environmentId: "env",
    sessionThreadId: "thread-fresh",
  };
  startNewBot(
    environmentId,
    [],
    async () => fresh as never,
    () => {},
    {},
    () => "request-1",
  );
  await vi.waitFor(() => expect(newBotSlot(environmentId).created).toHaveLength(1));
  state.bots = [];
  state.botsLoaded = false;
  state.memberArgs = [];
  state.shellRefs = [];
  state.chatSession = null;
  using _search = vi.spyOn(Route, "useSearch").mockReturnValue({ bot: BotId.make("fresh") });
  const Component = Route.options.component;
  if (!Component) throw new Error("missing route component");
  try {
    await using screen = await render(<Component />, { router: false }); // Search and navigation are mocked.
    await expect.element(screen.getByText("Main chat")).toBeVisible();
    expect(state.memberArgs.at(-1)).toMatchObject({ botId: "fresh" });
    expect(state.shellRefs.at(-1)).toMatchObject({ threadId: "thread-fresh" });
    expect(state.chatSession).toMatchObject({ availability: { kind: "ready" } });
  } finally {
    state.botsLoaded = true;
    forgetNewBotEnvironment(environmentId);
  }
});

it("a deleted member's task beside its chat shows the chat as deleted and offers Restore", async () => {
  state.beside = true;
  state.supported = true;
  state.restore.mockClear();
  await using _window = await windowWidth(1440);
  const deleted = {
    botId: "research",
    role: "member",
    name: "Research",
    state: "deleted",
    environmentId: "env",
    sessionThreadId: "thread-research",
  };
  state.bots = [deleted];
  using _search = vi
    .spyOn(Route, "useSearch")
    .mockReturnValue({ task: ChannelTaskId.make("task"), bot: BotId.make("research") });
  const Component = Route.options.component;
  if (!Component) throw new Error("missing route component");
  try {
    await using screen = await render(<Component />, { router: false }); // Search and navigation are mocked.
    await expect.element(screen.getByText("Chat removed")).toBeVisible();
    await screen.getByRole("button", { name: "Restore" }).click();
    expect(state.restore).toHaveBeenCalledWith(deleted);
  } finally {
    state.bots = [];
  }
});

const decodeItem = Schema.decodeUnknownSync(OrchestrationV2TurnItemJson);
const turnChip = (() => {
  const at = "2026-11-12T03:00:00.000Z";
  const item = decodeItem({
    id: "chip",
    threadId: "bot",
    runId: null,
    nodeId: null,
    providerThreadId: null,
    providerTurnId: null,
    nativeItemRef: null,
    parentItemId: null,
    ordinal: 0,
    status: "completed",
    title: null,
    startedAt: at,
    completedAt: at,
    updatedAt: at,
    type: "notification",
    source: { kind: "background_task" },
    outcome: "updated",
    summary: "Work updated",
    ledgerTask: {
      taskId: "turn-1",
      kind: "turn",
      conversationId: "conv-1",
      taskVersion: 1,
      title: "Turn",
      status: "running",
      originKind: "goat",
      requesterLabel: "Jun",
      createdAt: at,
      updatedAt: at,
      worker: { environmentId: "env", threadId: "goat-bot-session:s1", runId: "run-1" },
      openQuestionCount: 0,
    },
  });
  return {
    position: 0,
    visibility: "local",
    sourceThreadId: item.threadId,
    sourceItemId: item.id,
    item,
  };
})();

it.each([
  { width: 700, bounded: true, reads: [] },
  { width: 1128, bounded: true, reads: ["goat-bot-session:s1"] },
  { width: 1128, bounded: false, reads: [] },
])(
  "reads the main chat's turn sessions only while that chat shows beside the task, from a bounded server %#",
  async ({ width, bounded, reads }) => {
    state.boundedSnapshots = bounded;
    state.beside = true;
    state.supported = true;
    state.bots = [];
    state.items = [turnChip];
    state.sessionReads = [];
    await using _window = await windowWidth(1440);
    using _search = vi
      .spyOn(Route, "useSearch")
      .mockReturnValue({ task: ChannelTaskId.make("task") });
    const Component = Route.options.component;
    if (!Component) throw new Error("missing route component");
    try {
      // Search and navigation are mocked.
      await using screen = await render(<Component />, { router: false, container: row(width) });
      await expect.element(screen.getByText(width < 720 ? "Back to Tasks" : "Close")).toBeVisible();
      expect([...new Set(state.sessionReads)]).toEqual(reads);
    } finally {
      state.items = [];
      state.boundedSnapshots = true;
    }
  },
);

it("focus in a menu the task pane portalled out stays there when the task replaces the chat", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const container = row(1000);
  await using screen = await render(taskRoute, { router: false, container }); // No navigation.
  await expect.element(screen.getByText("Close")).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "In task menu" }));
  container.style.width = "700px";
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  await expect.element(page.getByRole("button", { name: "In task menu" })).toHaveFocus();
});

it("the chat is beside the task after the first commit, not deferred to a timer", async () => {
  state.beside = true;
  await using _window = await windowWidth(1440);
  const container = row(1000);
  // Queued from the first commit. render() drains effects inside act() first, so this rules out a
  // timer, not a passive effect; the ref callback's layout-phase update is what precedes paint.
  let seen: string | null = null;
  const probe = (element: HTMLElement | null) => {
    if (element === null || seen !== null) return;
    queueMicrotask(() => {
      seen = container.querySelector("[hidden]") === null ? "beside" : "hidden";
    });
  };
  await using screen = await render(
    <>
      {taskRoute}
      <span ref={probe} />
    </>,
    { router: false, container }, // No navigation.
  );
  await expect.element(screen.getByText("Close")).toBeVisible();
  expect(seen).toBe("beside");
});

/** Docks or removes Home inside the chat stand-in; undone on dispose. */
async function dockHome(docked: boolean) {
  const set = (value: boolean) =>
    act(() => {
      state.homeDocked = value;
      for (const listener of state.homeListeners) listener();
    });
  await set(docked);
  return { [Symbol.asyncDispose]: () => set(false) };
}

it("with Home docked the task sits beside only while the row keeps 1072px; below it the task replaces chat and Home, which come back with their input", async () => {
  state.beside = true;
  await using _home = await dockHome(true);
  await using _window = await windowWidth(1366);
  // 1366 with the sidebar collapsed leaves the row 1310; opening the sidebar leaves 1054.
  const container = row(1310);
  await using screen = await render(taskRoute, { router: false, container }); // No navigation.
  await expect.element(screen.getByText("Close")).toBeVisible();
  await userEvent.type(screen.getByRole("textbox", { name: "New wording" }), "Reply in English");
  container.style.width = "1054px";
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  await expect.element(screen.getByText("Main chat")).not.toBeVisible();
  container.style.width = "1310px";
  await expect.element(screen.getByText("Close")).toBeVisible();
  await expect
    .element(screen.getByRole("textbox", { name: "New wording" }))
    .toHaveValue("Reply in English");
});

it("a docked Home that mounts or unmounts (a reconnect) decides the layout again without a resize", async () => {
  state.beside = true;
  await using _window = await windowWidth(1366);
  await using screen = await render(taskRoute, { router: false, container: row(1054) }); // No navigation.
  await expect.element(screen.getByText("Close")).toBeVisible();
  {
    await using _home = await dockHome(true);
    await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  }
  await expect.element(screen.getByText("Close")).toBeVisible();
});

it("performance invariant: with Home docked, sweeping the window from 1440 to 960 commits the route once per threshold at most", async () => {
  state.beside = true;
  await using _home = await dockHome(true);
  await using _window = await windowWidth(1440);
  const sidebar = 312;
  const container = row(1440 - sidebar);
  let commits = 0;
  await using screen = await render(
    <Profiler id="task-route" onRender={() => commits++}>
      {taskRoute}
    </Profiler>,
    { router: false, container }, // No navigation.
  );
  await expect.element(screen.getByText("Close")).toBeVisible();
  let resized = () => {};
  const stop = observeResize(container, () => resized());
  try {
    commits = 0;
    for (let width = 1424; width >= 960; width -= 16) {
      await page.viewport(width, 900);
      const delivered = new Promise<void>((resolve) => (resized = resolve));
      container.style.width = `${width - sidebar}px`;
      await delivered;
    }
  } finally {
    stop();
  }
  await expect.element(screen.getByText("Back to Tasks")).toBeVisible();
  expect(commits).toBeGreaterThan(0);
  expect(commits).toBeLessThanOrEqual(2);
});
