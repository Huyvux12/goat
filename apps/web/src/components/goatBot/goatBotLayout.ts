import { createContext, useContext, useRef, useState, type FocusEvent } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { RESIZABLE_WIDTH_PROPERTY } from "~/hooks/useResizableWidth";
import { observeResize } from "~/lib/observeResize";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "~/rightPanelLayout";
import { useStableCallback } from "~/hooks/useStableCallback";

/** Below this the composer wraps its controls and its text field shrinks to a few words. */
const GOAT_BOT_CHAT_MIN_WIDTH = 400;

/** True while a task replaces the chat: it stays mounted for its draft but shows nothing. */
export const GoatBotChatHidden = createContext(false);

/**
 * True on the task route, where a task replaces the chat at 980px and below. Home's presentation
 * there never follows the 980px gate: the window query can flip a render before the chat hides.
 */
export const GoatBotChatCanHide = createContext(false);

/** The task route's row: a docked Home in the chat (`w-88`) leaves the task pane less room. */
export const GOAT_BOT_HOME_RESERVE_ROW_CLASS =
  "has-[[data-goat-bot-home-docked]]:[--goat-bot-home-reserve:calc(var(--spacing)*88)]";

/** The task pane's width beside the chat: never the chat's 400px or a docked Home's room. */
export const GOAT_BOT_TASK_PANE_WIDTH = `min(var(${RESIZABLE_WIDTH_PROPERTY}), calc(100% - ${GOAT_BOT_CHAT_MIN_WIDTH}px - var(--goat-bot-home-reserve, 0px)))`;

/** Where a docked Home tells the task route's row that it is there. */
export const GoatBotHomeDockedRegistry = createContext<
  (aside: HTMLElement | null) => void | (() => void)
>(() => {});

/** Open state for a popup the chat owns: a task replacing the chat closes it, as unmounting did. */
export function useGoatBotChatPopupOpen() {
  const hidden = useContext(GoatBotChatHidden);
  const [open, setOpen] = useState(false);
  if (hidden && open) setOpen(false);
  return [open && !hidden, setOpen] as const;
}
// GoatBotTaskPane's smallest resizable width and Home's docked width (`w-88`).
const TASK_PANE_MIN_WIDTH = 320;
const HOME_DOCKED_WIDTH = 352;
// A modal stays on screen over the task when the chat hides (Home's sheet, Edit bot), so focus in
// one stays; navigationHolds.tsx lists the same slots as modal.
const MODAL_POPUP = ["sheet-popup", "dialog-popup", "alert-dialog-popup", "command-dialog-popup"]
  .map((slot) => `[data-slot="${slot}"]`)
  .join(", ");

/** The window gate keeps every layout as it was at 980px and below; the row decides above it. */
export function goatBotTaskBeside(layout: {
  readonly windowWide: boolean;
  readonly rowWidth: number;
  readonly besideSetting: boolean;
  readonly homeDocked: boolean;
}): boolean {
  return (
    layout.besideSetting &&
    layout.windowWide &&
    layout.rowWidth >=
      TASK_PANE_MIN_WIDTH + GOAT_BOT_CHAT_MIN_WIDTH + (layout.homeDocked ? HOME_DOCKED_WIDTH : 0)
  );
}

/** Null while the view has no width: hidden, or not laid out yet. */
export function goatBotViewFitsHome(width: number): boolean | null {
  return width > 0 ? width >= HOME_DOCKED_WIDTH + GOAT_BOT_CHAT_MIN_WIDTH : null;
}

export type GoatBotHomePresentation = "docked" | "sheet" | "unmeasured";

/** How Home opens: docked when the window is wide and the view keeps 752px; null until measured. */
export function goatBotHomeOpenedAs(layout: {
  readonly windowWide: boolean;
  readonly viewFits: boolean | null;
}): "docked" | "sheet" | null {
  if (layout.viewFits === null) return null;
  return layout.windowWide && layout.viewFits ? "docked" : "sheet";
}

/**
 * Measures the bot route's row, where the task pane and the chat sit side by side. Before the
 * chat hides, focus inside it (or already lost to the page) moves to the task heading.
 */
