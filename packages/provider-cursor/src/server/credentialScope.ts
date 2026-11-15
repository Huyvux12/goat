import { sameCursorBackend } from "./sdkBackend.ts";

/**
 * The credentials a status check may send. One the instance inherits from the server goes only to
 * the backend and usage endpoint the server names; an instance that names its own backend or usage
 * endpoint uses only credentials it sets itself. The server's values are read only in that case.
 */
export const instanceCredentials = (input: {
  readonly instanceVariables: ReadonlySet<string>;
  readonly settingsEndpoint: string | undefined;
  readonly environment: NodeJS.ProcessEnv;
  readonly server: NodeJS.ProcessEnv;
}) => {
  const { environment, server } = input;
  const own = (name: string) => input.instanceVariables.has(name);
  const ownBackend =
    own("CURSOR_BACKEND_URL") &&
    !sameCursorBackend(environment.CURSOR_BACKEND_URL, server.CURSOR_BACKEND_URL);
  const endpoint =
    input.settingsEndpoint?.trim() ||
    (own("CURSOR_API_ENDPOINT") ? environment.CURSOR_API_ENDPOINT : undefined);
  const ownEndpoint =
    endpoint !== undefined && !sameCursorBackend(endpoint, server.CURSOR_API_ENDPOINT);
  return {
    /** CURSOR_API_KEY to use, before falling back to the instance's own GOAT sign-in. */
    environmentKey: ownBackend && !own("CURSOR_API_KEY") ? undefined : environment.CURSOR_API_KEY,
    usageToken:
      ownEndpoint && !own("CURSOR_AUTH_TOKEN") ? undefined : environment.CURSOR_AUTH_TOKEN,
    /** Whether the server's CLI or Keychain login may be read for usage. */
    serverLogins: !ownEndpoint,
  };
};
