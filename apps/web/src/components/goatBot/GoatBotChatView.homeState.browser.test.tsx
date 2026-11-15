import type { GoatBotRow } from "@goat/client-runtime/goatBot";
import { type BotProfile, ChannelTaskId, EnvironmentId, ThreadId } from "@goat/contracts";
import * as Cause from "effect/Cause";
import { AsyncResult } from "effect/reactivity";
import { type ReactNode } from "react";
import { expect, it, vi } from "vite-plus/test";
import { page, userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import { observeResize } from "~/lib/observeResize";

import "~/index.css";

const state = vi.hoisted(() => ({
  threads: [] as ReadonlyArray<unknown>,
  notes: [{ index: 0, date: "2026-11-07", text: "Reply in Korean" }] as Array<{
    index: number;
    date: string | null;
    text: string;
  }>,
  revision: "r1",
  /** A notes read answers again; the query mock re-reads through this, as a refresh does. */
  listeners: new Set<() => void>(),
  upsert: vi.fn(),
  updateBot: vi.fn(),
}));
vi.mock("../WorkspacePageHeader", () => ({
  WorkspacePageHeader: ({ children }: { children: ReactNode }) => <header>{children}</header>,
}));
vi.mock("./GoatBotModelPicker", () => ({ GoatBotModelPicker: () => null }));
vi.mock("./GoatBotAvatar", () => ({
  GoatBotAvatar: () => null,
  GoatBotMainAvatar: () => null,
  GoatBotSessionAvatar: () => null,
}));
vi.mock("./GoatBotTimeline", async (original) => ({
  ...(await original<typeof import("./GoatBotTimeline")>()),
  GoatBotTimeline: () => null,
}));
vi.mock("~/hooks/useMediaQuery", () => ({ useMediaQuery: () => false }));
vi.mock("./GoatBotStatusCard", () => ({ GoatBotStatusCard: () => null }));
vi.mock("./GoatBotComputer", () => ({ GoatBotComputer: () => null }));
vi.mock("./GoatBotSuggested", () => ({ GoatBotSuggested: () => null }));
vi.mock("./GoatBotLibrary", () => ({ GoatBotLibrary: () => <p>Saved files</p> }));
vi.mock("./useBotRoster", () => ({
  useBotThreads: () => ({
    rows: state.threads,
    remoteWork: [],
    supported: true,
    loaded: true,
    failed: false,
    turnsWaiting: [],
    chips: new Map(),
    refresh: () => {},
  }),
}));
// Commands this file drives carry the mock they run; every other command answers success.
vi.mock("~/state/use-atom-command", () => ({
  useAtomCommand: (command: { testExecute?: unknown }) =>
    command.testExecute ?? (async () => AsyncResult.success({})),
}));
vi.mock("~/state/server", async (original) => {
  const real = await original<typeof import("~/state/server")>();
  const { Atom } = await import("effect/reactivity");
  return {
    ...real,
    serverEnvironment: {
      ...real.serverEnvironment,
      scheduledTasksLive: () => "routines",
      upsertScheduledTask: {
        permissionAtom: () => Atom.make(true),
        testExecute: (...args: unknown[]) => state.upsert(...args),
      },
    },
  };
});
vi.mock("~/state/channels", async (original) => {
  const real = await original<typeof import("~/state/channels")>();
  const { Atom } = await import("effect/reactivity");
  return {
    ...real,
    channelEnvironment: {
      ...real.channelEnvironment,
      listBotNotes: () => "notes",
      slackSettings: () => "slack",
      updateBot: {
        permissionAtom: () => Atom.make(true),
        testExecute: (...args: unknown[]) => state.updateBot(...args),
      },
    },
  };
});
vi.mock("~/state/environments", async (original) => ({
  ...(await original<typeof import("~/state/environments")>()),
  useEnvironment: () => ({
    connection: { phase: "connected" },
    serverConfig: { environment: { capabilities: { goatBotProfileEdit: true } } },
  }),
}));
vi.mock("~/state/entities", async (original) => ({
  ...(await original<typeof import("~/state/entities")>()),
  useServerConfigs: () =>
    new Map(
      ["local", "other"].map((id) => [
        id,
        { environment: { capabilities: { goatBotNotes: true } } },
      ]),
    ),
  useThreadShell: () => ({
    id: "bot",
    projectId: "bot-project",
    modelSelection: { instanceId: "codex", model: "gpt-5" },
  }),
}));
vi.mock("~/state/query", async (original) => {
  const { useSyncExternalStore } = await import("react");
  const subscribe = (listener: () => void) => {
    state.listeners.add(listener);
    return () => state.listeners.delete(listener);
  };
  return {
    ...(await original<typeof import("~/state/query")>()),
    useEnvironmentQuery: (atom: unknown) => {
      useSyncExternalStore(subscribe, () => state.revision);
      return {
        data:
          atom === "notes"
            ? { revision: state.revision, notes: state.notes, truncated: false }
            : atom === "routines"
              ? { tasks: [] }
              : null,
        failure: null,
        error: null,
        isPending: false,
        isSuccess: true,
        refresh: () => {},
      };
    },
  };
});

import { GoatBotChatView } from "./GoatBotChatView";
import { GoatBotChatHidden } from "./goatBotLayout";
import { goatBotHomeKey } from "./goatBotHomeRequest";
import { GoatBotMainProfileContext } from "./goatBotMemberContext";

const environmentId = EnvironmentId.make("local");
const main = {
  botId: "main",
  role: "main",
  name: "GOAT Bot",
  avatar: null,
  purpose: "Runs my work",
  defaultModelSelection: null,
  defaultProjectId: null,
  environmentId,
  sessionThreadId: "bot",
  createdAt: "2026-11-07T00:00:00.000Z",
  updatedAt: "2026-11-07T00:00:00.000Z",
} as unknown as BotProfile;
const at = "2026-11-09T00:00:00.000Z";
const task = (id: string, title: string, status = "completed") => ({
  kind: "task",
  task: { taskId: id, title, status, updatedAt: at },
  view: { taskId: id, pinnedAt: null, doneAt: null, readThrough: null },
  lastActivityAt: at,
  unread: false,
  mainMessagesSinceQuiet: 0,
  worker: { environmentId: "local", threadId: `channel-worker:${id}` },
});

function setup() {
  state.threads = [task("task-a", "Fix the flaky test", "running")];
  state.notes = [
    { index: 0, date: "2026-11-07", text: "Reply in Korean" },
    { index: 1, date: "2026-11-08", text: "Keep answers short" },
  ];
  state.revision = "r1";
  state.upsert.mockReset();
  state.updateBot.mockReset();
}

function view({
  hidden = false,
  openHome = null,
  bot = environmentId,
  peek = true,
}: {
  peek?: boolean;
  hidden?: boolean;
  openHome?: { key: string; entry: string; taskId?: ChannelTaskId } | null;
  bot?: EnvironmentId;
} = {}) {
  return (
    <div style={{ width: 1200 }}>
      {/* Home docks only in a chat view of 752px or more; the 980px window gate is faked above. */}
      <GoatBotMainProfileContext value={main}>
        <GoatBotChatHidden value={hidden}>
          <GoatBotChatView
            availability={{
              kind: "ready",
              bot: { environmentId: bot, threadId: ThreadId.make("bot") },
            }}
            canOperate
            rows={[] as GoatBotRow[]}
            rowsForTask={peek ? () => [] : undefined}
            onSend={() => {}}
            onRetryInput={() => {}}
            legacyAgentRoute={null}
            openHome={openHome}
          />
        </GoatBotChatHidden>
      </GoatBotMainProfileContext>
    </div>
  );
}

type Screen = Awaited<ReturnType<typeof render>>;

/** The test window's size; the default is phone-wide, where the sheet leaves no backdrop to press. */
async function windowSize(width: number, height: number) {
  const before = { width: window.innerWidth, height: window.innerHeight };
  await page.viewport(width, height);
  return { [Symbol.asyncDispose]: () => page.viewport(before.width, before.height) };
}
const chatFrame = (screen: Screen) => screen.container.firstElementChild as HTMLElement;
const dockedHome = () => page.getByRole("complementary", { name: "GOAT Bot work" });
const homeSheet = () => page.getByRole("dialog", { name: "GOAT Bot work" });
const homeChip = (screen: Screen) => screen.getByRole("button", { name: "GOAT Bot home" });
const wording = () => page.getByRole("textbox", { name: "New wording" });

/** Resolves once the shared resize observer delivered the frame's new width to every subscriber. */
async function resizeFrame(frame: HTMLElement, width: number) {
  let resized = () => {};
  const delivered = new Promise<void>((resolve) => (resized = resolve));
  const stop = observeResize(frame, () => resized());
  try {
    // A new subscription first receives the current size; the width change comes after it.
    await delivered;
    const changed = new Promise<void>((resolve) => (resized = resolve));
    frame.style.width = `${width}px`;
    await changed;
  } finally {
    stop();
  }
}

async function typeWording(screen: Screen, text: string) {
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("tab", { name: "Library" }));
  await userEvent.click(page.getByRole("button", { name: "Ask to change" }).first());
  await userEvent.fill(wording(), text);
}

