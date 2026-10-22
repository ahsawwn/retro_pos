export interface Theme {
  name: string;
  primary: string;
  secondary: string;
  accent: string;
  background: string;
  text: string;
  muted: string;
}

export const themes: Record<string, Theme> = {
  amber: {
    name: "Retro Amber",
    primary: "#ffb000",
    secondary: "#ff8c00",
    accent: "#ff3300",
    background: "#1a1200",
    text: "#ffcc66",
    muted: "#664d00",
  },
  dracula: {
    name: "Dracula",
    primary: "#ff79c6",
    secondary: "#8be9fd",
    accent: "#50fa7b",
    background: "#282a36",
    text: "#f8f8f2",
    muted: "#6272a4",
  },
  catppuccin: {
    name: "Catppuccin Mocha",
    primary: "#cba6f7",
    secondary: "#89b4fa",
    accent: "#a6e3a1",
    background: "#1e1e2e",
    text: "#cdd6f4",
    muted: "#45475a",
  },
};

let currentThemeKey = "catppuccin";

export function getTheme(): Theme {
  return themes[currentThemeKey];
}

export function cycleTheme(): Theme {
  const keys = Object.keys(themes);
  const currentIndex = keys.indexOf(currentThemeKey);
  currentThemeKey = keys[(currentIndex + 1) % keys.length];
  return getTheme();
}