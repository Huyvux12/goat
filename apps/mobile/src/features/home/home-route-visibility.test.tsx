import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it, vi } from "vite-plus/test";

type Listener = (event: { data: { closing: boolean } }) => void;

const mocks = vi.hoisted(() => ({
  focused: true,
  listeners: new Map<string, Set<(event: { data: { closing: boolean } }) => void>>(),
}));

vi.mock("@react-navigation/native", () => ({
  useNavigation: () => navigation,
}));

const navigation = {
  isFocused: () => mocks.focused,
  addListener(type: string, listener: Listener) {
    const set = mocks.listeners.get(type) ?? new Set();
    set.add(listener);
    mocks.listeners.set(type, set);
    return () => set.delete(listener);
  },
};

function emit(type: "transitionStart" | "transitionEnd" | "focus", closing = false) {
  act(() => {
    for (const listener of mocks.listeners.get(type) ?? []) listener({ data: { closing } });
  });
}

import { useHomeRouteVisible } from "./home-route-visibility";

function setup() {
  mocks.focused = true;
  mocks.listeners.clear();
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  const state = { visible: undefined as boolean | undefined };
  const report = (visible: boolean) => {
    state.visible = visible;
  };
  const root = createRoot(document.createElement("div"));
  act(() => root.render(<Probe report={report} />));
  return {
    state,
    [Symbol.dispose]() {
      act(() => root.unmount());
    },
  };
}

function Probe(props: { readonly report: (visible: boolean) => void }) {
  props.report(useHomeRouteVisible());
  return null;
}

// Every phone tab slot shows a copy of the Home route, and the slot a tab switch leaves
// disappears last. PRs keeps Home focused; a pushed Thread takes the focus.
it("keeps the phone thread list live after a round trip through another tab", () => {
  using home = setup();
  expect(home.state.visible).toBe(true);

  // To PRs: its slot will-appear, then the Chats slot's did-disappear.
  emit("transitionStart", false);
  emit("transitionEnd", true);
  // Back to Chats: its slot will-appear, then the PRs slot's did-disappear comes last.
  emit("focus");
  emit("transitionStart", false);
  emit("transitionEnd", true);
  expect(home.state.visible, "server changes reach the list").toBe(true);

  // A pushed Thread takes the focus and still stops the list.
  mocks.focused = false;
  emit("transitionEnd", true);
  expect(home.state.visible, "the list under a Thread holds its rows").toBe(false);
});