it("a typed memory wording and the Library tab stay as Home docks into its sheet and back", async () => {
  setup();
  await using screen = await render(view());
  await typeWording(screen, "Reply in Korean, then English");
  await resizeFrame(chatFrame(screen), 751);
  await expect.element(homeSheet()).toBeVisible();
  await expect
    .element(page.getByRole("tab", { name: "Library" }))
    .toHaveAttribute("aria-selected", "true");
  await expect.element(wording()).toHaveValue("Reply in Korean, then English");
  await resizeFrame(chatFrame(screen), 752);
  await expect.element(dockedHome()).toBeVisible();
  await expect.element(wording()).toHaveValue("Reply in Korean, then English");
});

it("a typed wording stays when a task beside the chat leaves Home too little room to dock", async () => {
  setup();
  await using screen = await render(view());
  await typeWording(screen, "Reply in Korean, then English");
  // 1440 with the sidebar open and a 480px task pane leaves the chat view 648px.
  await resizeFrame(chatFrame(screen), 648);
  await expect.element(homeSheet()).toBeVisible();
  await expect.element(wording()).toHaveValue("Reply in Korean, then English");
});

it("a wording typed in the sheet stays while a task replaces the chat and comes back with it", async () => {
  setup();
  await using screen = await render(view());
  await resizeFrame(chatFrame(screen), 700);
  await typeWording(screen, "Typed in the sheet");
  await expect.element(homeSheet()).toBeVisible();
  await screen.rerender(view({ hidden: true }));
  await expect.element(homeSheet()).not.toBeInTheDocument();
  await screen.rerender(view());
  await expect.element(homeSheet()).toBeVisible();
  await expect.element(wording()).toHaveValue("Typed in the sheet");
});