export function useGoatBotTaskBeside(besideSetting: boolean) {
  const [beside, setBeside] = useState(false);
  // What is on screen; the ref callback re-runs when the setting changes and compares against it.
  const shown = useRef(false);
  // React focus events follow the component tree, so a popup the chat portals out (Home's sheet,
  // its model picker) reports here and the task pane's or the command palette's do not.
  const chatFocus = useRef<EventTarget | null>(null);
  const onChatFocus = (event: FocusEvent) => {
    chatFocus.current = event.target;
  };
  const handOffFocus = useStableCallback((row: HTMLElement) => {
    const active = row.ownerDocument.activeElement;
    const lost = active === null || active === row.ownerDocument.body;
    if (!lost && active !== chatFocus.current) return;
    if (active?.closest(MODAL_POPUP)) return;
    row.querySelector<HTMLElement>("[data-goat-bot-task-heading]")?.focus();
  });
  // While the task replaces the chat, a modal of the chat that closes (Home's sheet, Edit bot)
  // returns focus to its hidden trigger, which drops it to the page; the task heading takes it.
  // Base UI portals each popup into a [data-base-ui-portal] child of <body>, emptied before it is
  // removed, so only that list is watched, and only meanwhile.
  const rowElement = useRef<HTMLElement | null>(null);
  const watchModalClose = (chat: HTMLElement | null) => {
    if (chat === null) return;
    const doc = chat.ownerDocument;
    const observer = new MutationObserver((records) => {
      const closed = records.some((record) =>
        [...record.removedNodes].some(
          (node) =>
            node instanceof Element &&
            (node.matches("[data-base-ui-portal]") ||
              node.matches(MODAL_POPUP) ||
              node.querySelector(MODAL_POPUP) !== null),
        ),
      );
      const active = doc.activeElement;
      if (closed && (active === null || active === doc.body))
        rowElement.current?.querySelector<HTMLElement>("[data-goat-bot-task-heading]")?.focus();
    });
    observer.observe(doc.body, { childList: true });
    return () => observer.disconnect();
  };
  // The docked Home registers itself, so its mount or unmount decides again without a resize; a
  // DOM read in its ref cleanup would still find it, since React detaches refs before removal.
  const dockedHome = useRef<HTMLElement | null>(null);
  const remeasure = useRef(() => {});
  const registerHomeDocked = (aside: HTMLElement | null) => {
    if (aside === null) return;
    dockedHome.current = aside;
    remeasure.current();
    return () => {
      if (dockedHome.current === aside) dockedHome.current = null;
      remeasure.current();
    };
  };
  const rowRef = (row: HTMLElement | null) => {
    if (row === null) return;
    rowElement.current = row;
    const windowQuery = window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
    const measure = () => {
      if (!row.isConnected) return;
      const next = goatBotTaskBeside({
        windowWide: !windowQuery.matches,
        rowWidth: row.getBoundingClientRect().width,
        besideSetting,
        homeDocked: dockedHome.current !== null,
      });
      if (next === shown.current) return;
      if (!next) handOffFocus(row);
      shown.current = next;
      setBeside(next);
    };
    measure();
    remeasure.current = measure;
    windowQuery.addEventListener("change", measure);
    const stopObserving = observeResize(row, measure);
    return () => {
      remeasure.current = () => {};
      windowQuery.removeEventListener("change", measure);
      stopObserving();
    };
  };
  return { beside, rowRef, onChatFocus, watchModalClose, registerHomeDocked };
}

/**
 * Measures the chat view itself, which a docked Home shares with the conversation. Home keeps the
 * presentation it opened in until it closes, so no resize remounts it between its panel and its
 * sheet. Only dev's 980px gate chooses again, on a chat that a task cannot hide, while measured.
 */
export function useGoatBotHomePresentation(panelOpen: boolean) {
  const hidden = useContext(GoatBotChatHidden);
  const canHide = useContext(GoatBotChatCanHide);
  const windowWide = !useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const [viewFits, setViewFits] = useState<boolean | null>(null);
  // A closed Home keeps its last presentation, so the sheet's closing animation and focus run.
  const [choice, setChoice] = useState<{ live: boolean; wide: boolean; docked: boolean } | null>(
    null,
  );
  let next = choice;
  if (!panelOpen) {
    if (choice?.live) next = { ...choice, live: false };
  } else if (choice === null || !choice.live || (!canHide && choice.wide !== windowWide)) {
    const openedAs = goatBotHomeOpenedAs({ windowWide, viewFits });
    if (openedAs !== null) next = { live: true, wide: windowWide, docked: openedAs === "docked" };
  }
  if (next !== choice) setChoice(next);
  const viewRef = (view: HTMLElement | null) => {
    if (view === null) return;
    const measure = () => setViewFits(goatBotViewFitsHome(view.getBoundingClientRect().width));
    measure();
    return observeResize(view, measure);
  };
  const presentation: GoatBotHomePresentation =
    next === null ? "unmeasured" : next.docked ? "docked" : "sheet";
  return { viewRef, presentation, hidden };
}
