import type { ServerProvider, ServerProviderModel } from "@goat/contracts";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";

import type { AcpRegistryLiveConfiguration } from "./probe.ts";

interface Learned {
  readonly environmentKey: string;
  readonly models: ReadonlyArray<ServerProviderModel>;
  readonly configuration: AcpRegistryLiveConfiguration | undefined;
}

const nothingLearned: Learned = { environmentKey: "", models: [], configuration: undefined };

/**
 * Refreshes rebuild the snapshot from the probe, so what sessions taught is kept here for one
 * environment: the models a check or session last produced under it and the configuration a
 * session last reported under it. Nothing from another environment is built on.
 */
export const makeAcpRegistryLearnedModels = Effect.fn("makeAcpRegistryLearnedModels")(function* (
  merge: (
    provider: ServerProvider,
    configuration: AcpRegistryLiveConfiguration,
    previousModels: ReadonlyArray<ServerProviderModel>,
  ) => ServerProvider,
) {
  const learnedRef = yield* Ref.make(nothingLearned);
  return {
    /**
     * `checked` means `provider` was just built by a check under `environmentKey`; otherwise it is
     * the published snapshot, which may still come from an earlier environment.
     */
    apply: (
      provider: ServerProvider,
      reported: AcpRegistryLiveConfiguration | undefined,
      environmentKey: string,
      checked: boolean,
    ) =>
      Ref.modify(learnedRef, (learned): [ServerProvider, Learned] => {
        const current =
          learned.environmentKey === environmentKey
            ? learned
            : { ...nothingLearned, environmentKey };
        // The coordinator keeps one configuration per instance, so it can hold a late one from a
        // session under another environment; this environment's last one still applies.
        const configuration =
          reported !== undefined &&
          (reported.environmentKey === undefined || reported.environmentKey === environmentKey)
            ? reported
            : current.configuration;
        const base =
          checked && current.configuration === undefined ? provider.models : current.models;
        if (configuration === undefined) return [provider, { ...current, models: base }];
        const next = merge(provider, configuration, base);
        return [
          next,
          {
            environmentKey,
            models: next.models === provider.models ? base : next.models,
            configuration,
          },
        ];
      }),
    clear: Ref.set(learnedRef, nothingLearned),
  };
});
