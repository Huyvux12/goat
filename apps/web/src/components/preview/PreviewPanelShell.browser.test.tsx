import { expect, it } from "vite-plus/test";

import { render } from "../../../test/render";
import { PreviewPanelShell } from "./PreviewPanelShell";

import "~/index.css";

const STORAGE_KEY = "test:preview-panel-width";

it("a click on the preview panel's resize handle keeps the width the person saved", async () => {
  const previous = localStorage.getItem(STORAGE_KEY);
  // Wider than this window lets the panel be, so the panel shows its 360px cap.
  localStorage.setItem(STORAGE_KEY, "500");
  try {
    const container = document.createElement("div");
    container.style.cssText = "display: flex; width: 1200px; height: 400px";
    // The panel needs no navigation.
    await using screen = await render(
      <PreviewPanelShell mode="inline" widthStorageKey={STORAGE_KEY}>
        <p>Preview</p>
      </PreviewPanelShell>,
      { router: false, container },
    );
    await screen.getByRole("separator").click();
    expect(localStorage.getItem(STORAGE_KEY)).toBe("500");
  } finally {
    if (previous === null) localStorage.removeItem(STORAGE_KEY);
    else localStorage.setItem(STORAGE_KEY, previous);
  }
});
