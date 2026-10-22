/**
 * RetroPOS colour themes.
 *
 * A theme only describes colour. Layout lives in index.tsx, so switching a
 * theme is a single state change: every panel asks for the current palette and
 * repaints its border, title, background, and text colours.
 */

export interface Theme {
  key: string;
  name: string;
  /** Brand / header accent. */
  primary: string;
  /** Panel borders and supporting labels. */
  secondary: string;
  /** Active cart, totals, and selected rows. */
  accent: string;
  /** Terminal canvas behind every panel. */
  background: string;
  /** Raised panel / modal background. */
  surface: string;
  /** Default body text. */
  text: string;
  /** Hints, timestamps, and inactive labels. */
  muted: string;
  /** Explicit border colour so panels stay readable in every palette. */
  border: string;
  success: string;
  warning: string;
  danger: string;
  /** Selection colours are intentionally high contrast for keyboard use. */
  selectionBg: string;
  selectionFg: string;
}

export const themes: Record<string, Theme> = {
  amber: {
    key: "amber",
    name: "Retro Amber",
    primary: "#ffb000",
    secondary: "#ff8c00",
    accent: "#ff5f1f",
    background: "#140f00",
    surface: "#211900",
    text: "#ffd27f",
    muted: "#9a7a2e",
    border: "#8a5f00",
    success: "#b8d96b",
    warning: "#ffd166",
    danger: "#ff5c5c",
    selectionBg: "#ffb000",
    selectionFg: "#140f00",
  },
  dracula: {
    key: "dracula",
    name: "Dracula",
    primary: "#ff79c6",
    secondary: "#8be9fd",
    accent: "#50fa7b",
    background: "#21222c",
    surface: "#282a36",
    text: "#f8f8f2",
    muted: "#8b93bd",
    border: "#44475a",
    success: "#50fa7b",
    warning: "#f1fa8c",
    danger: "#ff5555",
    selectionBg: "#ff79c6",
    selectionFg: "#21222c",
  },
  catppuccin: {
    key: "catppuccin",
    name: "Catppuccin Mocha",
    primary: "#cba6f7",
    secondary: "#89b4fa",
    accent: "#a6e3a1",
    background: "#11111b",
    surface: "#1e1e2e",
    text: "#cdd6f4",
    muted: "#7f849c",
    border: "#45475a",
    success: "#a6e3a1",
    warning: "#f9e2af",
    danger: "#f38ba8",
    selectionBg: "#cba6f7",
    selectionFg: "#11111b",
  },
};

const themeKeys = Object.keys(themes);
let currentThemeKey = "amber";

export function getTheme(): Theme {
  return themes[currentThemeKey] ?? themes.amber!;
}

export function getThemeKey(): string {
  return currentThemeKey;
}

/** Advance to the next palette and return it. */
export function cycleTheme(): Theme {
  const currentIndex = themeKeys.indexOf(currentThemeKey);
  currentThemeKey = themeKeys[(currentIndex + 1) % themeKeys.length] ?? "amber";
  return getTheme();
}

/** Optional direct selection, useful for tests or a future settings screen. */
export function setTheme(key: string): Theme {
  if (themes[key]) currentThemeKey = key;
  return getTheme();
}
