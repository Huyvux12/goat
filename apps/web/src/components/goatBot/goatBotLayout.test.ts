import { describe, expect, it } from "vite-plus/test";

import { goatBotHomePresentation, goatBotTaskBeside, goatBotViewFitsHome } from "./goatBotLayout";

describe("the task pane goes beside the chat only when the chat keeps 400px", () => {
  it.each([
    { windowWide: true, rowWidth: 720, besideSetting: true, beside: true },
    { windowWide: true, rowWidth: 719, besideSetting: true, beside: false },
    { windowWide: false, rowWidth: 1600, besideSetting: true, beside: false },
    { windowWide: true, rowWidth: 1600, besideSetting: false, beside: false },
  ])("window wide $windowWide, row $rowWidth, setting $besideSetting", (layout) => {
    expect(goatBotTaskBeside(layout)).toBe(layout.beside);
  });
});

describe("Home docks only when the chat view keeps 400px beside it", () => {
  it.each([
    { width: 752, fits: true },
    { width: 751, fits: false },
    { width: 0, fits: null },
  ])("a $width px chat view", ({ width, fits }) => {
    expect(goatBotViewFitsHome(width)).toBe(fits);
  });

  it.each([
    { windowWide: true, viewFits: true, hidden: false, presentation: "docked" },
    { windowWide: true, viewFits: false, hidden: false, presentation: "sheet" },
    { windowWide: false, viewFits: true, hidden: false, presentation: "sheet" },
    { windowWide: true, viewFits: true, hidden: true, presentation: "unmeasured" },
    { windowWide: true, viewFits: null, hidden: false, presentation: "unmeasured" },
    { windowWide: false, viewFits: null, hidden: false, presentation: "unmeasured" },
  ])(
    "window wide $windowWide, view fits $viewFits, hidden $hidden: $presentation",
    ({ presentation, ...layout }) => {
      expect(goatBotHomePresentation(layout)).toBe(presentation);
    },
  );
});
