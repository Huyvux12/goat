import { useRef, useState, type FocusEvent } from "react";

import { useMediaQuery } from "~/hooks/useMediaQuery";
import { observeResize } from "~/lib/observeResize";
import { RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY } from "~/rightPanelLayout";
import { useStableCallback } from "~/hooks/useStableCallback";

/** Below this the composer wraps its controls and its text field shrinks to a few words. */
export const GOAT_BOT_CHAT_MIN_WIDTH = 400;
// GoatBotTaskPane's smallest resizable width and Home's docked width (`w-88`).
const TASK_PANE_MIN_WIDTH = 320;
const HOME_DOCKED_WIDTH = 352;

/** The window gate keeps every layout as it was at 980px and below; the row decides above it. */
export function goatBotTaskBeside(layout: {
  readonly windowWide: boolean;
  readonly rowWidth: number;
  readonly besideSetting: boolean;
}): boolean {
  return (
    layout.besideSetting &&
    layout.windowWide &&
    layout.rowWidth >= TASK_PANE_MIN_WIDTH + GOAT_BOT_CHAT_MIN_WIDTH
  );
}

/** Null while the view has no width: hidden, or not laid out yet. */
export function goatBotViewFitsHome(width: number): boolean | null {
  return width > 0 ? width >= HOME_DOCKED_WIDTH + GOAT_BOT_CHAT_MIN_WIDTH : null;
}

export type GoatBotHomePresentation = "docked" | "sheet" | "unmeasured";

/** Unmeasured shows Home nowhere, so an unknown width never mounts the sheet first. */
export function goatBotHomePresentation(layout: {
  readonly windowWide: boolean;
  readonly viewFits: boolean | null;
  readonly hidden: boolean;
}): GoatBotHomePresentation {
  if (layout.hidden || layout.viewFits === null) return "unmeasured";
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
    row.querySelector<HTMLElement>("[data-goat-bot-task-heading]")?.focus();
  });
  const rowRef = (row: HTMLElement | null) => {
    if (row === null) return;
    const windowQuery = window.matchMedia(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
    const measure = () => {
      const next = goatBotTaskBeside({
        windowWide: !windowQuery.matches,
        rowWidth: row.getBoundingClientRect().width,
        besideSetting,
      });
      if (next === shown.current) return;
      if (!next) handOffFocus(row);
      shown.current = next;
      setBeside(next);
    };
    measure();
    windowQuery.addEventListener("change", measure);
    const stopObserving = observeResize(row, measure);
    return () => {
      windowQuery.removeEventListener("change", measure);
      stopObserving();
    };
  };
  return { beside, rowRef, onChatFocus };
}

/** Measures the chat view itself, which a docked Home shares with the conversation. */
export function useGoatBotHomePresentation(hidden: boolean) {
  const windowWide = !useMediaQuery(RIGHT_PANEL_INLINE_LAYOUT_MEDIA_QUERY);
  const [viewFits, setViewFits] = useState<boolean | null>(null);
  const viewRef = (view: HTMLElement | null) => {
    if (view === null) return;
    const measure = () => setViewFits(goatBotViewFitsHome(view.getBoundingClientRect().width));
    measure();
    return observeResize(view, measure);
  };
  return { viewRef, presentation: goatBotHomePresentation({ windowWide, viewFits, hidden }) };
}
