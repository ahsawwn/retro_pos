import {
  getStoreConfig,
  getSetting,
  saveStoreConfig,
  setSetting,
  deleteSetting,
  type StoreConfig,
  type StoreConfigInput,
} from "./db/database";
import { themes } from "./themes/themes";

/**
 * Persistent preferences: store profile, key bindings, and the active theme.
 * All values live in SQLite so they survive terminal restarts.
 */

export type ActionName =
  | "checkout"
  | "search"
  | "discount"
  | "inventory"
  | "analytics"
  | "settings"
  | "theme"
  | "history"
  | "help"
  | "logout";

export interface ActionDefinition {
  action: ActionName;
  label: string;
  description: string;
  defaultKey: string;
}

export const ACTIONS: ActionDefinition[] = [
  { action: "checkout", label: "Checkout", description: "Open payment", defaultKey: "f10" },
  { action: "search", label: "Search / scan", description: "Focus the search bar", defaultKey: "/" },
  { action: "discount", label: "Discount", description: "Cycle cart discount", defaultKey: "d" },
  { action: "inventory", label: "Inventory", description: "Open inventory", defaultKey: "f2" },
  { action: "analytics", label: "Analytics", description: "Open analytics", defaultKey: "f3" },
  { action: "settings", label: "Settings", description: "Open settings", defaultKey: "f4" },
  { action: "theme", label: "Theme", description: "Cycle colour theme", defaultKey: "f5" },
  { action: "history", label: "Sales history", description: "Open sales history", defaultKey: "f6" },
  { action: "help", label: "Help", description: "Open keyboard guide", defaultKey: "f7" },
  { action: "logout", label: "Sign out", description: "Lock the terminal", defaultKey: "f8" },
];

export type Keybindings = Record<ActionName, string>;

export const DEFAULT_BINDINGS: Keybindings = Object.fromEntries(
  ACTIONS.map((definition) => [definition.action, definition.defaultKey])
) as Keybindings;

const BINDINGS_KEY = "keybindings";
const THEME_KEY = "theme";
const PRINT_MODE_KEY = "receipt_print_mode";
const PRINTER_DEVICE_KEY = "receipt_printer_device";

export type ReceiptPrintMode = "auto" | "ask" | "off";

export const PRINT_MODES: Array<{ mode: ReceiptPrintMode; label: string; description: string }> = [
  { mode: "auto", label: "Auto print", description: "Print immediately after checkout" },
  { mode: "ask", label: "Ask after checkout", description: "Show a print prompt on the receipt" },
  { mode: "off", label: "Off", description: "Keep receipts on screen only" },
];


const RESERVED_KEYS = new Set([
  "escape",
  "esc",
  "tab",
  "return",
  "enter",
  "backspace",
  "delete",
  "insert",
  "up",
  "down",
  "left",
  "right",
  "pageup",
  "pagedown",
  "home",
  "end",
  "space",
  "q",
]);

export function isActionName(value: string): value is ActionName {
  return ACTIONS.some((definition) => definition.action === value);
}

/** Normalize an OpenTUI key event into the token we persist. */
export function normalizeBindingKey(name: string, sequence: string): string {
  if (/^f\d{1,2}$/i.test(name)) return name.toLowerCase();
  if (name === "space") return "space";
  if (name.length === 1) return name.toLowerCase();
  // OpenTUI reports symbols such as "/" as a named key plus a printable
  // sequence. Prefer the printable character so persisted bindings stay short.
  if (sequence.length === 1 && sequence >= " " && sequence !== "\t") return sequence.toLowerCase();
  return name.toLowerCase();
}

export function isReservedBinding(key: string): boolean {
  return RESERVED_KEYS.has(key.toLowerCase());
}

export function bindingLabel(key: string): string {
  if (/^f\d{1,2}$/i.test(key)) return key.toUpperCase();
  if (key === "space") return "SPACE";
  return key.length === 1 ? key.toUpperCase() : key;
}

export function loadKeybindings(): Keybindings {
  const raw = getSetting(BINDINGS_KEY);
  if (!raw) return { ...DEFAULT_BINDINGS };

  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const bindings = { ...DEFAULT_BINDINGS };
    for (const definition of ACTIONS) {
      const value = parsed[definition.action];
      if (typeof value === "string" && value.trim()) bindings[definition.action] = value.trim().toLowerCase();
    }
    return bindings;
  } catch {
    return { ...DEFAULT_BINDINGS };
  }
}

export function saveKeybindings(bindings: Keybindings): void {
  setSetting(BINDINGS_KEY, JSON.stringify(bindings));
}

export function resetKeybindings(): Keybindings {
  saveKeybindings(DEFAULT_BINDINGS);
  return { ...DEFAULT_BINDINGS };
}

export function bindingForAction(bindings: Keybindings, action: ActionName): string {
  return bindings[action];
}

export function actionForKey(bindings: Keybindings, key: string): ActionName | null {
  const normalized = key.toLowerCase();
  for (const definition of ACTIONS) {
    if (bindings[definition.action] === normalized) return definition.action;
  }
  return null;
}

export function actionForKeyExcluding(
  bindings: Keybindings,
  key: string,
  exclude: ActionName
): ActionName | null {
  const normalized = key.toLowerCase();
  for (const definition of ACTIONS) {
    if (definition.action !== exclude && bindings[definition.action] === normalized) return definition.action;
  }
  return null;
}

/* ------------------------------------------------------------------ */
/* Theme                                                               */
/* ------------------------------------------------------------------ */

export function loadThemeKey(): string {
  const saved = getSetting(THEME_KEY);
  return saved && themes[saved] ? saved : "amber";
}

export function saveThemeKey(key: string): void {
  if (themes[key]) setSetting(THEME_KEY, key);
}

/* ------------------------------------------------------------------ */
/* Receipt printer                                                     */
/* ------------------------------------------------------------------ */

export function loadReceiptPrintMode(): ReceiptPrintMode {
  const saved = getSetting(PRINT_MODE_KEY);
  if (saved === "ask" || saved === "off" || saved === "auto") return saved;
  return "auto";
}

export function saveReceiptPrintMode(mode: ReceiptPrintMode): void {
  setSetting(PRINT_MODE_KEY, mode);
}

export function loadReceiptPrinterDevice(): string {
  return getSetting(PRINTER_DEVICE_KEY) ?? "";
}

export function saveReceiptPrinterDevice(device: string): void {
  const trimmed = device.trim();
  if (trimmed) setSetting(PRINTER_DEVICE_KEY, trimmed);
  else deleteSetting(PRINTER_DEVICE_KEY);
}

/* ------------------------------------------------------------------ */
/* Store profile                                                       */
/* ------------------------------------------------------------------ */

export function loadStoreProfile(): StoreConfig | null {
  return getStoreConfig();
}

export function updateStoreProfile(input: StoreConfigInput): StoreConfig {
  return saveStoreConfig(input);
}
