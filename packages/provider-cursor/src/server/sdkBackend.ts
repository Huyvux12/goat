const PRODUCTION_BACKEND = "https://api2.cursor.sh";
let initializedBackend: string | undefined;

/** A Cursor backend URL as GOAT compares it: the production backend when unset, no trailing slash. */
export const normalizeSdkBackend = (backend: string | undefined) =>
  (backend || PRODUCTION_BACKEND).replace(/\/+$/, "");

/** Which backend a URL names, for deciding where a credential may go: case and :443 do not matter. */
export const cursorBackendIdentity = (backend: string | undefined) => {
  const value = backend?.trim() || PRODUCTION_BACKEND;
  try {
    const url = new URL(value);
    return `${url.protocol}//${url.host}${url.pathname.replace(/\/+$/, "")}`;
  } catch {
    return value.replace(/\/+$/, "");
  }
};

export const currentSdkBackend = () => normalizeSdkBackend(process.env.CURSOR_BACKEND_URL);
export const currentCloudSdkBackend = () =>
  process.env.CURSOR_BACKEND_URL ?? "https://api.cursor.com";
export const cloudSdkBackendMatches = () =>
  process.env.CURSOR_BACKEND_URL === undefined &&
  currentCloudSdkBackend() === "https://api.cursor.com" &&
  (initializedBackend === undefined || initializedBackend === PRODUCTION_BACKEND);
export const bindSdkBackend = (backend: string) => {
  initializedBackend ??= backend;
};
export const sdkBackendMatches = (backend?: string) => {
  const selected = normalizeSdkBackend(backend);
  return (
    selected === currentSdkBackend() &&
    (initializedBackend === undefined || selected === initializedBackend)
  );
};
