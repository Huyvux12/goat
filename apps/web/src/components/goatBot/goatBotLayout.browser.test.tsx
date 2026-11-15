import type { CSSProperties } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import {
  GOAT_BOT_HOME_RESERVE_ROW_CLASS,
  GOAT_BOT_HOME_WIDTH_CLASS,
  GOAT_BOT_TASK_PANE_WIDTH,
  goatBotTaskBeside,
} from "./goatBotLayout";

import "~/index.css";

const STORAGE_KEY = "test:goat-bot-task-pane-width";

/** The task route's row as it lays out: the chat with Home docked beside it, then the task pane. */
function TaskRow({ width: rowWidth }: { width: number }) {
  const { width, handlers } = useResizableWidth({
    storageKey: STORAGE_KEY,
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 900,
    edge: "left",
  });
  return (
    <div className={`flex ${GOAT_BOT_HOME_RESERVE_ROW_CLASS}`} style={{ width: rowWidth }}>
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1" />
        <aside data-goat-bot-home-docked className={`shrink-0 ${GOAT_BOT_HOME_WIDTH_CLASS}`} />
      </div>
      <section
        aria-label="Task"
        className="relative max-w-[65%] shrink-0"
        style={
          {
            width: GOAT_BOT_TASK_PANE_WIDTH,
            [RESIZABLE_WIDTH_PROPERTY]: `${width}px`,
          } as CSSProperties
        }
      >
        <div role="separator" style={{ width: 8, height: 40 }} {...handlers} />
      </section>
    </div>
  );
}

function noStoredWidth(): Disposable {
  const previous = localStorage.getItem(STORAGE_KEY);
  localStorage.removeItem(STORAGE_KEY);
  return {
    [Symbol.dispose]: () => {
      if (previous === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, previous);
    },
  };
}

/** The interface font size, as Settings > Appearance sets it on the root; restored on dispose. */
function interfaceFontSize(px: number): Disposable {
  const before = document.documentElement.style.fontSize;
  document.documentElement.style.fontSize = `${px}px`;
  return {
    [Symbol.dispose]: () => {
      document.documentElement.style.fontSize = before;
    },
  };
}

it.each([
  { font: 16, row: 1310, pane: 1310 - 400 - 352 },
  { font: 20, row: 1260, pane: 320 },
])(
  "at a $font px interface size a pane dragged wider with Home docked stops where the chat keeps 25rem and Home 22rem, as the row's decision assumes",
  async ({ font, row, pane: expected }) => {
    using _stored = noStoredWidth();
    using _font = interfaceFontSize(font);
    // No navigation is involved.
    await using screen = await render(<TaskRow width={row} />, { router: false });
    const home = screen.container.querySelector("aside");
    expect(home?.getBoundingClientRect().width).toBe(22 * font);
    // The row's decision allows the task beside at exactly this width.
    expect(
      goatBotTaskBeside({
        windowWide: true,
        besideSetting: true,
        rowWidth: row,
        homeDocked: true,
        remPx: font,
      }),
    ).toBe(true);
    const pane = screen.getByRole("region", { name: "Task" }).element();
    const handle = pane.querySelector<HTMLElement>('[role="separator"]');
    if (handle === null) throw new Error("no handle");
    // Synthetic drag events have no active browser pointer to capture.
    using _capture = vi.spyOn(handle, "setPointerCapture").mockImplementation(() => {});
    const start = pane.getBoundingClientRect().left;
    const pointer = { bubbles: true, pointerId: 1, button: 0 };
    await act(() => {
      handle.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: start + 2 }));
      handle.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: start - 600 }));
    });
    expect(pane.getBoundingClientRect().width).toBe(expected);
    expect(localStorage.getItem(STORAGE_KEY)).toBe(String(expected));
  },
);
