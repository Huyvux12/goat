import type { DesktopPreviewAnnotationTheme } from "@goat/contracts";

export const applyAnnotationTheme = (
  host: HTMLElement,
  theme: DesktopPreviewAnnotationTheme | null,
): void => {
  if (!theme) return;
  host.style.colorScheme = theme.colorScheme;
  const variables = {
    "--goat-radius": theme.radius,
    "--goat-background": theme.background,
    "--goat-foreground": theme.foreground,
    "--goat-popover": theme.popover,
    "--goat-popover-foreground": theme.popoverForeground,
    "--goat-primary": theme.primary,
    "--goat-primary-foreground": theme.primaryForeground,
    "--goat-muted": theme.muted,
    "--goat-muted-foreground": theme.mutedForeground,
    "--goat-accent": theme.accent,
    "--goat-accent-foreground": theme.accentForeground,
    "--goat-border": theme.border,
    "--goat-input": theme.input,
    "--goat-ring": theme.ring,
    "--goat-font-sans": theme.fontSans,
    "--goat-font-mono": theme.fontMono,
  };
  for (const [name, value] of Object.entries(variables)) {
    host.style.setProperty(name, value);
  }
};
