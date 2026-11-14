import { type Ref, useImperativeHandle, useState } from "react";
import { expect, it } from "vite-plus/test";
import { userEvent } from "vite-plus/test/browser";

import { act, render } from "../../../test/render";
import {
  closeGoatBotHome,
  createGoatBotHomeStore,
  GoatBotHomeStoreContext,
  type GoatBotHomeStore,
  useGoatBotHomeState,
  useGoatBotHomeStore,
} from "./goatBotHomeState";

type Setter = { readonly set: (value: string) => void };

function Field({
  name,
  fresh = false,
  handle,
}: {
  name: string;
  fresh?: boolean;
  handle?: Ref<Setter>;
}) {
  const [value, setValue] = useGoatBotHomeState("input:draft", "", { fresh });
  useImperativeHandle(handle, () => ({ set: setValue }));
  return (
    <input aria-label={name} value={value} onChange={(event) => setValue(event.target.value)} />
  );
}

function Home({ store, children }: { store: GoatBotHomeStore | null; children: React.ReactNode }) {
  return <GoatBotHomeStoreContext value={store}>{children}</GoatBotHomeStoreContext>;
}

it("a value typed in one panel shows in the panel mounted after it", async () => {
  const store = createGoatBotHomeStore("home");
  // No navigation is involved.
  await using screen = await render(
    <Home store={store}>
      <Field name="Docked" />
    </Home>,
    { router: false },
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Docked" }), "kept");
  await screen.rerender(
    <Home store={store}>
      <Field key="sheet" name="Sheet" />
    </Home>,
  );
  await expect.element(screen.getByRole("textbox", { name: "Sheet" })).toHaveValue("kept");
});

it("a write from a panel that has unmounted reaches the panel on screen", async () => {
  const store = createGoatBotHomeStore("home");
  const handle: { current: Setter | null } = { current: null };
  // No navigation is involved.
  await using screen = await render(
    <Home store={store}>
      <Field name="Docked" handle={handle} />
    </Home>,
    { router: false },
  );
  const fromDocked = handle.current?.set;
  await screen.rerender(
    <Home store={store}>
      <Field key="sheet" name="Sheet" />
    </Home>,
  );
  await act(() => fromDocked?.("saved elsewhere"));
  await expect
    .element(screen.getByRole("textbox", { name: "Sheet" }))
    .toHaveValue("saved elsewhere");
});

it("writing the initial value removes the entry, so a cleared form leaves nothing behind", async () => {
  const store = createGoatBotHomeStore("home");
  // No navigation is involved.
  await using screen = await render(
    <Home store={store}>
      <Field name="Docked" />
    </Home>,
    { router: false },
  );
  await userEvent.type(screen.getByRole("textbox", { name: "Docked" }), "x");
  expect(store.keys()).toEqual(["input:draft"]);
  await userEvent.clear(screen.getByRole("textbox", { name: "Docked" }));
  expect(store.keys()).toEqual([]);
});

it("fresh shows the initial value over a stored one until the first write", async () => {
  const store = createGoatBotHomeStore("home");
  store.write("input:draft", "stale");
  // No navigation is involved.
  await using screen = await render(
    <Home store={store}>
      <Field name="Back" fresh />
    </Home>,
    { router: false },
  );
  const field = screen.getByRole("textbox", { name: "Back" });
  await expect.element(field).toHaveValue("");
  await userEvent.type(field, "n");
  await expect.element(field).toHaveValue("n");
  expect(store.get("input:draft")).toBe("n");
});

it("outside Home each component keeps its own state, as useState", async () => {
  // No navigation is involved.
  await using screen = await render(
    <Home store={null}>
      <Field name="One" />
      <Field name="Two" />
    </Home>,
    { router: false },
  );
  await userEvent.type(screen.getByRole("textbox", { name: "One" }), "a");
  await expect.element(screen.getByRole("textbox", { name: "Two" })).toHaveValue("");
});

function ChatView({ homeKey }: { homeKey: string }) {
  const store = useGoatBotHomeStore(homeKey);
  const [, rerender] = useState(0);
  return (
    <Home store={store}>
      <Field key={homeKey} name={homeKey} />
      <button type="button" onClick={() => rerender((n) => n + 1)}>
        Rerender
      </button>
    </Home>
  );
}

it("another bot or environment's Home sees none of this one's entries", async () => {
  // No navigation is involved.
  await using screen = await render(<ChatView homeKey="env:main" />, { router: false });
  await userEvent.type(screen.getByRole("textbox", { name: "env:main" }), "mine");
  await screen.rerender(<ChatView homeKey="env:member" />);
  await expect.element(screen.getByRole("textbox", { name: "env:member" })).toHaveValue("");
  await screen.rerender(<ChatView homeKey="env:main" />);
  await expect.element(screen.getByRole("textbox", { name: "env:main" })).toHaveValue("");
});

it("closing Home resets where it was and keeps typed input, at most one note's wording", () => {
  const store = createGoatBotHomeStore("home");
  store.write("position:tab", "Library");
  store.write("position:peek", { taskId: "t" });
  store.write("input:wording:r:1", "first");
  store.write("input:checkIn:open", true);
  store.write("input:wording:r:2", "second");
  store.write("input:editBot:name", "Ada");
  closeGoatBotHome(store);
  expect(store.keys()).toEqual(["input:checkIn:open", "input:wording:r:2"]);
});
