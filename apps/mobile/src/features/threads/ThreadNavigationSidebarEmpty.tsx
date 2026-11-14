import { Platform } from "react-native";

import { AppText as Text } from "../../components/ui/AppText";
import type { WorkspaceConnectionState } from "../../state/workspaceModel";

/** What the sidebar's thread list says when it has no rows. */
export function ThreadNavigationSidebarEmpty(props: {
  readonly catalogState: WorkspaceConnectionState;
  readonly searchQuery: string;
  readonly searchPending: boolean;
  readonly projectScopeTitle: string | null;
}) {
  const { catalogState } = props;
  return (
    <Text
      className={
        Platform.OS === "android"
          ? "px-4 py-4 text-center text-sm text-drawer-foreground-muted"
          : "px-2 py-4 text-sm text-drawer-foreground-muted"
      }
    >
      {catalogState.isLoadingConnections
        ? "Loading threads…"
        : Platform.OS === "android" && !catalogState.hasConnections
          ? "No environments connected"
          : props.searchQuery.trim().length > 0
            ? props.searchPending
              ? "Searching thread messages…"
              : "No matching threads"
            : props.projectScopeTitle !== null
              ? `No threads in ${props.projectScopeTitle}`
              : "No threads yet"}
    </Text>
  );
}
