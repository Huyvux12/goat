import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

import {
  isComposerAttachmentFileRetained,
  retainComposerAttachmentFile,
} from "../../lib/composerAttachmentFiles";
import type { DraftComposerAttachment } from "../../lib/composerImages";

// The real pick lifecycle, draft ownership and + menu; only the native pickers, the native menu and
// file deletion stand in.
const native = vi.hoisted(() => ({
  pickMedia: vi.fn(),
  pickFiles: vi.fn(),
  alert: vi.fn(),
  release: vi.fn(async (_files: ReadonlyArray<unknown>) => {}),
}));
vi.mock("react-native", () => ({
  Platform: { OS: "ios" },
  Pressable: (props: {
    accessibilityLabel?: string;
    disabled?: boolean;
    onPress?: () => void;
    children?: ReactNode;
  }) => (
    <button aria-label={props.accessibilityLabel} disabled={props.disabled} onClick={props.onPress}>
      {props.children}
    </button>
  ),
}));
vi.mock("../../components/ui/useAndroidControlSizing", () => ({
  useAndroidControlSizing: () => ({ scale: 1 }),
}));
vi.mock("../../components/ui/AppSymbol", () => ({ SymbolView: () => null }));
// While mounted, the native menu offers its actions; a button per action stands for choosing one,
// and "Open menu" for the system showing it.
vi.mock("../../components/ui/Menu", () => ({
  Menu: (props: {
    actions: ReadonlyArray<{ id: string; title: string }>;
    accessibilityState?: { expanded?: boolean };
    onOpenMenu?: () => void;
    onPressAction: (event: { nativeEvent: { event: string } }) => void;
    children?: ReactNode;
  }) => (
    <div aria-label="Menu" data-expanded={String(props.accessibilityState?.expanded)}>
      <button aria-label="Open menu" onClick={props.onOpenMenu} />
      {props.children}
      {props.actions.map((action) => (
        <button
          key={action.id}
          aria-label={action.title}
          onClick={() => props.onPressAction({ nativeEvent: { event: action.id } })}
        />
      ))}
    </div>
  ),
}));
vi.mock("../../lib/composerImages", () => ({
  pickComposerMedia: native.pickMedia,
  pickComposerFiles: native.pickFiles,
}));
vi.mock("../../components/ui/Dialog", () => ({ alert: native.alert }));
vi.mock("../../state/use-composer-drafts", () => ({
  releaseUnusedComposerAttachmentFiles: native.release,
}));
vi.mock("../../components/ComposerAttachmentStrip", () => ({
  ComposerAttachmentStrip: () => null,
}));

import { GoatBotComposerMenu } from "./GoatBotComposerMenu";
import { useGoatBotDraftAttachments } from "./useGoatBotDraftAttachments";

const photo = (id: string) =>
  ({
    id,
    type: "image",
    name: `${id}.jpg`,
    mimeType: "image/jpeg",
    sizeBytes: 4,
    fileUri: `file:///documents/${id}.jpg`,
  }) as unknown as DraftComposerAttachment;

function setup() {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  native.pickMedia.mockReset();
  native.pickFiles.mockReset();
  native.alert.mockReset();
  native.release.mockClear();
}

/** The photo picker answers when the test says so. */
function heldPick() {
  const pick = Promise.withResolvers<{ attachments: DraftComposerAttachment[] }>();
  native.pickMedia.mockReturnValueOnce(pick.promise);
  return (attachments: DraftComposerAttachment[]) =>
    act(async () => {
      pick.resolve({ attachments });
      await pick.promise;
    });
}

function Composer(props: { readonly shown: boolean; readonly foreground: boolean }) {
  const files = useGoatBotDraftAttachments(props.shown);
  return (
    <>
      <GoatBotComposerMenu
        shown={props.shown && props.foreground}
        disabled={false}
        attach={files.target(10_000_000)}
        onNewRoutine={() => {}}
      />
      <output aria-label="Files">{files.attachments.map((file) => file.id).join(",")}</output>
      <output aria-label="Busy">{files.intake}</output>
      {files.attachments.map((file) => (
        <button
          key={file.id}
          aria-label={`Remove ${file.id}`}
          onClick={() => files.remove(file.id)}
        />
      ))}
      <button aria-label="Sent" onClick={files.sent} />
    </>
  );
}

