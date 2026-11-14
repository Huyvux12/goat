import { describe, expect, it, vi } from "vite-plus/test";

import { act, render } from "../../test/render";
import { RESIZABLE_WIDTH_PROPERTY, useResizableWidth } from "./useResizableWidth";

const STORAGE_KEY = "test:responsive-panel-width";

function Panel({ defaultWidth }: { defaultWidth: number }) {
  const { handlers } = useResizableWidth({
    storageKey: STORAGE_KEY,
    defaultWidth,
    minWidth: 160,
    maxWidth: 560,
    edge: "left",
  });
  return <div role="separator" style={{ width: 8, height: 40 }} {...handlers} />;
}

function storedWidth(value: string | null): Disposable {
  const previous = localStorage.getItem(STORAGE_KEY);
  if (value === null) localStorage.removeItem(STORAGE_KEY);
  else localStorage.setItem(STORAGE_KEY, value);
  return {
    [Symbol.dispose]: () => {
      if (previous === null) localStorage.removeItem(STORAGE_KEY);
      else localStorage.setItem(STORAGE_KEY, previous);
    },
  };
}

function dragHandle(
  container: HTMLElement,
): Disposable & { drag: (from: number, to: number) => Promise<void> } {
  const handle = container.querySelector<HTMLElement>('[role="separator"]')!;
  // Synthetic drag events have no active browser pointer to capture.
  const capture = vi.spyOn(handle, "setPointerCapture").mockImplementation(() => {});
  const pointer = { bubbles: true, pointerId: 1, button: 0 };
  return {
    drag: (from, to) =>
      act(() => {
        handle.dispatchEvent(new PointerEvent("pointerdown", { ...pointer, clientX: from }));
        handle.dispatchEvent(new PointerEvent("pointerup", { ...pointer, clientX: to }));
      }),
    [Symbol.dispose]: () => capture.mockRestore(),
  };
}

describe("useResizableWidth", () => {
  it("keeps the stored width after a stationary click and persists an actual drag", async () => {
    using _stored = storedWidth(null);
    // This hook only needs browser storage and React; no navigation is involved.
    await using screen = await render(<Panel defaultWidth={240} />, { router: false });
    await screen.getByRole("separator").click();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();

    using handle = dragHandle(screen.container);
    await handle.drag(500, 500);
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
    expect(screen.container.style.getPropertyValue(RESIZABLE_WIDTH_PROPERTY)).toBe("240px");

    await handle.drag(500, 450);
    expect(localStorage.getItem(STORAGE_KEY)).toBe("290");
  });
});
