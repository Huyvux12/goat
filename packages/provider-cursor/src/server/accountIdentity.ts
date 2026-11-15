// @effect-diagnostics nodeBuiltinImport:off -- compared synchronously for each session and request.
import * as NodeCrypto from "node:crypto";

/** Names the Cursor account an API key belongs to, without holding the key. */
export const cursorAccountIdentity = (apiKey: string): string =>
  NodeCrypto.createHash("sha256").update(apiKey).digest("hex");
