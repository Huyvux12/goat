import { resolveCommandPath } from "@goat/shared/shell";
import * as Effect from "effect/Effect";
import * as FileSystem from "effect/FileSystem";
import * as Option from "effect/Option";
import * as Path from "effect/Path";
import * as Schema from "effect/Schema";
import { isVitePlusGlobalCommandPath, normalizeCommandPath } from "./maintenanceCommandPaths.ts";
import type { ProviderMaintenanceResolutionContext } from "./maintenanceResolver.ts";

const decodeVitePlusConfig = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.Struct({ shimMode: Schema.optional(Schema.Unknown) })),
);

/** With `shimMode: "system_first"` (`vp env off`), a Vite+ shim runs the next same-named command on PATH. */
export const followVitePlusSystemFirstShim = Effect.fn("followVitePlusSystemFirstShim")(function* (
  context: ProviderMaintenanceResolutionContext,
) {
  if (!isVitePlusGlobalCommandPath(context.resolvedCommandPath)) return context;
  const fileSystem = yield* FileSystem.FileSystem;
  const path = yield* Path.Path;
  const shimDir = path.dirname(context.resolvedCommandPath);
  const dataDir = path.dirname(shimDir);
  // Without VP_HOME, the XDG layout keeps shims in `~/.local/share/vite-plus` and config in `$XDG_CONFIG_HOME/vite-plus`.
  const home = context.env.VP_HOME
    ? undefined
    : /^(.*)\/\.local\/share\/vite-plus$/.exec(dataDir.replaceAll("\\", "/"))?.[1];
  const configPaths = [
    ...(home !== undefined
      ? [path.join(context.env.XDG_CONFIG_HOME || path.join(home, ".config"), "vite-plus")]
      : []),
    dataDir,
  ].map((dir) => path.join(dir, "config.json"));
  const config = yield* Effect.firstSuccessOf(
    configPaths.map((configPath) => fileSystem.readFileString(configPath)),
  ).pipe(Effect.orElseSucceed(() => ""));
  if (Option.getOrUndefined(decodeVitePlusConfig(config))?.shimMode !== "system_first") {
    return context;
  }
  const delimiter = context.platform === "win32" ? ";" : ":";
  const dirKey = (dir: string) => normalizeCommandPath(dir).replace(/\/+$/, "");
  const shimDirKey = dirKey(shimDir);
  const env = Object.fromEntries(
    Object.entries(context.env).map(([name, value]) => [
      name,
      name.toLowerCase() === "path" && value
        ? value
            .split(delimiter)
            .filter((entry) => dirKey(entry) !== shimDirKey)
            .join(delimiter)
        : value,
    ]),
  );
  const command = path.basename(context.resolvedCommandPath).replace(/\.(?:exe|cmd|bat|ps1)$/i, "");
  const resolvedCommandPath = yield* resolveCommandPath(command, { env });
  if (!resolvedCommandPath) return context;
  const realCommandPath = yield* fileSystem
    .realPath(resolvedCommandPath)
    .pipe(Effect.orElseSucceed(() => resolvedCommandPath));
  return { ...context, resolvedCommandPath, realCommandPath };
});