async function render(shown = true, foreground = true) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const draw = (next: { shown: boolean; foreground: boolean }) =>
    act(async () => root.render(<Composer {...next} />));
  await draw({ shown, foreground });
  const find = (label: string) => container.querySelector<HTMLElement>(`[aria-label="${label}"]`);
  return {
    draw,
    press: (label: string) => act(async () => find(label)?.click()),
    has: (label: string) => find(label) !== null,
    expanded: () => find("Menu")?.getAttribute("data-expanded"),
    files: () => find("Files")?.textContent ?? "",
    busy: () => find("Busy")?.textContent,
    unmount: async () => {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}

it("a pick that answers while the app is in the background joins the message, as after Android's photo picker", async () => {
  setup();
  const answer = heldPick();
  const view = await render();
  try {
    await view.press("Photo Library");
    expect(view.busy()).toBe("1");
    await view.draw({ shown: true, foreground: false });
    await answer([photo("p1")]);
    expect(view.files()).toBe("p1");
    expect(view.busy()).toBe("0");
    expect(isComposerAttachmentFileRetained("file:///documents/p1.jpg")).toBe(true);
    expect(native.release).not.toHaveBeenCalled();
  } finally {
    await view.unmount();
  }
});

it("a pick that answers after the chat stopped being shown is released, and the box is free again", async () => {
  setup();
  const answer = heldPick();
  const view = await render();
  try {
    await view.press("Photo Library");
    await view.draw({ shown: false, foreground: true });
    expect(view.busy()).toBe("0");
    await answer([photo("p2")]);
    expect(view.files()).toBe("");
    expect(native.release).toHaveBeenCalledWith([photo("p2")]);
    expect(isComposerAttachmentFileRetained("file:///documents/p2.jpg")).toBe(false);
    // Shown again, the chat picks as before.
    const again = heldPick();
    await view.draw({ shown: true, foreground: true });
    await view.press("Photo Library");
    await again([photo("p3")]);
    expect(view.files()).toBe("p3");
  } finally {
    await view.unmount();
  }
});

it("the + menu is taken down while the chat is not shown or the app is in the background", async () => {
  setup();
  const view = await render();
  try {
    expect(view.has("New routine")).toBe(true);
    await view.draw({ shown: true, foreground: false });
    expect(view.has("New routine")).toBe(false);
    expect(view.has("Add to message")).toBe(true);
    await view.draw({ shown: false, foreground: true });
    expect(view.has("Photo Library")).toBe(false);
    await view.draw({ shown: true, foreground: true });
    expect(view.has("Photo Library")).toBe(true);
  } finally {
    await view.unmount();
  }
});

it("a menu taken down while open comes back closed", async () => {
  setup();
  const view = await render();
  try {
    await view.press("Open menu");
    expect(view.expanded()).toBe("true");
    await view.draw({ shown: true, foreground: false });
    await view.draw({ shown: true, foreground: true });
    expect(view.expanded()).toBe("false");
  } finally {
    await view.unmount();
  }
});

it("a removed file is deleted, and a sent message's files stay with whoever sends them", async () => {
  setup();
  const answer = heldPick();
  const view = await render();
  try {
    await view.press("Photo Library");
    await answer([photo("keep"), photo("drop")]);
    await view.press("Remove drop");
    expect(view.files()).toBe("keep");
    expect(native.release).toHaveBeenCalledWith([photo("drop")]);
    expect(isComposerAttachmentFileRetained("file:///documents/drop.jpg")).toBe(false);
    // The send queue holds the files it took, as the session does, before the draft lets go.
    const queued = retainComposerAttachmentFile("file:///documents/keep.jpg", () => {});
    native.release.mockClear();
    await view.press("Sent");
    expect(view.files()).toBe("");
    expect(native.release).not.toHaveBeenCalled();
    expect(isComposerAttachmentFileRetained("file:///documents/keep.jpg")).toBe(true);
    queued();
  } finally {
    await view.unmount();
  }
});

it("unmounting releases the files the draft still holds", async () => {
  setup();
  const answer = heldPick();
  const view = await render();
  await view.press("Photo Library");
  await answer([photo("left")]);
  await view.unmount();
  expect(native.release).toHaveBeenCalledWith([photo("left")]);
  expect(isComposerAttachmentFileRetained("file:///documents/left.jpg")).toBe(false);
});
