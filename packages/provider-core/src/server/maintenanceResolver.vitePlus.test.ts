// @effect-diagnostics nodeBuiltinImport:off
import { expect, it } from "@effect/vitest";
import * as NodeFS from "node:fs";
import * as NodeOS from "node:os";
import * as NodePath from "node:path";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { ProviderDriverKind } from "@goat/contracts";
import * as HostProcess from "@goat/shared/HostProcess";
import { lazyChildProcessSpawner } from "@goat/shared/testing/lazyChildProcessSpawner";
import * as Crypto from "effect/Crypto";
import * as Effect from "effect/Effect";
import * as ChildProcessSpawner from "effect/process/ChildProcessSpawner";
import { makePackageManagedProviderMaintenanceResolver } from "./maintenanceResolver.ts";

const makeTempDir = (name: string) =>
  Crypto.Crypto.pipe(
    Effect.flatMap((crypto) => crypto.randomUUIDv4()),
    Effect.flatMap((id) =>
      Effect.acquireRelease(
        Effect.succeed(NodePath.join(NodeFS.realpathSync(NodeOS.tmpdir()), `${name}-${id}`)),
        (directory) =>
          Effect.sync(() => NodeFS.rmSync(directory, { recursive: true, force: true })),
      ),
    ),
  );
const packageToolUpdate = makePackageManagedProviderMaintenanceResolver({
  provider: ProviderDriverKind.make("packageTool"),
  npmPackageName: "@example/package-tool",
  nativeUpdate: null,
});
const noSpawn = lazyChildProcessSpawner(() =>
  Effect.die("maintenance resolution should not spawn a process here"),
);

function writeExecutable(path: string) {
  NodeFS.mkdirSync(NodePath.dirname(path), { recursive: true });
  NodeFS.writeFileSync(path, "#!/bin/sh\n");
  NodeFS.chmodSync(path, 0o755);
}

function linkIntoPackage(tempDir: string, name: string, packageSegments: ReadonlyArray<string>) {
  const target = NodePath.join(tempDir, ...packageSegments, "bin", `${name}.js`);
  writeExecutable(target);
  const link = NodePath.join(tempDir, "bin", name);
  NodeFS.mkdirSync(NodePath.dirname(link), { recursive: true });
  NodeFS.symlinkSync(target, link);
  return link;
}

// `vp env off` makes each shim run the next matching executable on PATH instead.
it.effect.each([
  {
    name: "a system_first shim (VP_HOME layout) to a later install",
    vpHome: ".vite-plus",
    setVpHome: true,
    configs: { ".vite-plus": "system_first" },
    vitePlus: false,
  },
  {
    name: "a system_first shim (XDG layout) to a later install",
    vpHome: ".local/share/vite-plus",
    setVpHome: false,
    configs: { ".config/vite-plus": "system_first" },
    vitePlus: false,
  },
  {
    name: "a managed VP_HOME shim despite a system_first XDG config",
    vpHome: ".local/share/vite-plus",
    setVpHome: true,
    configs: { ".local/share/vite-plus": "managed", ".config/vite-plus": "system_first" },
    vitePlus: true,
  },
] as const)("updates through vp only for the install the shim runs: $name", (fixture) =>
  Effect.gen(function* () {
    const tempDir = yield* makeTempDir("vite-plus-system-first");
    const vpHome = NodePath.join(tempDir, fixture.vpHome);
    for (const [dir, shimMode] of Object.entries(fixture.configs)) {
      NodeFS.mkdirSync(NodePath.join(tempDir, dir), { recursive: true });
      NodeFS.writeFileSync(
        NodePath.join(tempDir, dir, "config.json"),
        JSON.stringify({ shimMode }),
      );
    }
    const shim = NodePath.join(vpHome, "bin", "package-tool");
    writeExecutable(shim);
    const otherInstall = linkIntoPackage(NodePath.join(tempDir, "npm"), "package-tool", [
      "lib",
      "node_modules",
      "@example",
      "package-tool",
    ]);

    const capabilities = yield* packageToolUpdate
      .resolve({
        binaryPath: "package-tool",
        resolvedCommandPath: shim,
        realCommandPath: NodePath.join(vpHome, "current", "bin", "vp"),
        env: {
          ...(fixture.setVpHome ? { VP_HOME: vpHome } : {}),
          PATH: [NodePath.dirname(shim), NodePath.dirname(otherInstall)].join(":"),
        },
        platform: "linux",
      })
      .pipe(
        Effect.provideService(HostProcess.Platform, "linux"),
        Effect.provideService(ChildProcessSpawner.ChildProcessSpawner, noSpawn),
      );

    expect(capabilities.update?.lockKey === "vite-plus-global").toBe(fixture.vitePlus);
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer)),
);