it("an open task peek stays open across a flip", async () => {
  setup();
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(
    dockedHome()
      .getByRole("button", { name: /^Fix the flaky test/ })
      .first(),
  );
  await expect.element(page.getByText("Go to thread")).toBeVisible();
  await resizeFrame(chatFrame(screen), 700);
  await expect.element(homeSheet()).toBeVisible();
  await expect.element(page.getByText("Go to thread")).toBeVisible();
});

it("the check-in form and its chosen time and days stay across a flip", async () => {
  setup();
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Check in on me" }));
  await userEvent.fill(page.getByLabelText("At"), "07:30");
  await userEvent.click(page.getByRole("button", { name: "Sat" }));
  await resizeFrame(chatFrame(screen), 700);
  await expect.element(homeSheet()).toBeVisible();
  await expect.element(page.getByLabelText("At")).toHaveValue("07:30");
  await expect
    .element(page.getByRole("button", { name: "Sat" }))
    .toHaveAttribute("aria-pressed", "true");
});

it("Edit bot and its typed name stay across a flip", async () => {
  setup();
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Edit bot" }));
  const editBot = page.getByRole("dialog", { name: "Edit bot" });
  await userEvent.fill(editBot.getByRole("textbox", { name: "Name" }), "Ada");
  await resizeFrame(chatFrame(screen), 700);
  await expect.element(editBot.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
});

it("Back still opens Home on its marked row when Home had collapsed the list before", async () => {
  setup();
  state.threads = Array.from({ length: 7 }, (_, index) =>
    task(`task-${index}`, `Finished ${index}`),
  );
  const key = goatBotHomeKey(environmentId, null);
  const back = (entry: string) => ({ key, entry, taskId: ChannelTaskId.make("task-6") });
  await using screen = await render(view({ peek: false, openHome: back("first") }));
  await expect.element(page.getByRole("link", { name: /^Finished 6/ })).toBeVisible();
  await userEvent.click(page.getByRole("button", { name: "Show less" }));
  await expect.element(page.getByRole("link", { name: /^Finished 6/ })).not.toBeInTheDocument();
  // The chat hides behind a task; Back reaches this Home again before it shows.
  await screen.rerender(view({ peek: false, hidden: true, openHome: back("first") }));
  await screen.rerender(view({ peek: false, hidden: true, openHome: back("second") }));
  await screen.rerender(view({ peek: false, openHome: back("second") }));
  const row = page.getByRole("link", { name: /^Finished 6/ });
  await expect.element(row).toHaveFocus();
  expect(row.element().closest("[data-home-return]")?.getAttribute("data-home-return")).toBe(
    "true",
  );
});

it.each([
  { how: "Close", sheet: false },
  { how: "Back to chat", sheet: true },
  { how: "Escape", sheet: true },
  { how: "the dimmed chat beside the sheet", sheet: true },
])(
  "closing Home with $how resets where it was and keeps the typed wording in its note",
  async ({ how, sheet }) => {
    setup();
    await using _window = await windowSize(1280, 900);
    await using screen = await render(view());
    if (sheet) await resizeFrame(chatFrame(screen), 700);
    await typeWording(screen, "Kept after closing");
    if (how === "Close") await userEvent.click(dockedHome().getByRole("button", { name: "Close" }));
    else if (how === "Back to chat")
      await userEvent.click(page.getByRole("button", { name: "Back to chat" }));
    else if (how === "Escape") {
      await userEvent.click(page.getByRole("tab", { name: "Library" }));
      await userEvent.keyboard("{Escape}");
    } else {
      const backdrop = document.querySelector<HTMLElement>("[data-slot=sheet-viewport]")!;
      await userEvent.click(page.elementLocator(backdrop), { position: { x: 40, y: 450 } });
    }
    await expect.element(homeChip(screen)).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(homeChip(screen));
    await expect
      .element(page.getByRole("tab", { name: "Home" }))
      .toHaveAttribute("aria-selected", "true");
    await userEvent.click(page.getByRole("tab", { name: "Library" }));
    // Only the note it was typed for opens with it.
    await expect.element(wording()).toHaveValue("Kept after closing");
    expect(page.getByRole("textbox", { name: "New wording" }).elements()).toHaveLength(1);
    expect(page.getByRole("button", { name: "Ask to change" }).elements()).toHaveLength(1);
  },
);

it("a notes refresh starts the new list without the wording typed for the old one", async () => {
  setup();
  await using screen = await render(view());
  await typeWording(screen, "For the old list");
  await act(() => {
    state.revision = "r2";
    for (const listener of state.listeners) listener();
  });
  await expect.element(wording()).not.toBeInTheDocument();
  await resizeFrame(chatFrame(screen), 700);
  await expect.element(homeSheet()).toBeVisible();
  await expect.element(wording()).not.toBeInTheDocument();
});

it("Escape on Edit bot drops its draft, so opening it again shows the saved name", async () => {
  setup();
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Edit bot" }));
  const editBot = page.getByRole("dialog", { name: "Edit bot" });
  await userEvent.fill(editBot.getByRole("textbox", { name: "Name" }), "Ada");
  await userEvent.keyboard("{Escape}");
  await expect.element(editBot).not.toBeInTheDocument();
  await userEvent.click(page.getByRole("button", { name: "Edit bot" }));
  await expect.element(editBot.getByRole("textbox", { name: "Name" })).toHaveValue("GOAT Bot");
});

it("another bot's or environment's Home shows nothing typed in this one", async () => {
  setup();
  await using screen = await render(view());
  await typeWording(screen, "Only for this bot");
  await screen.rerender(view({ bot: EnvironmentId.make("other") }));
  // Home stays open across the switch; its panel is the other bot's.
  await expect.element(homeChip(screen)).toHaveAttribute("aria-expanded", "true");
  await userEvent.click(page.getByRole("tab", { name: "Library" }));
  await expect.element(page.getByRole("button", { name: "Ask to change" }).first()).toBeVisible();
  expect(wording().query()).toBeNull();
});

function deferred<T>() {
  let resolve: (value: T) => void = () => {};
  const promise = new Promise<T>((done) => (resolve = done));
  return { promise, resolve };
}

it("a check-in save that finishes after a flip closes the form on screen and was sent once", async () => {
  setup();
  const answer = deferred<unknown>();
  state.upsert.mockReturnValue(answer.promise);
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Check in on me" }));
  await userEvent.click(page.getByRole("button", { name: "Save" }));
  await resizeFrame(chatFrame(screen), 700);
  await expect.element(homeSheet()).toBeVisible();
  // The save is still out, so the form on screen cannot send it again.
  await expect.element(page.getByRole("button", { name: "Save" })).toBeDisabled();
  await act(() => answer.resolve(AsyncResult.success({ task: {} })));
  await expect.element(page.getByRole("form", { name: "Check in on me" })).not.toBeInTheDocument();
  expect(state.upsert).toHaveBeenCalledTimes(1);
});

it("a check-in save refused after a flip keeps the choices and shows why on the form on screen", async () => {
  setup();
  const answer = deferred<unknown>();
  state.upsert.mockReturnValue(answer.promise);
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Check in on me" }));
  await userEvent.fill(page.getByLabelText("At"), "07:30");
  await userEvent.click(page.getByRole("button", { name: "Save" }));
  await resizeFrame(chatFrame(screen), 700);
  await act(() => answer.resolve(AsyncResult.failure(Cause.fail(new Error("Denied")))));
  await expect
    .element(homeSheet().getByRole("alert"))
    .toHaveTextContent("Couldn't save the check-in: Denied");
  await expect.element(page.getByLabelText("At")).toHaveValue("07:30");
  await expect.element(page.getByRole("button", { name: "Save" })).toBeEnabled();
  expect(state.upsert).toHaveBeenCalledTimes(1);
});

it("an Edit bot save that finishes after a flip closes the dialog on screen and was sent once", async () => {
  setup();
  const answer = deferred<unknown>();
  state.updateBot.mockReturnValue(answer.promise);
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Edit bot" }));
  const editBot = page.getByRole("dialog", { name: "Edit bot" });
  await userEvent.fill(editBot.getByRole("textbox", { name: "Name" }), "Ada");
  await userEvent.click(editBot.getByRole("button", { name: "Save" }));
  await resizeFrame(chatFrame(screen), 700);
  // The dialog on screen shows the save still out and cannot send it again.
  await expect.element(editBot.getByRole("button", { name: "Saving…" })).toBeDisabled();
  await act(() => answer.resolve(AsyncResult.success({ bot: { ...main, name: "Ada" } })));
  await expect.element(editBot).not.toBeInTheDocument();
  expect(state.updateBot).toHaveBeenCalledTimes(1);
});

it("an Edit bot save refused after a flip keeps the name and shows why in the dialog on screen", async () => {
  setup();
  const answer = deferred<unknown>();
  state.updateBot.mockReturnValue(answer.promise);
  await using screen = await render(view());
  await userEvent.click(homeChip(screen));
  await userEvent.click(page.getByRole("button", { name: "Edit bot" }));
  const editBot = page.getByRole("dialog", { name: "Edit bot" });
  await userEvent.fill(editBot.getByRole("textbox", { name: "Name" }), "Ada");
  await userEvent.click(editBot.getByRole("button", { name: "Save" }));
  await resizeFrame(chatFrame(screen), 700);
  await act(() => answer.resolve(AsyncResult.failure(Cause.fail(new Error("Name taken")))));
  await expect.element(editBot.getByRole("alert")).toBeVisible();
  await expect.element(editBot.getByRole("textbox", { name: "Name" })).toHaveValue("Ada");
  expect(state.updateBot).toHaveBeenCalledTimes(1);
});

it.each(["Cancel", "Save"])(
  "%s on the check-in form drops its choices, so opening it again shows the defaults",
  async (button) => {
    setup();
    state.upsert.mockResolvedValue(AsyncResult.success({ task: {} }));
    await using screen = await render(view());
    await userEvent.click(homeChip(screen));
    await userEvent.click(page.getByRole("button", { name: "Check in on me" }));
    await userEvent.fill(page.getByLabelText("At"), "07:30");
    await userEvent.click(page.getByRole("button", { name: button }));
    await expect
      .element(page.getByRole("form", { name: "Check in on me" }))
      .not.toBeInTheDocument();
    await userEvent.click(page.getByRole("button", { name: "Check in on me" }));
    await expect.element(page.getByLabelText("At")).toHaveValue("09:00");
  },
);
