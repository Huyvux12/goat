import * as DesktopAppSettings from "../settings/DesktopAppSettings.ts";
import * as DesktopWindowBounds from "./DesktopWindowBounds.ts";

type DisplayBounds = DesktopWindowBounds.DisplayBounds;

export const MIN_MAIN_WINDOW_WIDTH = DesktopAppSettings.MIN_MAIN_WINDOW_SIZE.width;
export const MIN_MAIN_WINDOW_HEIGHT = DesktopAppSettings.MIN_MAIN_WINDOW_SIZE.height;

export function getOverlapArea(left: DisplayBounds, right: DisplayBounds): number {
  const overlapWidth = Math.max(
    0,
    Math.min(left.x + left.width, right.x + right.width) - Math.max(left.x, right.x),
  );
  const overlapHeight = Math.max(
    0,
    Math.min(left.y + left.height, right.y + right.height) - Math.max(left.y, right.y),
  );
  return overlapWidth * overlapHeight;
}

function getAxisGap(
  firstStart: number,
  firstSize: number,
  secondStart: number,
  secondSize: number,
): number {
  if (firstStart + firstSize < secondStart) {
    return secondStart - (firstStart + firstSize);
  }
  if (secondStart + secondSize < firstStart) {
    return firstStart - (secondStart + secondSize);
  }
  return 0;
}

export function getDisplayDistanceSquared(
  windowBounds: DesktopAppSettings.DesktopWindowBounds,
  displayBounds: DisplayBounds,
): number {
  const dx = getAxisGap(windowBounds.x, windowBounds.width, displayBounds.x, displayBounds.width);
  const dy = getAxisGap(windowBounds.y, windowBounds.height, displayBounds.y, displayBounds.height);
  return dx * dx + dy * dy;
}

function clampDimension(value: number, minimum: number, available: number): number {
  const maximum = Math.max(minimum, Math.floor(available));
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

function clampCoordinate(value: number, start: number, available: number, size: number): number {
  const minimum = Math.round(start);
  const maximum = Math.max(minimum, Math.round(start + available) - size);
  return Math.min(Math.max(Math.round(value), minimum), maximum);
}

export function clampWindowBoundsToDisplay(
  windowBounds: DesktopAppSettings.DesktopWindowBounds,
  displayBounds: DisplayBounds,
): DesktopAppSettings.DesktopWindowBounds {
  const width = clampDimension(windowBounds.width, MIN_MAIN_WINDOW_WIDTH, displayBounds.width);
  const height = clampDimension(windowBounds.height, MIN_MAIN_WINDOW_HEIGHT, displayBounds.height);
  return {
    x: clampCoordinate(windowBounds.x, displayBounds.x, displayBounds.width, width),
    y: clampCoordinate(windowBounds.y, displayBounds.y, displayBounds.height, height),
    width,
    height,
  };
}

export function windowBoundsEqual(
  left: DesktopAppSettings.DesktopWindowBounds,
  right: DesktopAppSettings.DesktopWindowBounds,
): boolean {
  return (
    left.x === right.x &&
    left.y === right.y &&
    left.width === right.width &&
    left.height === right.height
  );
}
