import gnomeCaptureBundle from "../apps/desktop/gnome-extension/bundle.json" with { type: "json" };

export const LINUX_CAPTURE_EXTRA_RESOURCES = [
  {
    from: "apps/desktop/prod-resources/hyprland-capture",
    to: "hyprland-capture",
  },
  {
    from: "apps/desktop/prod-resources/kde-capture",
    to: "kde-capture",
  },
  {
    from: "apps/desktop/gnome-extension",
    to: "gnome-extension",
    filter: gnomeCaptureBundle.files,
  },
] as const;
export const LINUX_BROWSER_SECRET_EXTRA_RESOURCES = [
  { from: "apps/desktop/prod-resources/browser-secret", to: "browser-secret" },
] as const;
