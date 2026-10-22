import {
  BoxRenderable,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core";

import {
  addIngredient,
  addProduct,
  deleteIngredient,
  deleteProduct,
  exportProductsCsv,
  getAnalytics,
  getIngredientById,
  getIngredients,
  getProductAvailability,
  getProductByBarcode,
  getProductById,
  getProducts,
  getRecentTransactions,
  getRecipesForProduct,
  getTodayStats,
  getTransactionItems,
  importProductsFile,
  initDb,
  recordTransaction,
  searchProducts,
  seedStoreData,
  setProductRecipe,
  updateIngredient,
  updateProduct,
  validateSale,
  type AnalyticsSnapshot,
  type CartItem,
  type Ingredient,
  type Product,
  type StoreConfig,
  type StoreType,
  type TransactionRecord,
} from "./db/database";
import {
  authenticate,
  canManageStore,
  createAccount,
  createInitialAdmin,
  deleteAccount,
  hasAccounts,
  isAdmin,
  isPinFormatValid,
  listAccounts,
  resetPin,
  USER_ROLES,
  type Session,
} from "./auth";
import {
  ACTIONS,
  DEFAULT_BINDINGS,
  actionForKey,
  actionForKeyExcluding,
  bindingLabel,
  isReservedBinding,
  loadKeybindings,
  loadStoreProfile,
  loadThemeKey,
  normalizeBindingKey,
  resetKeybindings,
  saveKeybindings,
  saveThemeKey,
  updateStoreProfile,
  type ActionName,
  type Keybindings,
} from "./settings";
import { cycleTheme, getTheme, setTheme, type Theme } from "./themes/themes";
import {
  appendReceiptToLog,
  generateEscPosReceipt,
  generateReceiptText,
  receiptLines,
  type ReceiptData,
  type ReceiptItem,
} from "./utils/printer";

/* ------------------------------------------------------------------ */
/* Types                                                               */
/* ------------------------------------------------------------------ */

type Screen = "login" | "onboarding" | "app";
type View = "POS" | "INVENTORY" | "HISTORY" | "ANALYTICS" | "SETTINGS";
type Focus = "SEARCH" | "CATALOG" | "CART" | "INVENTORY" | "HISTORY" | "ANALYTICS" | "SETTINGS";
type StatusKind = "info" | "success" | "warning" | "danger";
type InventoryMode = "products" | "ingredients";
type SettingsSection = "menu" | "store" | "shortcuts" | "users" | "data";

interface ProductForm {
  mode: "new" | "edit";
  id: number | null;
  field: number;
  name: string;
  barcode: string;
  price: string;
  stock: string;
}

interface IngredientForm {
  mode: "new" | "edit";
  id: number | null;
  field: number;
  name: string;
  unit: string;
  stock: string;
  lowStock: string;
}

interface RecipeEditor {
  productId: number;
  productName: string;
  index: number;
  rows: Array<{ ingredientId: number; name: string; unit: string; quantity: string }>;
}

interface StoreForm {
  field: number;
  name: string;
  address: string;
  storeType: StoreType;
  currency: string;
  taxRate: string;
}

interface UserForm {
  mode: "new" | "pin";
  userId: number | null;
  username: string;
  pin: string;
  roleIndex: number;
  field: number;
}

interface LoginState {
  username: string;
  pin: string;
  field: 0 | 1;
  error: string;
  attempts: number;
  lockUntil: number;
}

interface OnboardingState {
  step: number;
  name: string;
  address: string;
  storeType: StoreType;
  currency: string;
  taxRate: string;
  adminUsername: string;
  adminPin: string;
  confirmPin: string;
  error: string;
}

type ModalState =
  | { kind: "receipt"; title: string; receipt: string; note: string }
  | { kind: "help" }
  | { kind: "payment"; methodIndex: number; tendered: string; error: string | null }
  | {
      kind: "confirm";
      action: "clear-cart" | "delete-product" | "delete-ingredient" | "delete-user" | "logout";
      message: string;
      productId?: number;
      ingredientId?: number;
      userId?: number;
    }
  | null;

const FORM_FIELDS = ["Name", "Barcode", "Price", "Stock"] as const;
const INGREDIENT_FIELDS = ["Name", "Unit", "Stock", "Low"] as const;
const STORE_FIELDS = ["Name", "Address", "Type", "Currency", "Tax %"] as const;
const DISCOUNTS = [0, 5, 10, 15, 20];
const PAYMENT_METHODS = ["Cash", "Card", "Mobile"] as const;
const ONBOARDING_STEPS = 9;
const POS_FOCUS_ORDER: Focus[] = ["SEARCH", "CATALOG", "CART"];
const SETTINGS_MENU = [
  { title: "Store profile", detail: "Name, address, type, currency, tax" },
  { title: "Keyboard shortcuts", detail: "Remap global and POS keys" },
  { title: "User accounts", detail: "Admins, managers, and cashiers" },
  { title: "Import / export", detail: "Bulk product CSV or JSON" },
  { title: "Sign out", detail: "Lock the terminal" },
] as const;

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

initDb();
setTheme(loadThemeKey());

let storeConfig: StoreConfig | null = loadStoreProfile();
let currentUser: Session | null = null;
let activeTheme: Theme = getTheme();
let bindings: Keybindings = loadKeybindings();
let currencySymbol = storeConfig?.currency ?? "$";
let taxRate = storeConfig?.tax_rate ?? 0;

let screen: Screen = storeConfig ? "login" : "onboarding";
let currentView: View = "POS";
let inputMode = true;
let focus: Focus = "SEARCH";
let searchQuery = "";
let catalogIndex = 0;
let cartIndex = 0;
let historyIndex = 0;
let discountPercent = 0;
let cart: CartItem[] = [];
let products: Product[] = storeConfig ? getProducts() : [];
let ingredients: Ingredient[] = storeConfig ? getIngredients() : [];
let availability = new Map<number, number>();
let history: TransactionRecord[] = storeConfig ? getRecentTransactions(100) : [];
let todayStats = getTodayStats();
let analytics: AnalyticsSnapshot = getAnalytics();
let accounts = listAccounts();

let statusMessage = "Sign in to open the till.";
let statusKind: StatusKind = "info";
let productForm: ProductForm | null = null;
let ingredientForm: IngredientForm | null = null;
let recipeEditor: RecipeEditor | null = null;
let inventoryMode: InventoryMode = "products";
let inventoryIndex = 0;
let ingredientIndex = 0;
let modal: ModalState = null;
let modalScroll = 0;

let login: LoginState = { username: "", pin: "", field: 1, error: "", attempts: 0, lockUntil: 0 };
let onboarding: OnboardingState = {
  step: 0,
  name: "",
  address: "",
  storeType: "cafe",
  currency: "$",
  taxRate: "5",
  adminUsername: "admin",
  adminPin: "",
  confirmPin: "",
  error: "",
};

let settingsSection: SettingsSection = "menu";
let settingsMenuIndex = 0;
let storeForm: StoreForm | null = null;
let shortcutIndex = 0;
let shortcutCapture: ActionName | null = null;
let userIndex = 0;
let userForm: UserForm | null = null;
let dataImportMode = false;
let dataImportPath = "products_import.csv";
let dataMessage = "";

function storeType(): StoreType {
  return storeConfig?.store_type ?? "retail";
}

/* ------------------------------------------------------------------ */
/* Small helpers                                                       */
/* ------------------------------------------------------------------ */

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function money(value: number): string {
  return `${currencySymbol}${value.toFixed(2)}`;
}

function percent(value: number): string {
  return `${value.toFixed(value % 1 === 0 ? 0 : 2)}%`;
}

/** Clip by UTF-16 code units; all UI glyphs used here are single-width BMP. */
function clip(value: string, width: number): string {
  if (width <= 0) return "";
  return value.length > width ? value.slice(0, width) : value;
}

function padColumn(value: string, width: number, align: "left" | "right" = "left"): string {
  const text = clip(value, width);
  return align === "left" ? text.padEnd(width) : text.padStart(width);
}

function twoColumn(left: string, right: string, width: number): string {
  if (width <= 0) return "";
  const safeRight = clip(right, width);
  const safeLeft = clip(left, Math.max(0, width - safeRight.length - 1));
  const gap = Math.max(1, width - safeLeft.length - safeRight.length);
  return `${safeLeft}${" ".repeat(gap)}${safeRight}`.slice(0, width);
}

function setStatus(message: string, kind: StatusKind = "info"): void {
  statusMessage = message;
  statusKind = kind;
}

function statusColor(theme: Theme): string {
  if (statusKind === "success") return theme.success;
  if (statusKind === "warning") return theme.warning;
  if (statusKind === "danger") return theme.danger;
  return theme.text;
}

function timestampLabel(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso.slice(0, 16);
  return date.toLocaleString(undefined, {
    month: "short",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function filteredProducts(): Product[] {
  return searchQuery.trim() ? searchProducts(searchQuery) : products;
}

function clampSelections(): void {
  const visibleProducts = filteredProducts();
  catalogIndex = clamp(catalogIndex, 0, Math.max(0, visibleProducts.length - 1));
  cartIndex = clamp(cartIndex, 0, Math.max(0, cart.length - 1));
  inventoryIndex = clamp(inventoryIndex, 0, Math.max(0, products.length - 1));
  ingredientIndex = clamp(ingredientIndex, 0, Math.max(0, ingredients.length - 1));
  historyIndex = clamp(historyIndex, 0, Math.max(0, history.length - 1));
  userIndex = clamp(userIndex, 0, Math.max(0, accounts.length - 1));
}

function refreshProducts(): void {
  products = getProducts();
  ingredients = getIngredients();
  availability = getProductAvailability(storeType());
  clampSelections();
}

function refreshHistory(): void {
  history = getRecentTransactions(100);
  todayStats = getTodayStats();
  analytics = getAnalytics();
  clampSelections();
}

function refreshAll(): void {
  storeConfig = loadStoreProfile();
  currencySymbol = storeConfig?.currency ?? currencySymbol;
  taxRate = storeConfig?.tax_rate ?? 0;
  products = getProducts();
  ingredients = getIngredients();
  availability = getProductAvailability(storeType());
  history = getRecentTransactions(100);
  todayStats = getTodayStats();
  analytics = getAnalytics();
  accounts = listAccounts();
  clampSelections();
}

function availabilityFor(productId: number): number {
  return availability.get(productId) ?? 0;
}

function cycleFocus(direction: 1 | -1): void {
  if (currentView === "POS") {
    const index = POS_FOCUS_ORDER.indexOf(focus);
    const safeIndex = index < 0 ? 0 : index;
    const next = POS_FOCUS_ORDER[(safeIndex + direction + POS_FOCUS_ORDER.length) % POS_FOCUS_ORDER.length]!;
    setFocus(next);
    return;
  }
  setFocus(currentView === "INVENTORY" ? "INVENTORY" : currentView === "SETTINGS" ? "SETTINGS" : currentView === "ANALYTICS" ? "ANALYTICS" : "HISTORY");
}

function setFocus(next: Focus): void {
  focus = next;
  inputMode = next === "SEARCH" || productForm !== null || ingredientForm !== null || storeForm !== null || userForm !== null;
}

function viewLabel(): string {
  if (currentView === "POS") return "POINT OF SALE";
  if (currentView === "INVENTORY") return "INVENTORY";
  if (currentView === "HISTORY") return "SALES HISTORY";
  if (currentView === "ANALYTICS") return "ANALYTICS";
  return "SETTINGS";
}

function viewAllowed(view: View): boolean {
  if (!currentUser) return false;
  if (view === "INVENTORY" || view === "ANALYTICS" || view === "SETTINGS") {
    return canManageStore(currentUser.role);
  }
  return true;
}

function switchView(view: View): void {
  if (!viewAllowed(view)) {
    setStatus("Manager or Admin access is required for that screen.", "warning");
    updateUI();
    return;
  }

  currentView = view;
  modal = null;
  modalScroll = 0;
  productForm = null;
  ingredientForm = null;
  recipeEditor = null;
  storeForm = null;
  userForm = null;
  shortcutCapture = null;
  dataImportMode = false;
  searchQuery = "";
  catalogIndex = 0;

  if (view === "POS") {
    setFocus("CATALOG");
    setStatus("Point of sale ready — press the search key or scan a barcode.");
  } else if (view === "INVENTORY") {
    refreshProducts();
    inventoryMode = "products";
    setFocus("INVENTORY");
    setStatus("Inventory management — Enter edits the selected product.");
  } else if (view === "HISTORY") {
    refreshHistory();
    setFocus("HISTORY");
    setStatus(`Sales history — ${history.length} recent transaction${history.length === 1 ? "" : "s"}.`);
  } else if (view === "ANALYTICS") {
    refreshHistory();
    setFocus("ANALYTICS");
    setStatus("Analytics refreshed from the sales ledger.");
  } else {
    settingsSection = "menu";
    settingsMenuIndex = 0;
    setFocus("SETTINGS");
    setStatus("Settings — choose a section with ↑↓ and Enter.");
  }

  updateUI();
}

/* ------------------------------------------------------------------ */
/* Cart and sale operations                                            */
/* ------------------------------------------------------------------ */

function cartSubtotal(): number {
  return round2(cart.reduce((sum, item) => sum + item.price * item.qty, 0));
}

function cartDiscount(): number {
  return round2(cartSubtotal() * (discountPercent / 100));
}

function cartTaxable(): number {
  return round2(cartSubtotal() - cartDiscount());
}

function cartTax(): number {
  return round2(cartTaxable() * (taxRate / 100));
}

function cartTotal(): number {
  return round2(cartTaxable() + cartTax());
}

function addToCart(product: Product): void {
  const fresh = getProductById(product.id) ?? product;
  const available = availabilityFor(fresh.id);
  const isRecipe = storeType() === "cafe" && getRecipesForProduct(fresh.id).length > 0;

  if (available <= 0) {
    setStatus(isRecipe ? `${fresh.name} cannot be made — ingredients are out of stock.` : `${fresh.name} is out of stock.`, "danger");
    return;
  }

  const existing = cart.find((item) => item.id === fresh.id);
  if (existing) {
    if (existing.qty >= available) {
      setStatus(`Only ${available} × ${fresh.name} can be sold right now.`, "warning");
      return;
    }
    existing.qty += 1;
    cartIndex = cart.indexOf(existing);
    setStatus(`Added another ${fresh.name} — ${existing.qty} in cart.`, "success");
  } else {
    cart.push({ id: fresh.id, name: fresh.name, price: fresh.price, qty: 1, barcode: fresh.barcode });
    cartIndex = cart.length - 1;
    setStatus(`Added ${fresh.name} to cart.`, "success");
  }

  if (focus !== "CART" && focus !== "SEARCH") setFocus("CATALOG");
}

function changeCartQuantity(delta: number): void {
  const item = cart[cartIndex];
  if (!item) {
    setStatus("Cart is empty.", "warning");
    return;
  }

  if (delta > 0) {
    const available = availabilityFor(item.id);
    if (item.qty >= available) {
      setStatus(`Only ${available} × ${item.name} can be sold right now.`, "warning");
      return;
    }
  }

  item.qty += delta;
  if (item.qty <= 0) {
    cart.splice(cartIndex, 1);
    cartIndex = clamp(cartIndex, 0, Math.max(0, cart.length - 1));
    setStatus(`${item.name} removed from cart.`, "warning");
  } else {
    setStatus(`${item.name} quantity: ${item.qty}.`, "info");
  }
}

function removeSelectedCartItem(): void {
  const item = cart[cartIndex];
  if (!item) {
    setStatus("Nothing to remove — cart is empty.", "warning");
    return;
  }

  cart.splice(cartIndex, 1);
  cartIndex = clamp(cartIndex, 0, Math.max(0, cart.length - 1));
  setStatus(`Removed ${item.name} from cart.`, "warning");
}

function openClearCartConfirm(): void {
  if (cart.length === 0) {
    setStatus("Cart is already empty.", "warning");
    return;
  }

  modal = {
    kind: "confirm",
    action: "clear-cart",
    message: `Clear all ${cart.length} item${cart.length === 1 ? "" : "s"} from the cart?`,
  };
}

function beginCheckout(): void {
  if (!currentUser || !storeConfig) return;
  if (cart.length === 0) {
    setStatus("Cannot checkout an empty cart.", "warning");
    return;
  }

  const error = validateSale(cart, storeType());
  if (error) {
    setStatus(error, "danger");
    refreshProducts();
    return;
  }

  modal = { kind: "payment", methodIndex: 0, tendered: "", error: null };
  updateUI();
}

function receiptForValues(
  transactionId: number,
  items: ReceiptItem[],
  subtotal: number,
  discountAmount: number,
  appliedDiscountPercent: number,
  taxAmount: number,
  total: number,
  method: string,
  tendered: number,
  change: number,
  cashier: string,
  date: Date
): string {
  const data: ReceiptData = {
    storeName: storeConfig?.name ?? "RetroPOS",
    storeAddress: storeConfig?.address ?? "",
    transactionId,
    cashier,
    date,
    items,
    subtotal,
    discountAmount,
    discountPercent: appliedDiscountPercent,
    taxRate,
    taxAmount,
    total,
    paymentMethod: method,
    amountTendered: tendered,
    changeDue: change,
    currency: currencySymbol,
  };
  return generateReceiptText(data);
}

function completeSale(methodIndex: number, tenderedText: string): void {
  if (!currentUser || !storeConfig) return;
  const method = PAYMENT_METHODS[clamp(methodIndex, 0, PAYMENT_METHODS.length - 1)] ?? "Cash";
  const total = cartTotal();
  let tendered = total;
  let change = 0;

  if (method === "Cash") {
    if (tenderedText.trim()) {
      const parsed = Number.parseFloat(tenderedText);
      if (!Number.isFinite(parsed) || parsed < total) {
        modal = {
          kind: "payment",
          methodIndex,
          tendered: tenderedText,
          error: `Cash tendered must be at least ${money(total)}.`,
        };
        updateUI();
        return;
      }
      tendered = round2(parsed);
      change = round2(tendered - total);
    }
  }

  const subtotal = cartSubtotal();
  const discountAmount = cartDiscount();
  const taxAmount = cartTax();
  const receiptItems: ReceiptItem[] = cart.map((item) => ({ name: item.name, price: item.price, qty: item.qty }));

  let transactionId: number;
  try {
    transactionId = recordTransaction({
      subtotal,
      discountAmount,
      taxAmount,
      taxRate,
      total,
      method,
      items: cart,
      cashierId: currentUser.userId,
      cashierName: currentUser.username,
      amountTendered: tendered,
      changeDue: change,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    modal = { kind: "payment", methodIndex, tendered: tenderedText, error: message };
    setStatus(`Checkout failed: ${message}`, "danger");
    updateUI();
    return;
  }

  const receipt = receiptForValues(
    transactionId,
    receiptItems,
    subtotal,
    discountAmount,
    discountPercent,
    taxAmount,
    total,
    method,
    tendered,
    change,
    currentUser.username,
    new Date()
  );

  let note = "Sale saved · receipt logged in plain text and ESC/POS format.";
  try {
    appendReceiptToLog(receipt);
    appendReceiptToLog(generateEscPosReceipt(receipt), "receipts.escpos.log");
  } catch (error) {
    note = `Sale saved, but receipt logging failed: ${error instanceof Error ? error.message : String(error)}`;
  }

  console.log(receipt);

  cart = [];
  cartIndex = 0;
  discountPercent = 0;
  searchQuery = "";
  catalogIndex = 0;
  refreshProducts();
  refreshHistory();

  modal = {
    kind: "receipt",
    title: `SALE #${transactionId} COMPLETE`,
    receipt,
    note,
  };
  modalScroll = 0;
  setStatus(`Sale #${transactionId} complete — ${money(total)} ${method.toLowerCase()}.`, "success");
  updateUI();
}

/* ------------------------------------------------------------------ */
/* First-run onboarding                                                */
/* ------------------------------------------------------------------ */

function onboardingValue(state: OnboardingState, step: number): string {
  if (step === 0) return state.name;
  if (step === 1) return state.address;
  if (step === 3) return state.currency;
  if (step === 4) return state.taxRate;
  if (step === 5) return state.adminUsername;
  if (step === 6) return state.adminPin;
  if (step === 7) return state.confirmPin;
  return "";
}

function setOnboardingValue(state: OnboardingState, step: number, value: string): void {
  if (step === 0) state.name = value;
  else if (step === 1) state.address = value;
  else if (step === 3) state.currency = value;
  else if (step === 4) state.taxRate = value;
  else if (step === 5) state.adminUsername = value;
  else if (step === 6) state.adminPin = value;
  else if (step === 7) state.confirmPin = value;
}

function onboardingError(state: OnboardingState): string | null {
  if (state.step === 0 && !state.name.trim()) return "Enter the store name printed on receipts.";
  if (state.step === 1 && !state.address.trim()) return "Enter the store address printed on receipts.";
  if (state.step === 3 && !state.currency.trim()) return "Enter a currency symbol.";
  if (state.step === 4) {
    const value = Number.parseFloat(state.taxRate);
    if (!Number.isFinite(value) || value < 0 || value > 100) return "Tax rate must be between 0 and 100.";
  }
  if (state.step === 5 && !/^[a-zA-Z0-9_.-]{2,24}$/.test(state.adminUsername.trim())) {
    return "Admin username must be 2–24 letters, numbers, dots, dashes, or underscores.";
  }
  if (state.step === 6 && !isPinFormatValid(state.adminPin)) return "Admin PIN must be 4–6 digits.";
  if (state.step === 7 && state.adminPin !== state.confirmPin) return "PINs do not match.";
  if (state.step === 8) {
    if (!hasAccounts() && !isPinFormatValid(state.adminPin)) return "Return to the PIN step and set an admin PIN.";
  }
  return null;
}

function finishOnboarding(): void {
  const error = onboardingError(onboarding);
  if (error) {
    onboarding.error = error;
    updateUI();
    return;
  }

  try {
    const config = updateStoreProfile({
      name: onboarding.name,
      address: onboarding.address,
      storeType: onboarding.storeType,
      currency: onboarding.currency,
      taxRate: Number.parseFloat(onboarding.taxRate || "0"),
    });
    storeConfig = config;
    currencySymbol = config.currency;
    taxRate = config.tax_rate;
    seedStoreData(config.store_type);

    let session: Session | null = null;
    if (!hasAccounts()) session = createInitialAdmin(onboarding.adminUsername, onboarding.adminPin);

    bindings = loadKeybindings();
    refreshAll();
    modal = null;
    currentUser = session;
    screen = session ? "app" : "login";
    currentView = "POS";
    setFocus("SEARCH");
    setStatus(
      session
        ? `Welcome, ${session.username}. Demo inventory is ready — scan a barcode to begin.`
        : "Store configured. Sign in with an existing account.",
      "success"
    );
  } catch (failure) {
    onboarding.error = failure instanceof Error ? failure.message : String(failure);
  }
  updateUI();
}

function advanceOnboarding(): void {
  const error = onboardingError(onboarding);
  if (error) {
    onboarding.error = error;
    updateUI();
    return;
  }
  onboarding.error = "";
  if (onboarding.step >= ONBOARDING_STEPS - 1) {
    finishOnboarding();
    return;
  }
  onboarding.step += 1;
  updateUI();
}

function handleOnboardingKey(key: KeyEvent): void {
  const printable = isPrintable(key);
  const step = onboarding.step;

  if (key.name === "return") {
    advanceOnboarding();
    return;
  }
  if (key.name === "up") {
    onboarding.step = Math.max(0, step - 1);
    onboarding.error = "";
    updateUI();
    return;
  }
  if (key.name === "down") {
    advanceOnboarding();
    return;
  }

  if (step === 2) {
    if (key.name === "left" || key.name === "right" || key.name === "space" || key.name === "1" || key.name === "2") {
      const chooseCafe =
        key.name === "left" || key.name === "1" || (key.name === "space" && onboarding.storeType === "retail");
      onboarding.storeType = chooseCafe ? "cafe" : "retail";
      onboarding.error = "";
      updateUI();
    }
    return;
  }

  if (step === 8) return;

  if (key.name === "backspace") {
    setOnboardingValue(onboarding, step, onboardingValue(onboarding, step).slice(0, -1));
    onboarding.error = "";
    updateUI();
    return;
  }

  if (!printable) return;
  const character = key.sequence;

  if (step === 4 && ((character === "." && onboarding.taxRate.includes(".")) || !/[0-9.]/.test(character))) {
    return;
  }
  if ((step === 6 || step === 7) && !/[0-9]/.test(character)) return;

  const current = onboardingValue(onboarding, step);
  if ((step === 6 || step === 7) && current.length >= 6) return;
  if (step === 3 && current.length >= 4) return;
  if (step === 0 && current.length >= 48) return;
  if (step === 1 && current.length >= 72) return;
  if (step === 5 && current.length >= 24) return;

  setOnboardingValue(onboarding, step, `${current}${character}`);
  onboarding.error = "";
  updateUI();
}

/* ------------------------------------------------------------------ */
/* Login                                                               */
/* ------------------------------------------------------------------ */

function handleLoginKey(key: KeyEvent): void {
  if (key.name === "tab" || key.name === "up" || key.name === "down") {
    login.field = login.field === 0 ? 1 : 0;
    login.error = "";
    updateUI();
    return;
  }

  if (key.name === "return") {
    if (login.field === 0) {
      login.field = 1;
      updateUI();
      return;
    }
    attemptLogin();
    return;
  }

  if (key.name === "backspace") {
    if (login.field === 0) login.username = login.username.slice(0, -1);
    else login.pin = login.pin.slice(0, -1);
    login.error = "";
    updateUI();
    return;
  }

  if (!isPrintable(key)) return;
  if (login.field === 0) {
    if (login.username.length >= 24) return;
    login.username += key.sequence;
  } else {
    if (!/[0-9]/.test(key.sequence) || login.pin.length >= 6) return;
    login.pin += key.sequence;
  }
  login.error = "";
  updateUI();
}

function attemptLogin(): void {
  const now = Date.now();
  if (login.lockUntil > now) {
    login.error = `Too many attempts. Try again in ${Math.ceil((login.lockUntil - now) / 1000)}s.`;
    updateUI();
    return;
  }
  if (!login.pin) {
    login.error = "Enter your PIN.";
    updateUI();
    return;
  }

  const session = authenticate(login.pin, login.username.trim() || undefined);
  if (!session) {
    login.attempts += 1;
    login.error = "PIN not recognised.";
    login.pin = "";
    if (login.attempts >= 5) {
      login.attempts = 0;
      login.lockUntil = now + 10_000;
      login.error = "Too many attempts. Locked for 10 seconds.";
    }
    updateUI();
    return;
  }

  currentUser = session;
  login = { username: "", pin: "", field: 1, error: "", attempts: 0, lockUntil: 0 };
  refreshAll();
  screen = "app";
  currentView = "POS";
  setFocus("SEARCH");
  setStatus(`Welcome back, ${session.username} (${session.role}).`, "success");
  updateUI();
}

/* ------------------------------------------------------------------ */
/* Inventory actions                                                   */
/* ------------------------------------------------------------------ */

function openProductForm(mode: "new" | "edit"): void {
  if (mode === "edit") {
    const product = products[inventoryIndex];
    if (!product) {
      setStatus("Select a product to edit first.", "warning");
      return;
    }
    productForm = {
      mode: "edit",
      id: product.id,
      field: 0,
      name: product.name,
      barcode: product.barcode,
      price: product.price.toFixed(2),
      stock: String(product.stock),
    };
  } else {
    productForm = {
      mode: "new",
      id: null,
      field: 0,
      name: "",
      barcode: `890${Math.floor(1000 + Math.random() * 9000)}`,
      price: "0.00",
      stock: "0",
    };
  }
  inputMode = true;
  setStatus(`${mode === "new" ? "New product" : "Editing product"} — Tab moves fields, Ctrl+S saves.`);
  updateUI();
}

function cancelProductForm(): void {
  productForm = null;
  inputMode = false;
  setFocus("INVENTORY");
  setStatus("Edit cancelled.", "info");
  updateUI();
}

function productFormValue(form: ProductForm, field: number): string {
  if (field === 0) return form.name;
  if (field === 1) return form.barcode;
  if (field === 2) return form.price;
  return form.stock;
}

function setProductFormValue(form: ProductForm, field: number, value: string): void {
  if (field === 0) form.name = value;
  else if (field === 1) form.barcode = value;
  else if (field === 2) form.price = value;
  else form.stock = value;
}

function saveProductForm(): void {
  const form = productForm;
  if (!form) return;
  const price = Number.parseFloat(form.price);
  const stock = Number.parseInt(form.stock, 10);

  try {
    if (form.mode === "new") {
      const id = addProduct(form.name, form.barcode, price, stock);
      refreshProducts();
      const index = products.findIndex((product) => product.id === id);
      inventoryIndex = index >= 0 ? index : 0;
      setStatus(`Added product #${id} — ${form.name.trim()}.`, "success");
    } else if (form.id !== null) {
      updateProduct(form.id, form.name, form.barcode, price, stock);
      refreshProducts();
      const index = products.findIndex((product) => product.id === form.id);
      inventoryIndex = index >= 0 ? index : 0;
      setStatus(`Updated product #${form.id} — ${form.name.trim()}.`, "success");
    }
    productForm = null;
    inputMode = false;
    focus = "INVENTORY";
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
  }
  updateUI();
}

function openIngredientForm(mode: "new" | "edit"): void {
  if (mode === "edit") {
    const ingredient = ingredients[ingredientIndex];
    if (!ingredient) {
      setStatus("Select an ingredient to edit first.", "warning");
      return;
    }
    ingredientForm = {
      mode: "edit",
      id: ingredient.id,
      field: 0,
      name: ingredient.name,
      unit: ingredient.unit,
      stock: String(ingredient.stock),
      lowStock: String(ingredient.low_stock),
    };
  } else {
    ingredientForm = { mode: "new", id: null, field: 0, name: "", unit: "units", stock: "0", lowStock: "0" };
  }
  inputMode = true;
  setStatus(`${mode === "new" ? "New ingredient" : "Editing ingredient"} — Ctrl+S saves.`);
  updateUI();
}

function cancelIngredientForm(): void {
  ingredientForm = null;
  inputMode = false;
  setFocus("INVENTORY");
  setStatus("Ingredient edit cancelled.", "info");
  updateUI();
}

function ingredientFormValue(form: IngredientForm, field: number): string {
  if (field === 0) return form.name;
  if (field === 1) return form.unit;
  if (field === 2) return form.stock;
  return form.lowStock;
}

function setIngredientFormValue(form: IngredientForm, field: number, value: string): void {
  if (field === 0) form.name = value;
  else if (field === 1) form.unit = value;
  else if (field === 2) form.stock = value;
  else form.lowStock = value;
}

function saveIngredientForm(): void {
  const form = ingredientForm;
  if (!form) return;
  const input = {
    name: form.name,
    unit: form.unit,
    stock: Number.parseFloat(form.stock),
    lowStock: Number.parseFloat(form.lowStock),
  };

  try {
    if (form.mode === "new") {
      const id = addIngredient(input);
      refreshProducts();
      const index = ingredients.findIndex((ingredient) => ingredient.id === id);
      ingredientIndex = index >= 0 ? index : 0;
      setStatus(`Added ingredient #${id} — ${form.name.trim()}.`, "success");
    } else if (form.id !== null) {
      updateIngredient(form.id, input);
      refreshProducts();
      const index = ingredients.findIndex((ingredient) => ingredient.id === form.id);
      ingredientIndex = index >= 0 ? index : 0;
      setStatus(`Updated ingredient ${form.name.trim()}.`, "success");
    }
    ingredientForm = null;
    inputMode = false;
    focus = "INVENTORY";
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
  }
  updateUI();
}

function openRecipeEditor(): void {
  if (storeType() !== "cafe") {
    setStatus("Recipes are only used in Coffee Shop / Cafe mode.", "warning");
    return;
  }
  const product = products[inventoryIndex];
  if (!product) {
    setStatus("Select a product first.", "warning");
    return;
  }
  const existing = new Map(getRecipesForProduct(product.id).map((line) => [line.ingredient_id, line.quantity]));
  recipeEditor = {
    productId: product.id,
    productName: product.name,
    index: 0,
    rows: ingredients.map((ingredient) => ({
      ingredientId: ingredient.id,
      name: ingredient.name,
      unit: ingredient.unit,
      quantity: existing.has(ingredient.id) ? String(existing.get(ingredient.id)) : "0",
    })),
  };
  inputMode = true;
  setStatus(`Recipe — edit ingredient quantities for ${product.name}.`);
  updateUI();
}

function saveRecipeEditor(): void {
  const editor = recipeEditor;
  if (!editor) return;
  try {
    setProductRecipe(
      editor.productId,
      editor.rows
        .map((row) => ({ ingredientId: row.ingredientId, quantity: Number.parseFloat(row.quantity || "0") }))
        .filter((row) => Number.isFinite(row.quantity) && row.quantity > 0)
    );
    refreshProducts();
    recipeEditor = null;
    inputMode = false;
    focus = "INVENTORY";
    setStatus(`Recipe saved for ${editor.productName}.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
  }
  updateUI();
}

function openDeleteProductConfirm(): void {
  const product = products[inventoryIndex];
  if (!product) {
    setStatus("Select a product to delete first.", "warning");
    return;
  }
  modal = {
    kind: "confirm",
    action: "delete-product",
    productId: product.id,
    message: `Delete "${product.name}" (#${product.id}) from inventory?`,
  };
}

function openDeleteIngredientConfirm(): void {
  const ingredient = ingredients[ingredientIndex];
  if (!ingredient) {
    setStatus("Select an ingredient to delete first.", "warning");
    return;
  }
  modal = {
    kind: "confirm",
    action: "delete-ingredient",
    ingredientId: ingredient.id,
    message: `Delete "${ingredient.name}" and remove it from every recipe?`,
  };
}

function executeDeleteProduct(productId: number): void {
  const product = products.find((candidate) => candidate.id === productId);
  if (!product) return;
  const deleted = deleteProduct(productId);
  refreshProducts();
  inventoryIndex = clamp(inventoryIndex, 0, Math.max(0, products.length - 1));
  setStatus(
    deleted ? `Deleted ${product.name} from inventory.` : `${product.name} was already removed.`,
    deleted ? "success" : "warning"
  );
}

function executeDeleteIngredient(ingredientId: number): void {
  const ingredient = getIngredientById(ingredientId);
  if (!ingredient) return;
  const deleted = deleteIngredient(ingredientId);
  refreshProducts();
  ingredientIndex = clamp(ingredientIndex, 0, Math.max(0, ingredients.length - 1));
  setStatus(
    deleted ? `Deleted ingredient ${ingredient.name}.` : `${ingredient.name} was already removed.`,
    deleted ? "success" : "warning"
  );
}

/* ------------------------------------------------------------------ */
/* Settings actions                                                    */
/* ------------------------------------------------------------------ */

function openSettingsSection(): void {
  if (!currentUser) return;
  const item = SETTINGS_MENU[settingsMenuIndex]!;

  if (settingsMenuIndex === 0) {
    const config = storeConfig;
    storeForm = {
      field: 0,
      name: config?.name ?? "",
      address: config?.address ?? "",
      storeType: config?.store_type ?? "cafe",
      currency: config?.currency ?? "$",
      taxRate: String(config?.tax_rate ?? 0),
    };
    settingsSection = "store";
    inputMode = true;
    setStatus("Store profile — Tab moves fields, Ctrl+S saves.");
  } else if (settingsMenuIndex === 1) {
    settingsSection = "shortcuts";
    shortcutIndex = 0;
    inputMode = false;
    setStatus("Shortcuts — Enter remaps, Backspace restores one, R restores all.");
  } else if (settingsMenuIndex === 2) {
    if (!isAdmin(currentUser.role)) {
      setStatus("Only an Admin can manage user accounts.", "warning");
      updateUI();
      return;
    }
    accounts = listAccounts();
    settingsSection = "users";
    userIndex = 0;
    inputMode = false;
    setStatus("User accounts — A adds, P resets a PIN, Del removes.");
  } else if (settingsMenuIndex === 3) {
    settingsSection = "data";
    dataImportMode = false;
    dataMessage = `Export writes products_export.csv · ${products.length} products loaded.`;
    inputMode = false;
    setStatus("Import / export — E exports, I imports a CSV or JSON file.");
  } else {
    modal = { kind: "confirm", action: "logout", message: `Sign out ${currentUser.username} and lock the terminal?` };
  }
  void item;
  updateUI();
}

function backToSettingsMenu(): void {
  settingsSection = "menu";
  storeForm = null;
  userForm = null;
  shortcutCapture = null;
  dataImportMode = false;
  inputMode = false;
  setFocus("SETTINGS");
  setStatus("Settings — choose a section with ↑↓ and Enter.");
  updateUI();
}

function saveStoreForm(): void {
  const form = storeForm;
  if (!form) return;
  try {
    const config = updateStoreProfile({
      name: form.name,
      address: form.address,
      storeType: form.storeType,
      currency: form.currency,
      taxRate: Number.parseFloat(form.taxRate || "0"),
    });
    storeConfig = config;
    currencySymbol = config.currency;
    taxRate = config.tax_rate;
    refreshAll();
    settingsSection = "menu";
    storeForm = null;
    inputMode = false;
    setStatus("Store profile saved. New sales use the updated receipt details.", "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
  }
  updateUI();
}

function startNewUser(): void {
  userForm = { mode: "new", userId: null, username: "", pin: "", roleIndex: 2, field: 0 };
  inputMode = true;
  setStatus("New user — username, PIN, then role. Ctrl+S saves.");
  updateUI();
}

function startPinReset(): void {
  const account = accounts[userIndex];
  if (!account) {
    setStatus("Select a user first.", "warning");
    return;
  }
  userForm = { mode: "pin", userId: account.id, username: account.username, pin: "", roleIndex: 0, field: 0 };
  inputMode = true;
  setStatus(`Reset PIN for ${account.username}.`);
  updateUI();
}

function saveUserForm(): void {
  const form = userForm;
  if (!form) return;
  try {
    if (form.mode === "new") {
      const role = USER_ROLES[form.roleIndex] ?? "Cashier";
      createAccount({ username: form.username, pin: form.pin, role });
      setStatus(`Created ${role} account "${form.username.trim()}".`, "success");
    } else if (form.userId !== null) {
      resetPin(form.userId, form.pin);
      setStatus(`PIN reset for ${form.username}.`, "success");
    }
    accounts = listAccounts();
    userIndex = clamp(userIndex, 0, Math.max(0, accounts.length - 1));
    userForm = null;
    inputMode = false;
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
  }
  updateUI();
}

function openDeleteUserConfirm(): void {
  const account = accounts[userIndex];
  if (!account || !currentUser) return;
  modal = {
    kind: "confirm",
    action: "delete-user",
    userId: account.id,
    message: `Delete the ${account.role} account "${account.username}"?`,
  };
}

function executeDeleteUser(userId: number): void {
  if (!currentUser) return;
  try {
    const account = accounts.find((candidate) => candidate.id === userId);
    deleteAccount(userId, currentUser.userId);
    accounts = listAccounts();
    userIndex = clamp(userIndex, 0, Math.max(0, accounts.length - 1));
    setStatus(`Deleted account ${account?.username ?? `#${userId}`}.`, "success");
  } catch (error) {
    setStatus(error instanceof Error ? error.message : String(error), "danger");
  }
}

function signOut(): void {
  currentUser = null;
  currentView = "POS";
  cart = [];
  cartIndex = 0;
  discountPercent = 0;
  modal = null;
  productForm = null;
  ingredientForm = null;
  recipeEditor = null;
  storeForm = null;
  userForm = null;
  screen = "login";
  login = { username: "", pin: "", field: 1, error: "", attempts: 0, lockUntil: 0 };
  statusMessage = "Terminal locked. Sign in to continue.";
  statusKind = "info";
  updateUI();
}

function exportProducts(): void {
  try {
    const count = exportProductsCsv();
    dataMessage = `Exported ${count} products to products_export.csv.`;
    setStatus(dataMessage, "success");
  } catch (error) {
    dataMessage = `Export failed: ${error instanceof Error ? error.message : String(error)}`;
    setStatus(dataMessage, "danger");
  }
  updateUI();
}

function runProductImport(): void {
  try {
    const result = importProductsFile(dataImportPath);
    refreshProducts();
    const detail = `Imported ${result.inserted} new, updated ${result.updated}, skipped ${result.skipped}.`;
    dataMessage = result.errors.length > 0 ? `${detail} ${result.errors[0]}` : detail;
    setStatus(dataMessage, result.skipped > 0 ? "warning" : "success");
    dataImportMode = false;
  } catch (error) {
    dataMessage = `Import failed: ${error instanceof Error ? error.message : String(error)}`;
    setStatus(dataMessage, "danger");
  }
  updateUI();
}

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function receiptForTransaction(transaction: TransactionRecord): string {
  const items = getTransactionItems(transaction);
  const discountPercentValue =
    transaction.subtotal > 0 ? round2((transaction.discount_amount / transaction.subtotal) * 100) : 0;

  return generateReceiptText({
    storeName: storeConfig?.name ?? "RetroPOS",
    storeAddress: storeConfig?.address ?? "",
    transactionId: transaction.id,
    cashier: transaction.cashier_name || "Cashier",
    date: new Date(transaction.timestamp),
    items: items.map((item) => ({ name: item.name, price: item.price, qty: item.qty })),
    subtotal: transaction.subtotal,
    discountAmount: transaction.discount_amount,
    discountPercent: discountPercentValue,
    taxRate: transaction.tax_rate,
    taxAmount: transaction.tax_amount,
    total: transaction.total_amount,
    paymentMethod: transaction.payment_method,
    amountTendered: transaction.amount_tendered || transaction.total_amount,
    changeDue: transaction.change_due,
    currency: currencySymbol,
  });
}

function openHistoryReceipt(): void {
  const transaction = history[historyIndex];
  if (!transaction) {
    setStatus("No transaction selected.", "warning");
    return;
  }

  modal = {
    kind: "receipt",
    title: `RECEIPT #${transaction.id}`,
    receipt: receiptForTransaction(transaction),
    note: `${timestampLabel(transaction.timestamp)} · ${transaction.cashier_name}`,
  };
  modalScroll = 0;
  updateUI();
}

function reprintHistoryReceipt(): void {
  const transaction = history[historyIndex];
  if (!transaction) {
    setStatus("No transaction selected.", "warning");
    return;
  }

  console.log(receiptForTransaction(transaction));
  setStatus(`Receipt #${transaction.id} reprinted to the console.`, "success");
  updateUI();
}

function isPrintable(key: KeyEvent): boolean {
  return (
    !key.ctrl &&
    !key.meta &&
    key.sequence.length === 1 &&
    key.sequence >= " " &&
    key.sequence !== "\t"
  );
}

/* ------------------------------------------------------------------ */
/* Renderer and render tree                                            */
/* ------------------------------------------------------------------ */

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  backgroundColor: activeTheme.background,
});

const app = new BoxRenderable(renderer, {
  width: "100%",
  height: "100%",
  flexDirection: "column",
  backgroundColor: activeTheme.background,
  paddingX: 1,
  overflow: "hidden",
});

const header = new BoxRenderable(renderer, {
  width: "100%",
  height: 3,
  borderStyle: "single",
  borderColor: activeTheme.primary,
  backgroundColor: activeTheme.primary,
  paddingX: 2,
  flexDirection: "row",
  justifyContent: "space-between",
  alignItems: "center",
  overflow: "hidden",
});
const headerTitle = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.background,
  attributes: TextAttributes.BOLD,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
header.add(headerTitle);
app.add(header);

const searchBox = new BoxRenderable(renderer, {
  width: "100%",
  height: 3,
  borderStyle: "single",
  borderColor: activeTheme.secondary,
  backgroundColor: activeTheme.surface,
  paddingX: 1,
  overflow: "hidden",
});
const searchText = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.text,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
searchBox.add(searchText);
app.add(searchBox);

const bodyBox = new BoxRenderable(renderer, {
  width: "100%",
  flexGrow: 1,
  flexDirection: "row",
  overflow: "hidden",
});

const catalogBox = new BoxRenderable(renderer, {
  height: "100%",
  borderStyle: "single",
  borderColor: activeTheme.border,
  backgroundColor: activeTheme.surface,
  paddingX: 1,
  flexDirection: "column",
  overflow: "hidden",
});
const catalogText = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.text,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
catalogBox.add(catalogText);
bodyBox.add(catalogBox);

const cartBox = new BoxRenderable(renderer, {
  height: "100%",
  borderStyle: "single",
  borderColor: activeTheme.border,
  backgroundColor: activeTheme.surface,
  paddingX: 1,
  flexDirection: "column",
  overflow: "hidden",
});
const cartText = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.text,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
cartBox.add(cartText);
bodyBox.add(cartBox);
app.add(bodyBox);

const footer = new BoxRenderable(renderer, {
  width: "100%",
  height: 4,
  borderStyle: "single",
  borderColor: activeTheme.border,
  backgroundColor: activeTheme.surface,
  paddingX: 1,
  flexDirection: "column",
  overflow: "hidden",
});
const footerStatus = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.text,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
const footerKeys = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.muted,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
footer.add(footerStatus);
footer.add(footerKeys);
app.add(footer);

renderer.root.add(app);

const modalLayer = new BoxRenderable(renderer, {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  backgroundColor: activeTheme.background,
  justifyContent: "center",
  alignItems: "center",
  visible: false,
  zIndex: 100,
});
const modalBox = new BoxRenderable(renderer, {
  position: "absolute",
  borderStyle: "single",
  borderColor: activeTheme.primary,
  backgroundColor: activeTheme.surface,
  paddingX: 1,
  flexDirection: "column",
  overflow: "hidden",
});
const modalBody = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.text,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
const modalHint = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.muted,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
modalBox.add(modalBody);
modalBox.add(modalHint);
modalLayer.add(modalBox);
renderer.root.add(modalLayer);

const gateLayer = new BoxRenderable(renderer, {
  position: "absolute",
  top: 0,
  left: 0,
  width: "100%",
  height: "100%",
  backgroundColor: activeTheme.background,
  visible: false,
  zIndex: 200,
});
const gateBox = new BoxRenderable(renderer, {
  position: "absolute",
  borderStyle: "single",
  borderColor: activeTheme.primary,
  backgroundColor: activeTheme.surface,
  paddingX: 2,
  flexDirection: "column",
  overflow: "hidden",
});
const gateBody = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.text,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
const gateHint = new TextRenderable(renderer, {
  content: "",
  fg: activeTheme.muted,
  selectable: false,
  wrapMode: "none",
  height: 1,
});
gateBox.add(gateBody);
gateBox.add(gateHint);
gateLayer.add(gateBox);
renderer.root.add(gateLayer);

/* ------------------------------------------------------------------ */
/* Rendering helpers                                                   */
/* ------------------------------------------------------------------ */

interface ListWindow {
  start: number;
  end: number;
  hasAbove: boolean;
  hasBelow: boolean;
}

function listWindow(total: number, selected: number, maxRows: number): ListWindow {
  if (maxRows <= 0 || total === 0) {
    return { start: 0, end: 0, hasAbove: false, hasBelow: false };
  }
  if (total <= maxRows) {
    return { start: 0, end: total, hasAbove: false, hasBelow: false };
  }
  const rowsForItems = Math.max(1, maxRows - 2);
  const start = clamp(selected - Math.floor(rowsForItems / 2), 0, total - rowsForItems);
  const end = start + rowsForItems;
  return { start, end, hasAbove: start > 0, hasBelow: end < total };
}

function overflowLine(direction: "up" | "down", count: number, width: number): string {
  return clip(direction === "up" ? `  ↑ ${count} more above` : `  ↓ ${count} more below`, width);
}

function searchLine(width: number): string {
  if (currentView !== "POS") return clip(" Search is available in the Point of Sale view.", width);
  if (inputMode) {
    const query = searchQuery ? `${searchQuery}▌` : "type a product name or scan a barcode…▌";
    return clip(`› ${query}`, width);
  }
  if (searchQuery) return clip(`› ${searchQuery}   [Esc] clear · [${bindingLabel(bindings.search)}] edit`, width);
  return clip(`› press ${bindingLabel(bindings.search)} to search or scan   ·   hotkeys are active`, width);
}

function catalogTitle(items: Product[]): string {
  if (currentView === "POS") return ` PRODUCT CATALOGUE (${items.length}) `;
  if (currentView === "INVENTORY") return ` INVENTORY (${products.length}) `;
  if (currentView === "ANALYTICS") return " STORE PERFORMANCE ";
  if (currentView === "SETTINGS") return " SETTINGS ";
  return ` SALES HISTORY (${history.length}) `;
}

function catalogBottomTitle(): string {
  if (currentView === "POS") {
    return inputMode ? " Enter add match · ↑↓ pick · Esc hotkeys " : " ↑↓ select · Enter add · 1-9 quick add · Tab ";
  }
  if (currentView === "INVENTORY") {
    if (inventoryMode === "ingredients") return " A add · Enter edit · Del delete · I back ";
    return storeType() === "cafe"
      ? " A add · Enter edit · Del delete · R recipe · I ingredients "
      : " A add · Enter edit · Del delete · ↑↓ select ";
  }
  if (currentView === "ANALYTICS") return " Today / week / all-time · F6 history ";
  if (currentView === "SETTINGS") return " ↑↓ section · Enter open · Esc POS ";
  return " ↑↓ select · Enter receipt · R reprint · F6 refresh ";
}

function cartTitle(): string {
  if (currentView === "POS") {
    return ` ACTIVE CART · ${cart.length} line${cart.length === 1 ? "" : "s"} · ${discountPercent}% off `;
  }
  if (currentView === "INVENTORY") {
    if (inventoryMode === "ingredients") return ingredientForm ? " INGREDIENT EDITOR " : " INGREDIENT DETAILS ";
    return productForm ? " PRODUCT EDITOR " : recipeEditor ? " RECIPE EDITOR " : " PRODUCT DETAILS ";
  }
  if (currentView === "ANALYTICS") return " TOP PRODUCTS & ALERTS ";
  if (currentView === "SETTINGS") return settingsSection === "menu" ? " CONTROL PANEL " : " SETTINGS DETAIL ";
  return history[historyIndex] ? ` TRANSACTION #${history[historyIndex]!.id} ` : " TRANSACTION DETAILS ";
}

function cartBottomTitle(): string {
  if (currentView === "POS") {
    return focus === "CART"
      ? ` +/- qty · Del remove · Ctrl+Del clear · ${bindingLabel(bindings.checkout)} checkout `
      : ` ${bindingLabel(bindings.checkout)} checkout · ${bindingLabel(bindings.discount)} discount `;
  }
  if (currentView === "INVENTORY") {
    if (inventoryMode === "ingredients") return ingredientForm ? " Tab next · Ctrl+S save · Esc cancel " : " Enter edit · A add · Del delete ";
    return productForm ? " Tab next · Ctrl+S save · Esc cancel " : recipeEditor ? " ↑↓ ingredient · type qty · Enter save " : " Enter edit · A add · Del delete ";
  }
  if (currentView === "ANALYTICS") return " Revenue · transactions · payment mix ";
  if (currentView === "SETTINGS") return " Enter open · Esc back · Tab " + bindingLabel(bindings.settings) + " close ";
  return " Enter view receipt · R reprint ";
}

/* ------------------------------------------------------------------ */
/* POS rendering                                                       */
/* ------------------------------------------------------------------ */

function renderProductCatalog(width: number, rows: number): string[] {
  const items = filteredProducts();
  const lines: string[] = [];
  if (items.length === 0) {
    lines.push(clip("  No products match the current search.", width));
    lines.push(clip(`  Press Esc to leave search, then ${bindingLabel(bindings.search)} to try again.`, width));
    return lines;
  }

  const win = listWindow(items.length, catalogIndex, rows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  const active = focus === "CATALOG" || focus === "SEARCH";
  const nameWidth = Math.max(8, width - 21);

  for (let index = win.start; index < win.end; index += 1) {
    const product = items[index]!;
    const marker = active && index === catalogIndex ? "▸" : " ";
    const stock = availabilityFor(product.id);
    const lowStock = stock <= 5 ? "!" : " ";
    const line =
      `${marker}${padColumn(String(index + 1), 2, "right")} ` +
      `${padColumn(product.name, nameWidth)} ` +
      `${padColumn(money(product.price), 7, "right")} ` +
      `${padColumn(String(stock), 4, "right")}${lowStock}`;
    lines.push(clip(line, width));
  }
  if (win.hasBelow) lines.push(overflowLine("down", items.length - win.end, width));
  return lines;
}

function renderCart(width: number, rows: number): string[] {
  const lines: string[] = [];
  if (cart.length === 0) {
    lines.push(clip("  Cart is empty.", width));
    lines.push(clip("  Scan a barcode or press /.", width));
    lines.push("");
    lines.push(clip(`  ${bindingLabel(bindings.checkout)} checkout when ready.`, width));
    return lines;
  }

  const subtotal = cartSubtotal();
  const discount = cartDiscount();
  const tax = cartTax();
  const total = cartTotal();
  const extraRows = (discountPercent > 0 ? 1 : 0) + (taxRate > 0 ? 1 : 0);
  const summaryRows = 3 + extraRows;
  const itemRows = Math.max(2, rows - summaryRows);
  const win = listWindow(cart.length, cartIndex, itemRows);

  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  for (let index = win.start; index < win.end; index += 1) {
    const item = cart[index]!;
    const marker = focus === "CART" && index === cartIndex ? "▸" : " ";
    const qty = `${item.qty}×`;
    const nameWidth = Math.max(6, width - 16);
    lines.push(
      clip(
        `${marker} ${padColumn(qty, 4)}${padColumn(item.name, nameWidth)} ${padColumn(
          money(item.price * item.qty),
          9,
          "right"
        )}`,
        width
      )
    );
  }
  if (win.hasBelow) lines.push(overflowLine("down", cart.length - win.end, width));

  lines.push(clip("─".repeat(width), width));
  lines.push(twoColumn("Subtotal", money(subtotal), width));
  if (discountPercent > 0) lines.push(twoColumn(`Discount ${discountPercent}%`, `-${money(discount)}`, width));
  if (taxRate > 0) lines.push(twoColumn(`Tax ${percent(taxRate)}`, money(tax), width));
  lines.push(twoColumn("TOTAL", money(total), width));
  return lines;
}

/* ------------------------------------------------------------------ */
/* Inventory rendering                                                 */
/* ------------------------------------------------------------------ */

function renderInventoryList(width: number, rows: number): string[] {
  if (inventoryMode === "ingredients") return renderIngredientList(width, rows);
  const lines: string[] = [];
  if (products.length === 0) {
    lines.push(clip("  Inventory is empty.", width));
    lines.push(clip("  Press A to add your first product.", width));
    return lines;
  }

  const win = listWindow(products.length, inventoryIndex, rows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  const nameWidth = Math.max(8, width - 23);

  for (let index = win.start; index < win.end; index += 1) {
    const product = products[index]!;
    const marker = index === inventoryIndex ? "▸" : " ";
    const stock = storeType() === "cafe" ? availabilityFor(product.id) : product.stock;
    lines.push(
      clip(
        `${marker}${padColumn(`#${product.id}`, 4)} ${padColumn(product.name, nameWidth)} ` +
          `${padColumn(money(product.price), 7, "right")} ${padColumn(String(stock), 4, "right")}`,
        width
      )
    );
  }
  if (win.hasBelow) lines.push(overflowLine("down", products.length - win.end, width));
  return lines;
}

function renderProductDetails(width: number, rows: number): string[] {
  const form = productForm;
  if (form) {
    const lines: string[] = [clip(` ${form.mode === "new" ? "NEW PRODUCT" : `EDITING #${form.id}`}`, width), clip("─".repeat(width), width)];
    FORM_FIELDS.forEach((label, index) => {
      const marker = index === form.field ? "▸" : " ";
      const cursor = index === form.field ? "▌" : "";
      lines.push(clip(`${marker} ${padColumn(label, 8)}: ${productFormValue(form, index)}${cursor}`, width));
    });
    lines.push("");
    lines.push(clip(" Tab / ↑↓  move between fields", width));
    lines.push(clip(" Ctrl+S   save product", width));
    lines.push(clip(" Esc      cancel without saving", width));
    return lines;
  }

  const product = products[inventoryIndex];
  if (!product) return [clip(" No product selected.", width), clip(" Press A to add a product.", width)];

  const recipe = getRecipesForProduct(product.id);
  const lines: string[] = [
    clip(` ${product.name}`, width),
    clip("─".repeat(width), width),
    clip(` ID        ${product.id}`, width),
    clip(` Barcode   ${product.barcode}`, width),
    clip(` Price     ${money(product.price)}`, width),
    clip(
      ` Stock     ${storeType() === "cafe" ? `${availabilityFor(product.id)} sellable` : product.stock}${product.stock <= 5 ? "  (low)" : ""}`,
      width
    ),
  ];

  if (storeType() === "cafe") {
    lines.push("");
    lines.push(clip(" RECIPE (BOM)", width));
    if (recipe.length === 0) {
      lines.push(clip("  No recipe — uses unit stock.", width));
    } else {
      for (const line of recipe) {
        lines.push(clip(`  ${padColumn(line.name, 14)} ${line.quantity}${line.unit}`, width));
      }
    }
    lines.push("");
    lines.push(clip(" R          edit recipe", width));
    lines.push(clip(" I          ingredient inventory", width));
  }

  lines.push("");
  lines.push(clip(" Enter / E  edit this product", width));
  lines.push(clip(" A          add a new product", width));
  lines.push(clip(" Del / X    delete this product", width));
  return lines.slice(0, Math.max(1, rows));
}

function renderIngredientList(width: number, rows: number): string[] {
  const lines: string[] = [];
  if (ingredients.length === 0) {
    lines.push(clip("  No ingredients yet.", width));
    lines.push(clip("  Press A to add one.", width));
    return lines;
  }
  const win = listWindow(ingredients.length, ingredientIndex, rows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  const nameWidth = Math.max(6, width - 18);

  for (let index = win.start; index < win.end; index += 1) {
    const ingredient = ingredients[index]!;
    const marker = index === ingredientIndex ? "▸" : " ";
    const low = ingredient.stock <= ingredient.low_stock ? "!" : " ";
    lines.push(
      clip(
        `${marker} ${padColumn(ingredient.name, nameWidth)} ${padColumn(String(ingredient.stock), 8, "right")} ${ingredient.unit}${low}`,
        width
      )
    );
  }
  if (win.hasBelow) lines.push(overflowLine("down", ingredients.length - win.end, width));
  return lines;
}

function renderIngredientDetails(width: number, rows: number): string[] {
  const form = ingredientForm;
  if (form) {
    const lines: string[] = [
      clip(` ${form.mode === "new" ? "NEW INGREDIENT" : `EDITING #${form.id}`}`, width),
      clip("─".repeat(width), width),
    ];
    INGREDIENT_FIELDS.forEach((label, index) => {
      const marker = index === form.field ? "▸" : " ";
      const cursor = index === form.field ? "▌" : "";
      lines.push(clip(`${marker} ${padColumn(label, 8)}: ${ingredientFormValue(form, index)}${cursor}`, width));
    });
    lines.push("");
    lines.push(clip(" Units: ml, g, pumps, units", width));
    lines.push(clip(" Ctrl+S save · Esc cancel", width));
    return lines;
  }

  const ingredient = ingredients[ingredientIndex];
  if (!ingredient) return [clip(" No ingredient selected.", width)];
  return [
    clip(` ${ingredient.name}`, width),
    clip("─".repeat(width), width),
    clip(` ID        ${ingredient.id}`, width),
    clip(` Stock     ${ingredient.stock} ${ingredient.unit}`, width),
    clip(` Low mark  ${ingredient.low_stock} ${ingredient.unit}`, width),
    clip(` Status    ${ingredient.stock <= ingredient.low_stock ? "LOW STOCK" : "OK"}`, width),
    "",
    clip(" Enter / E  edit this ingredient", width),
    clip(" A          add an ingredient", width),
    clip(" Del / X    delete ingredient", width),
    clip(" I / Esc    back to products", width),
  ];
}

function renderRecipeEditor(width: number, rows: number): string[] {
  const editor = recipeEditor;
  if (!editor) return [];
  const lines: string[] = [
    clip(` RECIPE · ${editor.productName}`, width),
    clip("─".repeat(width), width),
    clip(" Amount per sale (0 = omit)", width),
    "",
  ];
  const visibleRows = Math.max(3, rows - 7);
  const win = listWindow(editor.rows.length, editor.index, visibleRows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  for (let index = win.start; index < win.end; index += 1) {
    const row = editor.rows[index]!;
    const marker = index === editor.index ? "▸" : " ";
    const cursor = index === editor.index ? "▌" : "";
    lines.push(
      clip(
        `${marker} ${padColumn(row.name, Math.max(8, width - 16))} ${padColumn(
          `${row.quantity}${row.unit}${cursor}`,
          10,
          "right"
        )}`,
        width
      )
    );
  }
  if (win.hasBelow) lines.push(overflowLine("down", editor.rows.length - win.end, width));
  lines.push("");
  lines.push(clip(" ↑↓ ingredient · type quantity", width));
  lines.push(clip(" Enter save · Esc cancel", width));
  return lines;
}

function renderInventoryDetails(width: number, rows: number): string[] {
  if (inventoryMode === "ingredients") return renderIngredientDetails(width, rows);
  if (recipeEditor) return renderRecipeEditor(width, rows);
  return renderProductDetails(width, rows);
}

/* ------------------------------------------------------------------ */
/* History and analytics rendering                                     */
/* ------------------------------------------------------------------ */

function renderHistoryList(width: number, rows: number): string[] {
  const lines: string[] = [];
  if (history.length === 0) {
    lines.push(clip("  No sales yet.", width));
    lines.push(clip("  Complete a sale from the POS view.", width));
    return lines;
  }

  const win = listWindow(history.length, historyIndex, rows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  const dateWidth = 17;
  const totalWidth = 9;
  for (let index = win.start; index < win.end; index += 1) {
    const transaction = history[index]!;
    const marker = index === historyIndex ? "▸" : " ";
    lines.push(
      clip(
        `${marker}${padColumn(`#${transaction.id}`, 5)} ${padColumn(
          timestampLabel(transaction.timestamp),
          dateWidth
        )}${padColumn(money(transaction.total_amount), totalWidth, "right")}`,
        width
      )
    );
  }
  if (win.hasBelow) lines.push(overflowLine("down", history.length - win.end, width));
  return lines;
}

function renderHistoryDetails(width: number, rows: number): string[] {
  const transaction = history[historyIndex];
  if (!transaction) return [clip(" No transaction selected.", width)];

  const items = getTransactionItems(transaction);
  const lines: string[] = [
    clip(` ${timestampLabel(transaction.timestamp)} · ${transaction.payment_method}`, width),
    clip(` Cashier: ${transaction.cashier_name}`, width),
    clip("─".repeat(width), width),
  ];

  const summaryRows = 4 + (transaction.discount_amount > 0 ? 1 : 0) + (transaction.tax_amount > 0 ? 1 : 0);
  const itemRows = Math.max(2, rows - summaryRows - 2);
  const win = listWindow(items.length, 0, itemRows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));
  for (let index = win.start; index < win.end; index += 1) {
    const item = items[index]!;
    const qty = padColumn(`${item.qty}×`, 4);
    const lineTotal = padColumn(money(item.price * item.qty), 9, "right");
    const nameWidth = Math.max(6, width - qty.length - lineTotal.length - 1);
    lines.push(clip(`${qty}${padColumn(item.name, nameWidth)} ${lineTotal}`, width));
  }
  if (win.hasBelow) lines.push(overflowLine("down", items.length - win.end, width));

  lines.push(clip("─".repeat(width), width));
  lines.push(twoColumn("Subtotal", money(transaction.subtotal), width));
  if (transaction.discount_amount > 0) {
    lines.push(twoColumn("Discount", `-${money(transaction.discount_amount)}`, width));
  }
  if (transaction.tax_amount > 0) {
    lines.push(twoColumn(`Tax ${percent(transaction.tax_rate)}`, money(transaction.tax_amount), width));
  }
  lines.push(twoColumn("TOTAL", money(transaction.total_amount), width));
  lines.push(twoColumn("Tendered", money(transaction.amount_tendered), width));
  lines.push(twoColumn("Change", money(transaction.change_due), width));
  return lines;
}

function renderAnalyticsSummary(width: number, rows: number): string[] {
  const lines: string[] = [
    clip(" REVENUE", width),
    clip("─".repeat(width), width),
    twoColumn("Today", money(analytics.today.revenue), width),
    twoColumn("This week", money(analytics.week.revenue), width),
    twoColumn("All time", money(analytics.allTime.revenue), width),
    "",
    clip(" TRANSACTIONS", width),
    clip("─".repeat(width), width),
    twoColumn("Today", String(analytics.today.count), width),
    twoColumn("This week", String(analytics.week.count), width),
    twoColumn("All time", String(analytics.allTime.count), width),
    "",
    clip(" CASH FLOW", width),
    clip("─".repeat(width), width),
  ];

  if (analytics.methods.length === 0) {
    lines.push(clip("  No payments recorded yet.", width));
  } else {
    for (const method of analytics.methods) {
      lines.push(twoColumn(`${method.method} (${method.count})`, money(method.amount), width));
    }
  }
  return lines.slice(0, Math.max(1, rows));
}

function renderAnalyticsDetails(width: number, rows: number): string[] {
  const lines: string[] = [clip(" TOP SELLING PRODUCTS", width), clip("─".repeat(width), width)];
  if (analytics.topProducts.length === 0) {
    lines.push(clip("  No product sales yet.", width));
  } else {
    const nameWidth = Math.max(8, width - 16);
    analytics.topProducts.forEach((product, index) => {
      lines.push(
        clip(
          `${padColumn(String(index + 1), 2, "right")} ${padColumn(product.name, nameWidth)} ` +
            `${padColumn(String(product.qty), 3, "right")} ${padColumn(money(product.revenue), 8, "right")}`,
          width
        )
      );
    });
  }

  lines.push("");
  lines.push(clip(" LOW STOCK ALERTS", width));
  lines.push(clip("─".repeat(width), width));
  const alerts: string[] = [];
  for (const ingredient of analytics.lowStockIngredients) {
    alerts.push(` ${ingredient.name}: ${ingredient.stock}${ingredient.unit} (min ${ingredient.low_stock})`);
  }
  if (storeType() !== "cafe") {
    for (const product of analytics.lowStockProducts) alerts.push(` ${product.name}: ${product.stock} left`);
  }
  if (alerts.length === 0) {
    lines.push(clip("  Stock levels look healthy.", width));
  } else {
    for (const alert of alerts.slice(0, Math.max(2, rows - lines.length))) lines.push(clip(alert, width));
  }
  return lines.slice(0, Math.max(1, rows));
}

/* ------------------------------------------------------------------ */
/* Settings rendering                                                  */
/* ------------------------------------------------------------------ */

function renderSettingsMenu(width: number, rows: number): string[] {
  const lines: string[] = [];
  SETTINGS_MENU.forEach((item, index) => {
    const marker = index === settingsMenuIndex ? "▸" : " ";
    lines.push(clip(`${marker} ${item.title}`, width));
    if (index === settingsMenuIndex) lines.push(clip(`   ${item.detail}`, width));
  });
  lines.push("");
  lines.push(clip(` Store: ${storeConfig?.name ?? "not configured"}`, width));
  lines.push(clip(` Type: ${storeType() === "cafe" ? "Cafe (recipes)" : "Retail (unit stock)"}`, width));
  lines.push(clip(` Currency: ${currencySymbol} · Tax: ${percent(taxRate)}`, width));
  lines.push(clip(` Theme: ${activeTheme.name}`, width));
  lines.push(clip(` Users: ${accounts.length} · Role: ${currentUser?.role ?? "—"}`, width));
  return lines.slice(0, Math.max(1, rows));
}

function renderSettingsDetail(width: number, rows: number): string[] {
  if (settingsSection === "menu") {
    return [
      clip(" TERMINAL STATUS", width),
      clip("─".repeat(width), width),
      clip(` Store type  ${storeType() === "cafe" ? "Coffee Shop / Cafe" : "Hardware / Retail"}`, width),
      clip(` Currency    ${currencySymbol}`, width),
      clip(` Tax rate    ${percent(taxRate)}`, width),
      clip(` Theme       ${activeTheme.name}`, width),
      "",
      clip(` Signed in   ${currentUser?.username ?? "—"} (${currentUser?.role ?? "—"})`, width),
      clip(` Theme saved across restarts.`, width),
      "",
      clip(" Choose a section on the left.", width),
      clip(" Enter opens it · Esc returns to POS.", width),
    ];
  }

  if (settingsSection === "store" && storeForm) {
    const form = storeForm;
    const lines: string[] = [clip(" STORE PROFILE", width), clip("─".repeat(width), width)];
    STORE_FIELDS.forEach((label, index) => {
      const marker = index === form.field ? "▸" : " ";
      const cursor = index === form.field ? "▌" : "";
      let value = "";
      if (index === 0) value = form.name;
      else if (index === 1) value = form.address;
      else if (index === 2) value = form.storeType === "cafe" ? "Coffee Shop / Cafe" : "Hardware / Retail";
      else if (index === 3) value = form.currency;
      else value = form.taxRate;
      lines.push(clip(`${marker} ${padColumn(label, 9)} ${value}${cursor}`, width));
    });
    lines.push("");
    lines.push(clip(" Type: ←/→ or 1/2 toggle", width));
    lines.push(clip(" Ctrl+S save · Esc cancel", width));
    lines.push(clip(" Changing type changes stock rules.", width));
    return lines.slice(0, Math.max(1, rows));
  }

  if (settingsSection === "shortcuts") {
    const lines: string[] = [clip(" KEYBOARD SHORTCUTS", width), clip("─".repeat(width), width)];
    for (const action of ACTIONS) {
      const marker = action.action === ACTIONS[shortcutIndex]?.action ? "▸" : " ";
      const value = shortcutCapture === action.action ? "press key…" : bindingLabel(bindings[action.action]);
      lines.push(clip(`${marker} ${padColumn(action.label, 17)} ${padColumn(value, 8, "right")}`, width));
    }
    lines.push("");
    lines.push(clip(" Enter remap · Backspace default", width));
    lines.push(clip(" R reset all · Esc back", width));
    lines.push(clip(" Printable keys work in nav mode.", width));
    return lines.slice(0, Math.max(1, rows));
  }

  if (settingsSection === "users") {
    if (userForm) {
      const form = userForm;
      const lines: string[] = [
        clip(form.mode === "new" ? " NEW USER" : ` RESET PIN · ${form.username}`, width),
        clip("─".repeat(width), width),
      ];
      if (form.mode === "new") {
        lines.push(clip(`${form.field === 0 ? "▸" : " "} Username  ${form.username}${form.field === 0 ? "▌" : ""}`, width));
      }
      lines.push(clip(`${form.field === (form.mode === "new" ? 1 : 0) ? "▸" : " "} PIN       ${"•".repeat(form.pin.length)}${form.field === (form.mode === "new" ? 1 : 0) ? "▌" : ""}`, width));
      if (form.mode === "new") {
        const role = USER_ROLES[form.roleIndex] ?? "Cashier";
        lines.push(clip(`${form.field === 2 ? "▸" : " "} Role      ‹ ${role} ›`, width));
      }
      lines.push("");
      lines.push(clip(" PIN 4–6 digits · role ←/→ or 1/2/3", width));
      lines.push(clip(" Ctrl+S save · Esc cancel", width));
      return lines.slice(0, Math.max(1, rows));
    }

    const lines: string[] = [clip(" USER ACCOUNTS", width), clip("─".repeat(width), width)];
    if (accounts.length === 0) lines.push(clip("  No users configured.", width));
    accounts.forEach((account, index) => {
      const marker = index === userIndex ? "▸" : " ";
      const self = account.id === currentUser?.userId ? "*" : " ";
      lines.push(clip(`${marker}${self}${padColumn(account.username, Math.max(8, width - 14))} ${account.role}`, width));
    });
    lines.push("");
    lines.push(clip(" A add · P reset PIN · Del remove", width));
    lines.push(clip(" Admins only · Esc back", width));
    return lines.slice(0, Math.max(1, rows));
  }

  // Data import/export
  const lines: string[] = [clip(" IMPORT / EXPORT", width), clip("─".repeat(width), width)];
  lines.push(clip(` Products loaded: ${products.length}`, width));
  lines.push("");
  if (dataImportMode) {
    lines.push(clip(" Import file path:", width));
    lines.push(clip(` ▸ ${dataImportPath}▌`, width));
    lines.push("");
    lines.push(clip(" Enter run import · Esc cancel", width));
  } else {
    lines.push(clip(" E  export products_export.csv", width));
    lines.push(clip(" I  import a CSV or JSON file", width));
    lines.push("");
    lines.push(clip(" CSV: name,barcode,price,stock", width));
    lines.push(clip(" JSON: [{name,barcode,price,stock}]", width));
  }
  if (dataMessage) {
    lines.push("");
    for (const row of wrapText(dataMessage, Math.max(10, width))) lines.push(clip(row, width));
  }
  return lines.slice(0, Math.max(1, rows));
}

function wrapText(value: string, width: number): string[] {
  const words = value.split(/\s+/);
  const lines: string[] = [];
  let current = "";
  for (const word of words) {
    if (!current) current = word;
    else if (`${current} ${word}`.length <= width) current = `${current} ${word}`;
    else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

/* ------------------------------------------------------------------ */
/* Hints and help                                                      */
/* ------------------------------------------------------------------ */

function keysHint(): string {
  if (modal) return " [Esc] close ";
  if (shortcutCapture) return " PRESS NEW KEY · Esc cancels ";
  if (currentView === "SETTINGS") {
    if (dataImportMode) return " TYPE path · Enter import · Esc cancel ";
    if (userForm) return " TYPE · Tab next · Ctrl+S save · Esc cancel ";
    if (storeForm) return " Tab field · ←/→ type · Ctrl+S save · Esc cancel ";
    if (settingsSection === "shortcuts") return " ↑↓ action · Enter remap · Backspace default · R all · Esc ";
    if (settingsSection === "users") return " ↑↓ user · A add · P PIN · Del remove · Esc back ";
    if (settingsSection === "data") return " E export · I import · Esc back ";
    return " ↑↓ section · Enter open · Esc POS · F1 POS · F5 theme ";
  }
  if (productForm || ingredientForm || recipeEditor) {
    return recipeEditor
      ? " ↑↓ ingredient · type qty · Enter save · Esc cancel "
      : " TYPE field · Tab next · Ctrl+S save · Esc cancel ";
  }
  if (currentView === "POS") {
    if (focus === "SEARCH") {
      return ` TYPE search · Enter add · ↑↓ pick · Esc hotkeys · ${bindingLabel(bindings.checkout)} checkout `;
    }
    if (focus === "CART") {
      return ` ↑↓ item · +/- qty · Del remove · ^Del clear · ${bindingLabel(bindings.checkout)} checkout · Q quit `;
    }
    return ` ↑↓ select · Enter add · 1-9 quick · ${bindingLabel(bindings.search)} search · ${bindingLabel(bindings.checkout)} checkout · ${bindingLabel(bindings.logout)} sign out `;
  }
  if (currentView === "INVENTORY") {
    if (inventoryMode === "ingredients") return ` A add · Enter edit · Del delete · I back · F1 POS · ${bindingLabel(bindings.logout)} sign out `;
    return ` A add · Enter edit · Del delete${storeType() === "cafe" ? " · R recipe · I ingredients" : ""} · F1 POS · ${bindingLabel(bindings.logout)} sign out `;
  }
  if (currentView === "ANALYTICS") return ` F1 POS · F2 inventory · F3 analytics · F4 settings · F6 history · ${bindingLabel(bindings.logout)} sign out · Q `;
  return ` F1 POS · F2 inventory · F3 analytics · F4 settings · Enter receipt · R reprint · ${bindingLabel(bindings.logout)} sign out · Q `;
}

function helpLines(): string[] {
  return [
    "RETRO POS — KEYBOARD GUIDE",
    "──────────────────────────────────────────",
    "",
    "GLOBAL",
    `  ${padColumn(bindingLabel(bindings.inventory), 5)} Inventory management`,
    `  ${padColumn(bindingLabel(bindings.analytics), 5)} Analytics dashboard`,
    `  ${padColumn(bindingLabel(bindings.settings), 5)} Settings and user accounts`,
    `  ${padColumn(bindingLabel(bindings.history), 5)} Sales history`,
    `  ${padColumn(bindingLabel(bindings.theme), 5)} Cycle and save theme`,
    `  ${padColumn(bindingLabel(bindings.help), 5)} This help screen`,
    `  ${padColumn(bindingLabel(bindings.logout), 5)} Sign out and lock the terminal`,
    "  Q     Quit (nav mode only; Ctrl+C always quits)",
    "",
    "SEARCH / BARCODE",
    `  ${padColumn(bindingLabel(bindings.search), 5)} Focus the search bar (nav mode)`,
    "  Enter Add selected match; exact barcode wins",
    "  ↑ / ↓ Move through matches",
    "  Esc   Leave search; unlock hotkeys",
    "",
    "CART",
    `  ${padColumn(bindingLabel(bindings.checkout), 5)} Checkout / payment`,
    `  ${padColumn(bindingLabel(bindings.discount), 5)} Cycle discount 0 → 5 → 10 → 15 → 20%`,
    "  Tab   Move focus between search, catalogue, cart",
    "  ↑ / ↓ Select a cart line",
    "  + / - Change quantity",
    "  Del   Remove the selected line",
    "  ^Del  Clear the whole cart (confirmation)",
    "",
    "INVENTORY (Manager / Admin)",
    "  A     Add product          Enter / E  Edit product",
    "  Del   Delete product       I          Ingredients",
    "  R     Edit recipe (Cafe)   Ctrl+S     Save form",
    "",
    "ANALYTICS (Manager / Admin)",
    "  F3    Revenue, transactions, payment mix, top sellers",
    "",
    "SETTINGS (Manager / Admin)",
    "  F4    Store profile, shortcuts, users, import/export",
    "  Remapped printable shortcuts work in nav mode.",
    "",
    "Receipts append to receipts.log and receipts.escpos.log (42 columns).",
  ];
}

/* ------------------------------------------------------------------ */
/* Login and onboarding gate                                           */
/* ------------------------------------------------------------------ */

function maskPin(value: string): string {
  return "•".repeat(value.length);
}

function renderGate(): void {
  const gateWidth = Math.max(40, Math.min(84, renderer.width - 4));
  const gateHeight = Math.max(12, Math.min(renderer.height - 2, 32));
  const innerWidth = Math.max(20, gateWidth - 6);
  const bodyHeight = Math.max(8, gateHeight - 3);

  gateLayer.width = "100%";
  gateLayer.height = "100%";
  gateLayer.backgroundColor = activeTheme.background;
  gateBox.width = gateWidth;
  gateBox.height = gateHeight;
  gateBox.left = Math.max(0, Math.floor((renderer.width - gateWidth) / 2));
  gateBox.top = Math.max(0, Math.floor((renderer.height - gateHeight) / 2));
  gateBox.backgroundColor = activeTheme.surface;
  gateBox.borderColor = activeTheme.primary;
  gateBox.titleColor = activeTheme.primary;
  gateBody.width = innerWidth;
  gateBody.height = bodyHeight;
  gateBody.fg = activeTheme.text;
  gateHint.width = innerWidth;
  gateHint.fg = activeTheme.muted;

  if (screen === "login") {
    const lines = [
      ` ${storeConfig?.name ?? "RetroPOS"}`,
      ` ${storeConfig?.address ?? ""}`,
      "",
      " SECURE LOGIN",
      " ──────────────────────────────────────────",
      "",
      " Username (optional — needed on shared PIN pads)",
      ` ${login.field === 0 ? "▸" : " "} ${login.username}${login.field === 0 ? "▌" : ""}`,
      "",
      " PIN (4–6 digits)",
      ` ${login.field === 1 ? "▸" : " "} ${maskPin(login.pin)}${login.field === 1 ? "▌" : ""}`,
      "",
      login.error ? ` ⚠ ${login.error}` : " Enter your PIN. Username can stay blank.",
      "",
      ` Theme: ${activeTheme.name} · role-based access enabled`,
    ];
    gateBox.title = " SIGN IN ";
    gateBody.content = lines.slice(0, bodyHeight).map((line) => clip(line, innerWidth)).join("\n");
    gateHint.content = clip(` Enter sign in · Tab switch field · ${bindingLabel(bindings.theme)} theme · Ctrl+C quit`, innerWidth);
    return;
  }

  const step = onboarding.step;
  const lines: string[] = [
    " FIRST-RUN STORE ONBOARDING",
    " ──────────────────────────────────────────",
    ` Step ${step + 1} of ${ONBOARDING_STEPS}`,
    "",
  ];

  if (step === 0) {
    lines.push(" Store identity", "", " Store name (printed on every receipt)", ` ▸ ${onboarding.name}▌`, "", " Example: Bluebird Coffee Roasters");
  } else if (step === 1) {
    lines.push(" Store address", "", " Address line printed under the store name", ` ▸ ${onboarding.address}▌`, "", " Example: 42 Market Street, Springfield");
  } else if (step === 2) {
    lines.push(
      " Store type",
      "",
      ` ${onboarding.storeType === "cafe" ? "▸" : " "} Coffee Shop / Cafe`,
      "     Ingredients, recipes, and BOM stock deduction",
      ` ${onboarding.storeType === "retail" ? "▸" : " "} Hardware Store / Retail`,
      "     Unit-level stock with low-stock warnings",
      "",
      " ←/→ or 1/2 to choose"
    );
  } else if (step === 3) {
    lines.push(" Currency symbol", "", " Used on the POS, receipts, and analytics", ` ▸ ${onboarding.currency}▌`, "", " Examples: $  €  £  Rs  ¥");
  } else if (step === 4) {
    lines.push(" Sales tax rate", "", " Enter a percentage (use 0 for tax-free stores)", ` ▸ ${onboarding.taxRate}▌`, "", " Example: 5 or 17.5");
  } else if (step === 5) {
    lines.push(" Administrator account", "", " This account can manage inventory, settings, and users", ` ▸ ${onboarding.adminUsername}▌`, "");
  } else if (step === 6) {
    lines.push(" Administrator PIN", "", " Choose 4–6 digits. The PIN is salted and scrypt-hashed.", ` ▸ ${maskPin(onboarding.adminPin)}▌`);
  } else if (step === 7) {
    lines.push(" Confirm administrator PIN", "", " Re-enter the same PIN", ` ▸ ${maskPin(onboarding.confirmPin)}▌`);
  } else {
    lines.push(
      " Review & finish",
      "",
      ` Store     ${onboarding.name}`,
      ` Address   ${onboarding.address}`,
      ` Type      ${onboarding.storeType === "cafe" ? "Coffee Shop / Cafe" : "Hardware Store / Retail"}`,
      ` Currency  ${onboarding.currency}`,
      ` Tax       ${onboarding.taxRate}%`,
      ` Admin     ${onboarding.adminUsername}`,
      "",
      " Press Enter to save and seed demo inventory."
    );
  }

  if (onboarding.error) lines.push("", ` ⚠ ${onboarding.error}`);
  gateBox.title = ` SETUP ${step + 1}/${ONBOARDING_STEPS} `;
  gateBody.content = lines.slice(0, bodyHeight).map((line) => clip(line, innerWidth)).join("\n");
  gateHint.content = clip(
    ` Enter continue · ↑ back · Backspace edit${step === 2 ? " · ←/→ choose" : ""} · ${bindingLabel(bindings.theme)} theme`,
    innerWidth
  );
}

/* ------------------------------------------------------------------ */
/* Modal rendering                                                     */
/* ------------------------------------------------------------------ */

function paymentPreview(): { total: number; tendered: number; change: number } {
  if (modal?.kind !== "payment") return { total: cartTotal(), tendered: cartTotal(), change: 0 };
  const total = cartTotal();
  const parsed = Number.parseFloat(modal.tendered);
  const tendered = PAYMENT_METHODS[modal.methodIndex] === "Cash" && Number.isFinite(parsed) ? parsed : total;
  return { total, tendered, change: Math.max(0, round2(tendered - total)) };
}

function renderModal(): void {
  if (!modal) {
    modalLayer.visible = false;
    return;
  }

  modalLayer.visible = true;
  const theme = activeTheme;
  const isConfirm = modal.kind === "confirm";
  const isPayment = modal.kind === "payment";
  const modalWidth = Math.max(28, Math.min(isConfirm || isPayment ? 64 : 72, renderer.width - 4));
  const modalHeight = Math.max(9, Math.min(isConfirm ? 9 : isPayment ? 18 : 38, renderer.height - 4));

  modalBox.width = modalWidth;
  modalBox.height = modalHeight;
  modalBox.left = Math.max(0, Math.floor((renderer.width - modalWidth) / 2));
  modalBox.top = Math.max(0, Math.floor((renderer.height - modalHeight) / 2));
  modalBox.backgroundColor = theme.surface;
  modalBox.borderColor = isConfirm ? theme.warning : theme.primary;
  modalBox.titleColor = isConfirm ? theme.warning : theme.primary;
  modalBody.width = Math.max(12, modalWidth - 4);
  modalHint.width = Math.max(12, modalWidth - 4);
  modalBody.fg = theme.text;
  modalHint.fg = theme.muted;

  if (modal.kind === "confirm") {
    modalBox.title = " CONFIRM ";
    modalBody.height = 3;
    modalBody.content = [
      clip(modal.message, modalWidth - 4),
      "",
      clip("Press Y or Enter to confirm. N or Esc cancels.", modalWidth - 4),
    ].join("\n");
    modalHint.content = clip("[Y] confirm   [N/Esc] cancel", modalWidth - 4);
    return;
  }

  if (modal.kind === "payment") {
    const preview = paymentPreview();
    const method = PAYMENT_METHODS[modal.methodIndex] ?? "Cash";
    const lines = [
      " PAYMENT",
      " ────────────────────────────────────────",
      twoColumn("TOTAL", money(preview.total), modalWidth - 4),
      "",
      ` Method   ‹ ${method} ›   (←/→ or Tab)`,
      "",
    ];
    if (method === "Cash") {
      lines.push(` Cash tendered: ${modal.tendered || `${money(preview.total)} (exact)`}▌`);
      lines.push(twoColumn("Change", money(preview.change), modalWidth - 4));
    } else {
      lines.push(` ${method} payment will be recorded for the exact total.`);
      lines.push(twoColumn("Change", money(0), modalWidth - 4));
    }
    if (modal.error) lines.push("", ` ⚠ ${modal.error}`);
    modalBox.title = " CHECKOUT ";
    modalBody.height = Math.max(8, modalHeight - 3);
    modalBody.content = lines.map((line) => clip(line, modalWidth - 4)).join("\n");
    modalHint.content = clip(
      `${method === "Cash" ? "digits tendered · " : ""}←/→ method · Enter confirm · Esc cancel`,
      modalWidth - 4
    );
    return;
  }

  const lines = modal.kind === "help" ? helpLines() : receiptLines(modal.receipt);
  const visibleRows = Math.max(2, modalHeight - 3);
  const maxScroll = Math.max(0, lines.length - visibleRows);
  modalScroll = clamp(modalScroll, 0, maxScroll);
  modalBody.height = visibleRows;
  modalBody.content = lines.slice(modalScroll, modalScroll + visibleRows).join("\n");

  if (modal.kind === "help") {
    modalBox.title = " KEYBOARD HELP ";
    modalHint.content = clip(
      maxScroll > 0 ? "[↑↓] scroll   [Esc/Enter] close" : "[Esc/Enter] close",
      modalWidth - 4
    );
  } else {
    modalBox.title = ` ${modal.title} `;
    modalHint.content = clip(
      `${modal.note}${maxScroll > 0 ? " · ↑↓ scroll" : ""} · Esc/Enter close`,
      modalWidth - 4
    );
  }
}

/* ------------------------------------------------------------------ */
/* Main UI update                                                      */
/* ------------------------------------------------------------------ */

function updateUI(): void {
  activeTheme = getTheme();

  if (screen !== "app") {
    app.visible = false;
    modalLayer.visible = false;
    gateLayer.visible = true;
    renderGate();
    return;
  }

  app.visible = true;
  gateLayer.visible = false;
  clampSelections();

  renderer.setBackgroundColor(activeTheme.background);
  const terminalWidth = Math.max(30, renderer.width);
  const terminalHeight = Math.max(12, renderer.height);
  const innerWidth = Math.max(20, terminalWidth - 2);
  const bodyWidth = innerWidth;
  const catalogWidth = Math.max(18, Math.floor(bodyWidth * 0.64));
  const cartWidth = Math.max(12, bodyWidth - catalogWidth);
  const bodyHeight = Math.max(3, terminalHeight - 10);
  const contentRows = Math.max(1, bodyHeight - 2);
  const catalogInner = Math.max(8, catalogWidth - 4);
  const cartInner = Math.max(8, cartWidth - 4);
  const headerInner = Math.max(16, innerWidth - 6);
  const headerRightWidth = Math.max(10, Math.floor(headerInner * 0.46));

  app.backgroundColor = activeTheme.background;
  header.backgroundColor = activeTheme.primary;
  header.borderColor = activeTheme.primary;
  headerTitle.fg = activeTheme.background;
  headerTitle.width = headerInner;

  const editingForm = Boolean(productForm || ingredientForm || recipeEditor || storeForm || userForm || dataImportMode);
  const modeLabel = editingForm ? "EDIT" : inputMode ? "INSERT" : "NAV";
  let headerRight = `${modeLabel} · ${currentUser?.role ?? "—"}:${currentUser?.username ?? "—"} · ${activeTheme.name}`;
  const todayLabel = `Today ${todayStats.count}/${money(todayStats.revenue)}`;
  if (todayLabel.length + headerRight.length + 3 <= headerRightWidth && (currentView === "POS" || currentView === "ANALYTICS")) {
    headerRight += ` · ${todayLabel}`;
  }
  const brand = storeConfig ? `RETRO POS · ${storeConfig.name}` : "RETRO POS";
  headerTitle.content = twoColumn(`${brand} · ${viewLabel()}`, `${headerRight} `, headerInner);

  searchBox.backgroundColor = activeTheme.surface;
  searchBox.borderColor = currentView === "POS" && inputMode ? activeTheme.primary : activeTheme.border;
  searchBox.title = currentView === "POS" ? " SEARCH / SCAN " : " NAVIGATION ";
  searchBox.titleColor = currentView === "POS" && inputMode ? activeTheme.primary : activeTheme.secondary;
  searchBox.bottomTitle =
    currentView === "POS"
      ? inputMode
        ? " input mode · Esc releases hotkeys "
        : " nav mode · search key to type "
      : editingForm
        ? " editing · Esc cancels "
        : " navigation mode ";
  searchText.fg = currentView === "POS" && inputMode ? activeTheme.text : activeTheme.muted;
  searchText.content = searchLine(Math.max(10, innerWidth - 6));
  searchText.width = Math.max(10, innerWidth - 6);

  bodyBox.height = bodyHeight;
  bodyBox.width = bodyWidth;
  catalogBox.width = catalogWidth;
  cartBox.width = cartWidth;

  const catalogFocused =
    (currentView === "POS" && (focus === "CATALOG" || focus === "SEARCH")) ||
    currentView === "INVENTORY" ||
    currentView === "HISTORY" ||
    currentView === "ANALYTICS" ||
    (currentView === "SETTINGS" && settingsSection === "menu");
  const cartFocused = currentView === "POS" && focus === "CART";

  catalogBox.backgroundColor = activeTheme.surface;
  catalogBox.borderColor = catalogFocused ? activeTheme.secondary : activeTheme.border;
  catalogBox.titleColor = catalogFocused ? activeTheme.secondary : activeTheme.muted;
  catalogText.fg = activeTheme.text;
  catalogText.height = contentRows;
  catalogText.width = catalogInner;

  cartBox.backgroundColor = activeTheme.surface;
  cartBox.borderColor = cartFocused ? activeTheme.accent : activeTheme.border;
  cartBox.titleColor = cartFocused ? activeTheme.accent : activeTheme.muted;
  cartText.fg = activeTheme.text;
  cartText.height = contentRows;
  cartText.width = cartInner;

  let leftLines: string[];
  let rightLines: string[];

  if (currentView === "POS") {
    leftLines = renderProductCatalog(catalogInner, contentRows);
    rightLines = renderCart(cartInner, contentRows);
  } else if (currentView === "INVENTORY") {
    leftLines = renderInventoryList(catalogInner, contentRows);
    rightLines = renderInventoryDetails(cartInner, contentRows);
  } else if (currentView === "HISTORY") {
    leftLines = renderHistoryList(catalogInner, contentRows);
    rightLines = renderHistoryDetails(cartInner, contentRows);
  } else if (currentView === "ANALYTICS") {
    leftLines = renderAnalyticsSummary(catalogInner, contentRows);
    rightLines = renderAnalyticsDetails(cartInner, contentRows);
  } else {
    leftLines = renderSettingsMenu(catalogInner, contentRows);
    rightLines = renderSettingsDetail(cartInner, contentRows);
  }

  catalogBox.title = catalogTitle(filteredProducts());
  catalogBox.bottomTitle = catalogBottomTitle();
  catalogText.content = leftLines.slice(0, contentRows).join("\n");

  cartBox.title = cartTitle();
  cartBox.bottomTitle = cartBottomTitle();
  cartText.content = rightLines.slice(0, contentRows).join("\n");

  footer.backgroundColor = activeTheme.surface;
  footer.borderColor = activeTheme.border;
  footerStatus.fg = statusColor(activeTheme);
  footerStatus.content = clip(` ${statusMessage}`, Math.max(10, innerWidth - 4));
  footerStatus.width = Math.max(10, innerWidth - 4);
  footerKeys.fg = activeTheme.muted;
  footerKeys.content = clip(keysHint(), Math.max(10, innerWidth - 4));
  footerKeys.width = Math.max(10, innerWidth - 4);

  modalLayer.backgroundColor = activeTheme.background;
  modalLayer.width = "100%";
  modalLayer.height = "100%";
  renderModal();
}

/* ------------------------------------------------------------------ */
/* Keyboard                                                            */
/* ------------------------------------------------------------------ */

function keyToken(key: KeyEvent): string {
  return normalizeBindingKey(key.name, key.sequence);
}

function matchesBinding(key: KeyEvent, action: ActionName): boolean {
  return keyToken(key) === bindings[action];
}

function quitApp(): never {
  renderer.destroy();
  process.exit(0);
}

function cycleThemePersisted(): void {
  const theme = cycleTheme();
  saveThemeKey(theme.key);
  activeTheme = theme;
  if (screen === "app") setStatus(`Theme changed to ${theme.name} (saved).`, "success");
  updateUI();
}

function openHelp(): void {
  modal = { kind: "help" };
  modalScroll = 0;
  updateUI();
}

function closeModal(): void {
  modal = null;
  modalScroll = 0;
  updateUI();
}

function handleModalKey(key: KeyEvent): void {
  if (modal?.kind === "confirm") {
    if (key.name === "y" || key.name === "return") {
      const current = modal;
      modal = null;
      modalScroll = 0;
      if (current.action === "clear-cart") {
        cart = [];
        cartIndex = 0;
        setStatus("Cart cleared.", "warning");
        updateUI();
      } else if (current.action === "delete-product" && current.productId !== undefined) {
        executeDeleteProduct(current.productId);
        updateUI();
      } else if (current.action === "delete-ingredient" && current.ingredientId !== undefined) {
        executeDeleteIngredient(current.ingredientId);
        updateUI();
      } else if (current.action === "delete-user" && current.userId !== undefined) {
        executeDeleteUser(current.userId);
        updateUI();
      } else if (current.action === "logout") {
        signOut();
      }
      return;
    }

    if (key.name === "n" || key.name === "escape" || key.name === "q") {
      modal = null;
      modalScroll = 0;
      setStatus("Action cancelled.", "info");
      updateUI();
    }
    return;
  }

  if (modal?.kind === "payment") {
    if (key.name === "escape") {
      modal = null;
      setStatus("Payment cancelled — cart kept.", "info");
      updateUI();
      return;
    }
    if (key.name === "left" || key.name === "up" || (key.name === "tab" && key.shift)) {
      modal.methodIndex = (modal.methodIndex - 1 + PAYMENT_METHODS.length) % PAYMENT_METHODS.length;
      modal.error = null;
      updateUI();
      return;
    }
    if (key.name === "right" || key.name === "down" || key.name === "tab") {
      modal.methodIndex = (modal.methodIndex + 1) % PAYMENT_METHODS.length;
      modal.error = null;
      updateUI();
      return;
    }
    if (key.name === "backspace") {
      modal.tendered = modal.tendered.slice(0, -1);
      modal.error = null;
      updateUI();
      return;
    }
    if (key.name === "return") {
      completeSale(modal.methodIndex, modal.tendered);
      return;
    }
    if (PAYMENT_METHODS[modal.methodIndex] === "Cash" && isPrintable(key) && /[0-9.]/.test(key.sequence)) {
      if (key.sequence === "." && modal.tendered.includes(".")) return;
      if (modal.tendered.length >= 10) return;
      modal.tendered += key.sequence;
      modal.error = null;
      updateUI();
    }
    return;
  }

  if (key.name === "escape" || key.name === "return") {
    closeModal();
    return;
  }
  if (key.name === "up" || key.name === "k") {
    modalScroll = Math.max(0, modalScroll - 1);
    updateUI();
    return;
  }
  if (key.name === "down" || key.name === "j") {
    modalScroll += 1;
    updateUI();
    return;
  }
  if (key.name === "pageup") {
    modalScroll = Math.max(0, modalScroll - 10);
    updateUI();
    return;
  }
  if (key.name === "pagedown") {
    modalScroll += 10;
    updateUI();
    return;
  }
  if (key.name === "home") {
    modalScroll = 0;
    updateUI();
    return;
  }
  if (key.name === "end") {
    modalScroll = 1_000_000;
    updateUI();
  }
}

function handleProductFormKey(key: KeyEvent): void {
  const form = productForm;
  if (!form) return;
  if (key.name === "escape") {
    cancelProductForm();
    return;
  }
  if (key.ctrl && key.name === "s") {
    saveProductForm();
    return;
  }
  if (key.name === "tab" || key.name === "down" || key.name === "return") {
    if (key.name === "return" && form.field === FORM_FIELDS.length - 1) {
      saveProductForm();
      return;
    }
    form.field = (form.field + 1) % FORM_FIELDS.length;
    updateUI();
    return;
  }
  if (key.name === "up") {
    form.field = (form.field - 1 + FORM_FIELDS.length) % FORM_FIELDS.length;
    updateUI();
    return;
  }
  if (key.name === "backspace") {
    setProductFormValue(form, form.field, productFormValue(form, form.field).slice(0, -1));
    updateUI();
    return;
  }
  if (!isPrintable(key)) return;
  const character = key.sequence;
  if (form.field === 2 && !/[0-9.]/.test(character)) return;
  if (form.field === 3 && !/[0-9]/.test(character)) return;
  setProductFormValue(form, form.field, `${productFormValue(form, form.field)}${character}`);
  updateUI();
}

function handleIngredientFormKey(key: KeyEvent): void {
  const form = ingredientForm;
  if (!form) return;
  if (key.name === "escape") {
    cancelIngredientForm();
    return;
  }
  if (key.ctrl && key.name === "s") {
    saveIngredientForm();
    return;
  }
  if (key.name === "tab" || key.name === "down" || key.name === "return") {
    if (key.name === "return" && form.field === INGREDIENT_FIELDS.length - 1) {
      saveIngredientForm();
      return;
    }
    form.field = (form.field + 1) % INGREDIENT_FIELDS.length;
    updateUI();
    return;
  }
  if (key.name === "up") {
    form.field = (form.field - 1 + INGREDIENT_FIELDS.length) % INGREDIENT_FIELDS.length;
    updateUI();
    return;
  }
  if (key.name === "backspace") {
    setIngredientFormValue(form, form.field, ingredientFormValue(form, form.field).slice(0, -1));
    updateUI();
    return;
  }
  if (!isPrintable(key)) return;
  const character = key.sequence;
  if ((form.field === 2 || form.field === 3) && !/[0-9.]/.test(character)) return;
  setIngredientFormValue(form, form.field, `${ingredientFormValue(form, form.field)}${character}`);
  updateUI();
}

function handleRecipeEditorKey(key: KeyEvent): void {
  const editor = recipeEditor;
  if (!editor) return;
  if (key.name === "escape") {
    recipeEditor = null;
    inputMode = false;
    setFocus("INVENTORY");
    setStatus("Recipe edit cancelled.", "info");
    updateUI();
    return;
  }
  if (key.name === "return") {
    saveRecipeEditor();
    return;
  }
  if (key.name === "up" || key.name === "down" || key.name === "tab") {
    const delta = key.name === "up" || (key.name === "tab" && key.shift) ? -1 : 1;
    editor.index = (editor.index + delta + editor.rows.length) % Math.max(1, editor.rows.length);
    updateUI();
    return;
  }
  const row = editor.rows[editor.index];
  if (!row) return;
  if (key.name === "backspace") {
    row.quantity = row.quantity.slice(0, -1);
    updateUI();
    return;
  }
  if (!isPrintable(key)) return;
  if (!/[0-9.]/.test(key.sequence)) return;
  if (key.sequence === "." && row.quantity.includes(".")) return;
  row.quantity = `${row.quantity === "0" ? "" : row.quantity}${key.sequence}`;
  updateUI();
}

function handleShortcutCapture(key: KeyEvent): void {
  const action = shortcutCapture;
  if (!action) return;
  if (key.name === "escape") {
    shortcutCapture = null;
    setStatus("Shortcut remap cancelled.", "info");
    updateUI();
    return;
  }

  const token = keyToken(key);
  if (isReservedBinding(token)) {
    setStatus(`"${bindingLabel(token)}" is reserved for navigation or editing.`, "danger");
    shortcutCapture = null;
    updateUI();
    return;
  }
  const duplicate = actionForKeyExcluding(bindings, token, action);
  if (duplicate) {
    const duplicateLabel = ACTIONS.find((definition) => definition.action === duplicate)?.label ?? duplicate;
    setStatus(`"${bindingLabel(token)}" is already used by ${duplicateLabel}.`, "danger");
    shortcutCapture = null;
    updateUI();
    return;
  }

  bindings = { ...bindings, [action]: token };
  saveKeybindings(bindings);
  shortcutCapture = null;
  setStatus(`Shortcut updated: ${bindingLabel(token)}.`, "success");
  updateUI();
}

function handleStoreFormKey(key: KeyEvent): void {
  const form = storeForm;
  if (!form) return;
  if (key.name === "escape") {
    backToSettingsMenu();
    return;
  }
  if (key.ctrl && key.name === "s") {
    saveStoreForm();
    return;
  }
  if (key.name === "tab" || key.name === "down" || key.name === "return") {
    if (key.name === "return" && form.field === STORE_FIELDS.length - 1) {
      saveStoreForm();
      return;
    }
    form.field = (form.field + 1) % STORE_FIELDS.length;
    updateUI();
    return;
  }
  if (key.name === "up") {
    form.field = (form.field - 1 + STORE_FIELDS.length) % STORE_FIELDS.length;
    updateUI();
    return;
  }
  if (form.field === 2 && (key.name === "left" || key.name === "right" || key.name === "space" || key.name === "1" || key.name === "2")) {
    const chooseCafe =
      key.name === "left" || key.name === "1" || (key.name === "space" && form.storeType === "retail");
    form.storeType = chooseCafe ? "cafe" : "retail";
    updateUI();
    return;
  }
  if (key.name === "backspace") {
    if (form.field === 0) form.name = form.name.slice(0, -1);
    else if (form.field === 1) form.address = form.address.slice(0, -1);
    else if (form.field === 3) form.currency = form.currency.slice(0, -1);
    else if (form.field === 4) form.taxRate = form.taxRate.slice(0, -1);
    updateUI();
    return;
  }
  if (!isPrintable(key)) return;
  const character = key.sequence;
  if (form.field === 0) form.name += character;
  else if (form.field === 1) form.address += character;
  else if (form.field === 3 && form.currency.length < 4) form.currency += character;
  else if (form.field === 4) {
    if (!/[0-9.]/.test(character)) return;
    if (character === "." && form.taxRate.includes(".")) return;
    form.taxRate += character;
  }
  updateUI();
}

function handleUserFormKey(key: KeyEvent): void {
  const form = userForm;
  if (!form) return;
  if (key.name === "escape") {
    userForm = null;
    inputMode = false;
    setStatus("User edit cancelled.", "info");
    updateUI();
    return;
  }
  if (key.ctrl && key.name === "s") {
    saveUserForm();
    return;
  }

  const maxField = form.mode === "new" ? 2 : 0;
  if (key.name === "tab" || key.name === "down" || key.name === "return") {
    if (key.name === "return" && form.field === maxField) {
      saveUserForm();
      return;
    }
    form.field = (form.field + 1) % (maxField + 1);
    updateUI();
    return;
  }
  if (key.name === "up") {
    form.field = (form.field - 1 + maxField + 1) % (maxField + 1);
    updateUI();
    return;
  }
  if (form.mode === "new" && form.field === 2) {
    if (key.name === "left") {
      form.roleIndex = (form.roleIndex - 1 + USER_ROLES.length) % USER_ROLES.length;
      updateUI();
      return;
    }
    if (key.name === "right" || key.name === "space") {
      form.roleIndex = (form.roleIndex + 1) % USER_ROLES.length;
      updateUI();
      return;
    }
    if (key.name === "1" || key.name === "2" || key.name === "3") {
      form.roleIndex = Number.parseInt(key.name, 10) - 1;
      updateUI();
      return;
    }
  }
  if (key.name === "backspace") {
    if (form.field === 0 && form.mode === "new") form.username = form.username.slice(0, -1);
    else form.pin = form.pin.slice(0, -1);
    updateUI();
    return;
  }
  if (!isPrintable(key)) return;
  if (form.field === 0 && form.mode === "new") {
    if (form.username.length < 24) form.username += key.sequence;
  } else if (form.field === 1 || form.mode === "pin") {
    if (/[0-9]/.test(key.sequence) && form.pin.length < 6) form.pin += key.sequence;
  }
  updateUI();
}

function handleSettingsKey(key: KeyEvent): void {
  if (shortcutCapture) {
    handleShortcutCapture(key);
    return;
  }
  if (dataImportMode) {
    if (key.name === "escape") {
      dataImportMode = false;
      setStatus("Import cancelled.", "info");
      updateUI();
      return;
    }
    if (key.name === "return") {
      runProductImport();
      return;
    }
    if (key.name === "backspace") {
      dataImportPath = dataImportPath.slice(0, -1);
      updateUI();
      return;
    }
    if (key.ctrl && key.name === "u") {
      dataImportPath = "";
      updateUI();
      return;
    }
    if (isPrintable(key) && dataImportPath.length < 120) {
      dataImportPath += key.sequence;
      updateUI();
    }
    return;
  }
  if (storeForm) {
    handleStoreFormKey(key);
    return;
  }
  if (userForm) {
    handleUserFormKey(key);
    return;
  }

  if (key.name === "q" && settingsSection === "menu") quitApp();

  if (settingsSection === "shortcuts") {
    if (key.name === "escape") {
      backToSettingsMenu();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      shortcutIndex = (shortcutIndex + (key.name === "up" ? -1 : 1) + ACTIONS.length) % ACTIONS.length;
      updateUI();
      return;
    }
    const action = ACTIONS[shortcutIndex];
    if (!action) return;
    if (key.name === "return") {
      shortcutCapture = action.action;
      setStatus(`Press the new key for ${action.label}. Esc cancels.`);
      updateUI();
      return;
    }
    if (key.name === "backspace") {
      bindings = { ...bindings, [action.action]: DEFAULT_BINDINGS[action.action] };
      saveKeybindings(bindings);
      setStatus(`${action.label} restored to ${bindingLabel(DEFAULT_BINDINGS[action.action])}.`, "success");
      updateUI();
      return;
    }
    if (key.name === "r") {
      bindings = resetKeybindings();
      setStatus("All shortcuts restored to defaults.", "success");
      updateUI();
    }
    return;
  }

  if (settingsSection === "users") {
    if (key.name === "escape") {
      backToSettingsMenu();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      userIndex = clamp(userIndex + (key.name === "up" ? -1 : 1), 0, Math.max(0, accounts.length - 1));
      updateUI();
      return;
    }
    if (key.name === "a") {
      startNewUser();
      return;
    }
    if (key.name === "p") {
      startPinReset();
      return;
    }
    if (key.name === "delete" || key.name === "x") {
      openDeleteUserConfirm();
      updateUI();
    }
    return;
  }

  if (settingsSection === "data") {
    if (key.name === "escape") {
      backToSettingsMenu();
      return;
    }
    if (key.name === "e") {
      exportProducts();
      return;
    }
    if (key.name === "i") {
      dataImportMode = true;
      dataMessage = `Type a path, then Enter. Current: ${dataImportPath}`;
      setStatus("Enter a CSV or JSON file path.", "info");
      updateUI();
    }
    return;
  }

  if (settingsSection === "store") {
    if (key.name === "escape") backToSettingsMenu();
    return;
  }

  // Menu
  if (key.name === "escape") {
    switchView("POS");
    return;
  }
  if (key.name === "up" || key.name === "down") {
    settingsMenuIndex = (settingsMenuIndex + (key.name === "up" ? -1 : 1) + SETTINGS_MENU.length) % SETTINGS_MENU.length;
    updateUI();
    return;
  }
  if (key.name === "return") {
    openSettingsSection();
  }
}

function handleInventoryKey(key: KeyEvent): void {
  if (productForm) {
    handleProductFormKey(key);
    return;
  }
  if (ingredientForm) {
    handleIngredientFormKey(key);
    return;
  }
  if (recipeEditor) {
    handleRecipeEditorKey(key);
    return;
  }

  if (key.name === "q") quitApp();

  if (inventoryMode === "ingredients") {
    if (key.name === "escape" || key.name === "i") {
      inventoryMode = "products";
      setStatus("Product inventory.", "info");
      updateUI();
      return;
    }
    if (key.name === "up" || key.name === "down") {
      ingredientIndex = clamp(
        ingredientIndex + (key.name === "up" ? -1 : 1),
        0,
        Math.max(0, ingredients.length - 1)
      );
      updateUI();
      return;
    }
    if (key.name === "a") {
      openIngredientForm("new");
      return;
    }
    if (key.name === "return" || key.name === "e") {
      openIngredientForm("edit");
      return;
    }
    if (key.name === "delete" || key.name === "x") {
      openDeleteIngredientConfirm();
      updateUI();
    }
    return;
  }

  if (key.name === "escape") {
    switchView("POS");
    return;
  }
  if (key.name === "up" || key.name === "down") {
    inventoryIndex = clamp(inventoryIndex + (key.name === "up" ? -1 : 1), 0, Math.max(0, products.length - 1));
    updateUI();
    return;
  }
  if (key.name === "a") {
    openProductForm("new");
    return;
  }
  if (key.name === "return" || key.name === "e") {
    openProductForm("edit");
    return;
  }
  if (key.name === "delete" || key.name === "x") {
    openDeleteProductConfirm();
    updateUI();
    return;
  }
  if (key.name === "r") {
    openRecipeEditor();
    return;
  }
  if (key.name === "i") {
    if (storeType() !== "cafe") {
      setStatus("Ingredient inventory is only used in Cafe mode.", "warning");
      updateUI();
      return;
    }
    inventoryMode = "ingredients";
    ingredientIndex = 0;
    setStatus("Ingredient inventory — A add, Enter edit, Del delete, I back.");
    updateUI();
  }
}

function handleSearchKey(key: KeyEvent): void {
  if (key.name === "escape") {
    inputMode = false;
    focus = "CATALOG";
    setStatus("Search closed — single-key hotkeys are active.");
    updateUI();
    return;
  }
  if (key.name === "tab") {
    cycleFocus(key.shift ? -1 : 1);
    updateUI();
    return;
  }
  if (key.name === "return") {
    submitSearch();
    return;
  }
  if (key.name === "backspace") {
    searchQuery = searchQuery.slice(0, -1);
    catalogIndex = 0;
    updateUI();
    return;
  }
  if (key.ctrl && key.name === "u") {
    searchQuery = "";
    catalogIndex = 0;
    updateUI();
    return;
  }
  if (key.name === "up" || key.name === "down") {
    const items = filteredProducts();
    catalogIndex = clamp(catalogIndex + (key.name === "up" ? -1 : 1), 0, Math.max(0, items.length - 1));
    updateUI();
    return;
  }
  if (isPrintable(key)) {
    searchQuery += key.sequence;
    catalogIndex = 0;
    updateUI();
  }
}

function submitSearch(): void {
  const term = searchQuery.trim();
  if (!term) {
    setStatus("Type a product name or scan a barcode first.", "warning");
    return;
  }
  const exact = getProductByBarcode(term);
  const matches = exact ? [exact] : searchProducts(term);
  if (matches.length === 0) {
    setStatus(`No product matches "${term}".`, "danger");
    updateUI();
    return;
  }
  const selected = matches[clamp(catalogIndex, 0, matches.length - 1)] ?? matches[0]!;
  addToCart(selected);
  searchQuery = "";
  catalogIndex = 0;
  updateUI();
}

function tryGlobalNavigation(key: KeyEvent): boolean {
  const token = keyToken(key);
  const action = actionForKey(bindings, token);
  if (!action || action === "theme" || action === "help") return false;

  const editing =
    productForm !== null ||
    ingredientForm !== null ||
    recipeEditor !== null ||
    storeForm !== null ||
    userForm !== null ||
    dataImportMode ||
    shortcutCapture !== null;
  if (editing && !/^f\d+$/.test(token)) return false;
  if (
    editing &&
    (action === "inventory" ||
      action === "analytics" ||
      action === "settings" ||
      action === "history" ||
      action === "logout")
  ) {
    return false;
  }

  const isFunctionKey = /^f\d+$/.test(token);
  if (inputMode && !isFunctionKey) return false;

  if (action === "inventory") {
    switchView("INVENTORY");
    return true;
  }
  if (action === "analytics") {
    switchView("ANALYTICS");
    return true;
  }
  if (action === "settings") {
    switchView("SETTINGS");
    return true;
  }
  if (action === "history") {
    switchView("HISTORY");
    return true;
  }
  if (action === "search") {
    if (!currentUser) return true;
    if (currentView !== "POS") switchView("POS");
    setFocus("SEARCH");
    updateUI();
    return true;
  }
  if (action === "checkout") {
    if (currentView === "POS") beginCheckout();
    return true;
  }
  if (action === "discount") {
    if (currentView === "POS") {
      const current = DISCOUNTS.indexOf(discountPercent);
      discountPercent = DISCOUNTS[(current + 1) % DISCOUNTS.length] ?? 0;
      setStatus(`Discount set to ${discountPercent}%.`, "info");
      updateUI();
    }
    return true;
  }
  if (action === "logout") {
    modal = {
      kind: "confirm",
      action: "logout",
      message: `Sign out ${currentUser?.username ?? "this user"} and lock the terminal?`,
    };
    updateUI();
    return true;
  }
  return false;
}

function handleNavigationKey(key: KeyEvent): void {
  if (key.name === "q") quitApp();

  if (key.name === "tab") {
    cycleFocus(key.shift ? -1 : 1);
    updateUI();
    return;
  }

  if (key.name === "escape") {
    if (currentView !== "POS") {
      switchView("POS");
    } else if (searchQuery) {
      searchQuery = "";
      catalogIndex = 0;
      setStatus("Search cleared.", "info");
      updateUI();
    } else {
      setStatus("Hotkeys active — press the search key to type, Tab to move focus.", "info");
      updateUI();
    }
    return;
  }

  if (key.name === "right" || key.name === "left") {
    if (currentView === "POS") {
      setFocus(key.name === "right" ? "CART" : "CATALOG");
      updateUI();
    }
    return;
  }

  if (key.name === "up" || key.name === "down") {
    const delta = key.name === "up" ? -1 : 1;
    if (currentView === "POS" && focus === "CART") {
      cartIndex = clamp(cartIndex + delta, 0, Math.max(0, cart.length - 1));
    } else if (currentView === "POS") {
      const items = filteredProducts();
      catalogIndex = clamp(catalogIndex + delta, 0, Math.max(0, items.length - 1));
    } else if (currentView === "HISTORY") {
      historyIndex = clamp(historyIndex + delta, 0, Math.max(0, history.length - 1));
    }
    updateUI();
    return;
  }

  if (key.name === "pageup" || key.name === "pagedown") {
    const delta = (key.name === "pageup" ? -1 : 1) * 5;
    if (currentView === "POS" && focus === "CART") {
      cartIndex = clamp(cartIndex + delta, 0, Math.max(0, cart.length - 1));
    } else if (currentView === "POS") {
      const items = filteredProducts();
      catalogIndex = clamp(catalogIndex + delta, 0, Math.max(0, items.length - 1));
    } else if (currentView === "HISTORY") {
      historyIndex = clamp(historyIndex + delta, 0, Math.max(0, history.length - 1));
    }
    updateUI();
    return;
  }

  if (key.name === "home" || key.name === "end") {
    const value = key.name === "home" ? 0 : Number.MAX_SAFE_INTEGER;
    if (currentView === "POS" && focus === "CART") {
      cartIndex = clamp(value, 0, Math.max(0, cart.length - 1));
    } else if (currentView === "POS") {
      catalogIndex = clamp(value, 0, Math.max(0, filteredProducts().length - 1));
    } else if (currentView === "HISTORY") {
      historyIndex = clamp(value, 0, Math.max(0, history.length - 1));
    }
    updateUI();
    return;
  }

  if (currentView === "POS") {
    if (key.name === "space") {
      beginCheckout();
      return;
    }
    if (focus === "CART") {
      if (key.name === "+" || key.name === "plus" || key.sequence === "+" || key.name === "=") {
        changeCartQuantity(1);
        updateUI();
        return;
      }
      if (key.name === "-" || key.name === "minus" || key.sequence === "-") {
        changeCartQuantity(-1);
        updateUI();
        return;
      }
      if (key.name === "delete" || key.name === "backspace") {
        if (key.ctrl || key.shift) openClearCartConfirm();
        else removeSelectedCartItem();
        updateUI();
        return;
      }
      if (key.name === "x") {
        openClearCartConfirm();
        updateUI();
        return;
      }
      if (key.name === "return") {
        changeCartQuantity(1);
        updateUI();
        return;
      }
    }

    if (focus === "CATALOG" || focus === "SEARCH") {
      if (key.name === "return") {
        const product = filteredProducts()[catalogIndex];
        if (product) addToCart(product);
        updateUI();
        return;
      }
      if (key.name === "=" || key.name === "+" || key.name === "plus" || key.sequence === "+") {
        const product = filteredProducts()[catalogIndex];
        if (product) addToCart(product);
        updateUI();
        return;
      }
      const quickAdd = Number.parseInt(key.name, 10);
      if (!Number.isNaN(quickAdd) && quickAdd >= 1 && quickAdd <= 9) {
        const product = filteredProducts()[quickAdd - 1];
        if (product) {
          catalogIndex = quickAdd - 1;
          addToCart(product);
          updateUI();
        }
        return;
      }
    }
    return;
  }

  if (currentView === "HISTORY") {
    if (key.name === "return") {
      openHistoryReceipt();
      return;
    }
    if (key.name === "r") {
      reprintHistoryReceipt();
    }
  }
}

/* ------------------------------------------------------------------ */
/* Startup                                                             */
/* ------------------------------------------------------------------ */

renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && key.name === "c") quitApp();

  // Shortcut capture must see the literal key before any global binding.
  if (screen === "app" && currentView === "SETTINGS" && shortcutCapture) {
    handleShortcutCapture(key);
    return;
  }

  // Themes are persistent and available on every screen, including login.
  if (matchesBinding(key, "theme")) {
    cycleThemePersisted();
    return;
  }

  if (screen === "login") {
    handleLoginKey(key);
    return;
  }
  if (screen === "onboarding") {
    handleOnboardingKey(key);
    return;
  }

  if (modal) {
    handleModalKey(key);
    return;
  }

  if (matchesBinding(key, "help")) {
    openHelp();
    return;
  }

  if (tryGlobalNavigation(key)) return;

  if (currentView === "INVENTORY") {
    handleInventoryKey(key);
    return;
  }
  if (currentView === "SETTINGS") {
    handleSettingsKey(key);
    return;
  }
  if (currentView === "POS" && inputMode) {
    handleSearchKey(key);
    return;
  }
  handleNavigationKey(key);
});

renderer.on("resize", () => {
  updateUI();
});

refreshAll();
updateUI();
