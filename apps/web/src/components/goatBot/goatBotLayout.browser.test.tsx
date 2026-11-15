import type { CSSProperties } from "react";
import { expect, it, vi } from "vite-plus/test";

import { act, render } from "../../../test/render";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "~/hooks/useResizableWidth";
import { GOAT_BOT_HOME_RESERVE_ROW_CLASS, GOAT_BOT_TASK_PANE_WIDTH } from "./goatBotLayout";

import "~/index.css";

const STORAGE_KEY = "test:goat-bot-task-pane-width";

/** The task route's row as it lays out: the chat with Home docked beside it, then the task pane. */
function TaskRow() {
  const { width, handlers } = useResizableWidth({
    storageKey: STORAGE_KEY,
    defaultWidth: 480,
    minWidth: 320,
    maxWidth: 900,
    edge: "left",
  });
  return (
    <div className={`flex ${GOAT_BOT_HOME_RESERVE_ROW_CLASS}`} style={{ width: 1310 }}>
      <div className="flex min-w-0 flex-1">
        <div className="min-w-0 flex-1" />
        <aside data-goat-bot-home-docked className="w-88 shrink-0" />
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

it("a task pane dragged wider with Home docked stops where the chat keeps 400px and Home its width, and saves that width", async () => {
  using _stored = noStoredWidth();
  // No navigation is involved.
  await using screen = await render(<TaskRow />, { router: false });
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
  // The row is 1310px: the chat keeps 400 and the docked Home 352 (w-88).
  expect(pane.getBoundingClientRect().width).toBe(1310 - 400 - 352);
  expect(localStorage.getItem(STORAGE_KEY)).toBe(String(1310 - 400 - 352));
});
