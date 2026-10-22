import {
  BoxRenderable,
  TextAttributes,
  TextRenderable,
  createCliRenderer,
  type KeyEvent,
} from "@opentui/core";

import {
  addProduct,
  deleteProduct,
  getProductById,
  getProductByBarcode,
  getProducts,
  getRecentTransactions,
  getTodayStats,
  getTransactionItems,
  initDb,
  recordTransaction,
  searchProducts,
  updateProduct,
  type CartItem,
  type Product,
  type TransactionRecord,
} from "./db/database";
import { cycleTheme, getTheme, type Theme } from "./themes/themes";
import {
  appendReceiptToLog,
  generateReceiptText,
  receiptLines,
  type ReceiptItem,
} from "./utils/printer";

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

type View = "POS" | "INVENTORY" | "HISTORY";
type Focus = "SEARCH" | "CATALOG" | "CART" | "INVENTORY" | "HISTORY";
type StatusKind = "info" | "success" | "warning" | "danger";

interface ProductForm {
  mode: "new" | "edit";
  id: number | null;
  field: number;
  name: string;
  barcode: string;
  price: string;
  stock: string;
}

type ModalState =
  | { kind: "receipt"; title: string; receipt: string; note: string }
  | { kind: "help" }
  | {
      kind: "confirm";
      action: "clear-cart" | "delete-product";
      message: string;
      productId?: number;
    }
  | null;

const FORM_FIELDS = ["Name", "Barcode", "Price", "Stock"] as const;
const DISCOUNTS = [0, 5, 10, 15, 20];
const POS_FOCUS_ORDER: Focus[] = ["SEARCH", "CATALOG", "CART"];

initDb();

let products: Product[] = getProducts();
let cart: CartItem[] = [];
let history: TransactionRecord[] = getRecentTransactions(100);
let todayStats = getTodayStats();

let currentView: View = "POS";
/** The single source of truth for "typing belongs to the app, not to hotkeys". */
let inputMode = true;
let focus: Focus = "SEARCH";
let searchQuery = "";
let catalogIndex = 0;
let cartIndex = 0;
let inventoryIndex = 0;
let historyIndex = 0;
let discountPercent = 0;
let productForm: ProductForm | null = null;
let modal: ModalState = null;
let modalScroll = 0;
let statusMessage = "Ready — scan a barcode or type to search.";
let statusKind: StatusKind = "info";
let activeTheme: Theme = getTheme();

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
  return `$${value.toFixed(2)}`;
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
  historyIndex = clamp(historyIndex, 0, Math.max(0, history.length - 1));
}

function refreshProducts(): void {
  products = getProducts();
  clampSelections();
}

function refreshHistory(): void {
  history = getRecentTransactions(100);
  todayStats = getTodayStats();
  clampSelections();
}

function cycleFocus(direction: 1 | -1): void {
  if (currentView === "POS") {
    const index = POS_FOCUS_ORDER.indexOf(focus);
    const safeIndex = index < 0 ? 0 : index;
    const next = POS_FOCUS_ORDER[(safeIndex + direction + POS_FOCUS_ORDER.length) % POS_FOCUS_ORDER.length]!;
    setFocus(next);
    return;
  }

  setFocus(currentView === "INVENTORY" ? "INVENTORY" : "HISTORY");
}

function setFocus(next: Focus): void {
  focus = next;
  inputMode = next === "SEARCH" || productForm !== null;

  if (next === "SEARCH") {
    setStatus("Search mode — typing goes to the search bar. Esc releases hotkeys.");
  } else if (next === "CATALOG") {
    setStatus("Product catalogue focused — Enter adds the selected item.");
  } else if (next === "CART") {
    setStatus("Cart focused — +/- change quantity, Del removes, Ctrl+Del clears.");
  } else if (next === "INVENTORY") {
    setStatus("Inventory focused — Enter edits, A adds, Del deletes.");
  } else if (next === "HISTORY") {
    setStatus("Sales history focused — Enter opens a receipt, R reprints.");
  }
}

function switchView(view: View): void {
  currentView = view;
  modal = null;
  modalScroll = 0;
  productForm = null;
  searchQuery = "";
  catalogIndex = 0;

  if (view === "POS") {
    setFocus("CATALOG");
    setStatus("Point of sale ready — press / to search or scan a barcode.");
  } else if (view === "INVENTORY") {
    refreshProducts();
    setFocus("INVENTORY");
    setStatus("Inventory management — Enter edits the selected product.");
  } else {
    refreshHistory();
    setFocus("HISTORY");
    setStatus(`Sales history — ${history.length} recent transaction${history.length === 1 ? "" : "s"}.`);
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

function cartTotal(): number {
  return round2(cartSubtotal() - cartDiscount());
}

function addToCart(product: Product): void {
  const fresh = getProductById(product.id) ?? product;

  if (fresh.stock <= 0) {
    setStatus(`${fresh.name} is out of stock.`, "danger");
    return;
  }

  const existing = cart.find((item) => item.id === fresh.id);
  if (existing) {
    if (existing.qty >= fresh.stock) {
      setStatus(`Only ${fresh.stock} × ${fresh.name} in stock.`, "warning");
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
    const product = getProductById(item.id);
    const stock = product?.stock ?? item.qty;
    if (item.qty >= stock) {
      setStatus(`Only ${stock} × ${item.name} in stock.`, "warning");
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

function checkout(): void {
  if (cart.length === 0) {
    setStatus("Cannot checkout an empty cart.", "warning");
    return;
  }

  for (const item of cart) {
    const product = getProductById(item.id);
    if (!product) {
      setStatus(`${item.name} no longer exists in the catalogue.`, "danger");
      return;
    }
    if (item.qty > product.stock) {
      setStatus(`Stock changed: only ${product.stock} × ${item.name} remain.`, "danger");
      refreshProducts();
      return;
    }
  }

  const subtotal = cartSubtotal();
  const discountAmount = cartDiscount();
  const total = cartTotal();
  const receiptItems: ReceiptItem[] = cart.map((item) => ({
    name: item.name,
    price: item.price,
    qty: item.qty,
  }));

  let transactionId: number;
  try {
    transactionId = recordTransaction(subtotal, discountAmount, total, "Cash", cart);
  } catch (error) {
    setStatus(`Checkout failed: ${error instanceof Error ? error.message : String(error)}`, "danger");
    updateUI();
    return;
  }

  const receipt = generateReceiptText(receiptItems, subtotal, discountPercent, total, "Cash", {
    transactionId,
    discountPercent,
  });

  let note = "Sale saved · receipt appended to receipts.log.";
  try {
    appendReceiptToLog(receipt);
  } catch (error) {
    note = `Sale saved, but receipts.log could not be written: ${
      error instanceof Error ? error.message : String(error)
    }`;
  }

  // OpenTUI captures console.log in its console overlay; the receipt remains
  // readable in the modal and is also appended to disk by printer.ts.
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
  setStatus(`Sale #${transactionId} complete — ${money(total)} charged.`, "success");
  updateUI();
}

/* ------------------------------------------------------------------ */
/* Search and inventory form actions                                   */
/* ------------------------------------------------------------------ */

function submitSearch(): void {
  const term = searchQuery.trim();
  if (!term) {
    setStatus("Type a product name or scan a barcode first.", "warning");
    return;
  }

  const exact = getProductByBarcode(term);
  const matches = exact ? [exact] : searchProducts(term);
  if (matches.length === 0) {
    setStatus(`No product matches “${term}”.`, "danger");
    return;
  }

  const selected = matches[clamp(catalogIndex, 0, matches.length - 1)] ?? matches[0]!;
  addToCart(selected);
  searchQuery = "";
  catalogIndex = 0;
}

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
    const nextBarcode = `890${Math.floor(1000 + Math.random() * 9000)}`;
    productForm = {
      mode: "new",
      id: null,
      field: 0,
      name: "",
      barcode: nextBarcode,
      price: "0.00",
      stock: "0",
    };
  }

  inputMode = true;
  focus = "INVENTORY";
  setStatus(`${mode === "new" ? "New product" : "Editing product"} — Tab moves fields, Enter saves.`);
  updateUI();
}

function cancelProductForm(): void {
  productForm = null;
  inputMode = false;
  focus = "INVENTORY";
  setStatus("Edit cancelled.", "info");
  updateUI();
}

function formValue(form: ProductForm, field: number): string {
  if (field === 0) return form.name;
  if (field === 1) return form.barcode;
  if (field === 2) return form.price;
  return form.stock;
}

function setFormValue(form: ProductForm, field: number, value: string): void {
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

function openDeleteConfirm(): void {
  const product = products[inventoryIndex];
  if (!product) {
    setStatus("Select a product to delete first.", "warning");
    return;
  }

  modal = {
    kind: "confirm",
    action: "delete-product",
    productId: product.id,
    message: `Delete “${product.name}” (#${product.id}) from inventory?`,
  };
}

function deleteConfirmedProduct(productId: number): void {
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

/* ------------------------------------------------------------------ */
/* History                                                             */
/* ------------------------------------------------------------------ */

function receiptForTransaction(transaction: TransactionRecord): string {
  const items = getTransactionItems(transaction);
  const percent = transaction.subtotal > 0
    ? round2((transaction.discount_amount / transaction.subtotal) * 100)
    : 0;

  return generateReceiptText(
    items.map((item) => ({ name: item.name, price: item.price, qty: item.qty })),
    transaction.subtotal,
    percent,
    transaction.total_amount,
    transaction.payment_method,
    {
      transactionId: transaction.id,
      date: new Date(transaction.timestamp),
    }
  );
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
    note: `${timestampLabel(transaction.timestamp)} · ${transaction.payment_method}`,
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

/* Modal layer sits above the app and is only rendered when state asks for it. */
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

/* ------------------------------------------------------------------ */
/* Rendering                                                           */
/* ------------------------------------------------------------------ */

interface ListWindow {
  start: number;
  end: number;
  hasAbove: boolean;
  hasBelow: boolean;
}

/** Keep the selection visible while preserving room for overflow hints. */
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
  if (inputMode) {
    const query = searchQuery ? `${searchQuery}▌` : "type a product name or scan a barcode…▌";
    return clip(`› ${query}`, width);
  }
  if (searchQuery) return clip(`› ${searchQuery}   [/ ] edit · [Esc] clear`, width);
  return clip("› press / to search or scan   ·   hotkeys are active", width);
}

function catalogTitle(items: Product[]): string {
  if (currentView === "POS") return ` PRODUCT CATALOGUE (${items.length}) `;
  if (currentView === "INVENTORY") return ` INVENTORY (${products.length}) `;
  return ` SALES HISTORY (${history.length}) `;
}

function catalogBottomTitle(): string {
  if (currentView === "POS") {
    return inputMode ? " Enter add match · ↑↓ pick · Esc hotkeys " : " ↑↓ select · Enter add · 1-9 quick add · Tab " ;
  }
  if (currentView === "INVENTORY") return " A add · Enter edit · Del delete · ↑↓ select ";
  return " ↑↓ select · Enter receipt · R reprint · F3 refresh ";
}

function cartTitle(): string {
  if (currentView === "POS") {
    return ` ACTIVE CART · ${cart.length} line${cart.length === 1 ? "" : "s"} · ${discountPercent}% off `;
  }
  if (currentView === "INVENTORY") return productForm ? " PRODUCT EDITOR " : " PRODUCT DETAILS ";
  return history[historyIndex] ? ` TRANSACTION #${history[historyIndex]!.id} ` : " TRANSACTION DETAILS ";
}

function cartBottomTitle(): string {
  if (currentView === "POS") {
    return focus === "CART"
      ? " +/- qty · Del remove · Ctrl+Del clear · F10 checkout "
      : " F10 / Space checkout · D discount ";
  }
  if (currentView === "INVENTORY") {
    return productForm ? " Tab next · Enter save · Esc cancel " : " Enter edit · A add · Del delete ";
  }
  return " Enter view receipt · R reprint ";
}

function renderProductCatalog(width: number, rows: number): string[] {
  const items = filteredProducts();
  const lines: string[] = [];

  if (items.length === 0) {
    lines.push(clip("  No products match the current search.", width));
    lines.push(clip("  Press Esc to leave search, then / to try again.", width));
    return lines;
  }

  const win = listWindow(items.length, catalogIndex, rows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));

  const active = focus === "CATALOG" || focus === "SEARCH";
  const nameWidth = Math.max(8, width - 21);

  for (let index = win.start; index < win.end; index += 1) {
    const product = items[index]!;
    const marker = active && index === catalogIndex ? "▸" : " ";
    const lowStock = product.stock <= 5 ? "!" : " ";
    const line =
      `${marker}${padColumn(String(index + 1), 2, "right")} ` +
      `${padColumn(product.name, nameWidth)} ` +
      `${padColumn(money(product.price), 7, "right")} ` +
      `${padColumn(String(product.stock), 4, "right")}${lowStock}`;
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
    lines.push(clip("  F10 checkout when ready.", width));
    return lines;
  }

  const subtotal = cartSubtotal();
  const discount = cartDiscount();
  const total = cartTotal();
  const summaryRows = discountPercent > 0 ? 4 : 3;
  const itemRows = Math.max(2, rows - summaryRows);
  const win = listWindow(cart.length, cartIndex, itemRows);

  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));

  for (let index = win.start; index < win.end; index += 1) {
    const item = cart[index]!;
    const marker = focus === "CART" && index === cartIndex ? "▸" : " ";
    const qty = `${item.qty}×`;
    const totalWidth = 9;
    const nameWidth = Math.max(6, width - 16);
    const line =
      `${marker} ${padColumn(qty, 4)}${padColumn(item.name, nameWidth)} ` +
      `${padColumn(money(item.price * item.qty), totalWidth, "right")}`;
    lines.push(clip(line, width));
  }

  if (win.hasBelow) lines.push(overflowLine("down", cart.length - win.end, width));

  lines.push(clip("─".repeat(width), width));
  lines.push(twoColumn("Subtotal", money(subtotal), width));
  if (discountPercent > 0) {
    lines.push(twoColumn(`Discount ${discountPercent}%`, `-${money(discount)}`, width));
  }
  lines.push(twoColumn("TOTAL", money(total), width));

  return lines;
}

function renderInventory(width: number, rows: number): string[] {
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
    const line =
      `${marker}${padColumn(`#${product.id}`, 4)} ` +
      `${padColumn(product.name, nameWidth)} ` +
      `${padColumn(money(product.price), 7, "right")} ` +
      `${padColumn(String(product.stock), 4, "right")}`;
    lines.push(clip(line, width));
  }

  if (win.hasBelow) lines.push(overflowLine("down", products.length - win.end, width));
  return lines;
}

function renderInventoryDetails(width: number, rows: number): string[] {
  const form = productForm;
  if (form) {
    const lines: string[] = [];
    lines.push(clip(` ${form.mode === "new" ? "NEW PRODUCT" : `EDITING #${form.id}`}`, width));
    lines.push(clip("─".repeat(width), width));

    FORM_FIELDS.forEach((label, index) => {
      const marker = index === form.field ? "▸" : " ";
      const value = formValue(form, index);
      const cursor = index === form.field ? "▌" : "";
      lines.push(clip(`${marker} ${padColumn(label, 8)}: ${value}${cursor}`, width));
    });

    lines.push("");
    lines.push(clip(" Tab / ↑↓  move between fields", width));
    lines.push(clip(" Enter    save product", width));
    lines.push(clip(" Esc      cancel without saving", width));
    return lines;
  }

  const product = products[inventoryIndex];
  if (!product) {
    return [
      clip(" No product selected.", width),
      clip(" Press A to add a product.", width),
    ];
  }

  const lines = [
    clip(` ${product.name}`, width),
    clip("─".repeat(width), width),
    clip(` ID        ${product.id}`, width),
    clip(` Barcode   ${product.barcode}`, width),
    clip(` Price     ${money(product.price)}`, width),
    clip(` Stock     ${product.stock}${product.stock <= 5 ? "  (low)" : ""}`, width),
    "",
    clip(" Enter / E  edit this product", width),
    clip(" A          add a new product", width),
    clip(" Del / X    delete this product", width),
  ];

  return lines.slice(0, Math.max(1, rows));
}

function renderHistoryList(width: number, rows: number): string[] {
  const lines: string[] = [];
  if (history.length === 0) {
    lines.push(clip("  No sales yet.", width));
    lines.push(clip("  Complete a sale from the POS view and it will appear here.", width));
    return lines;
  }

  const win = listWindow(history.length, historyIndex, rows);
  if (win.hasAbove) lines.push(overflowLine("up", win.start, width));

  const dateWidth = 17;
  const totalWidth = 9;
  for (let index = win.start; index < win.end; index += 1) {
    const transaction = history[index]!;
    const marker = index === historyIndex ? "▸" : " ";
    const id = padColumn(`#${transaction.id}`, 5);
    const date = padColumn(timestampLabel(transaction.timestamp), dateWidth);
    const total = padColumn(money(transaction.total_amount), totalWidth, "right");
    lines.push(clip(`${marker}${id} ${date}${total}`, width));
  }

  if (win.hasBelow) lines.push(overflowLine("down", history.length - win.end, width));
  return lines;
}

function renderHistoryDetails(width: number, rows: number): string[] {
  const transaction = history[historyIndex];
  if (!transaction) {
    return [clip(" No transaction selected.", width)];
  }

  const items = getTransactionItems(transaction);
  const lines: string[] = [
    clip(` ${timestampLabel(transaction.timestamp)} · ${transaction.payment_method}`, width),
    clip("─".repeat(width), width),
  ];

  const summaryRows = 4;
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
  lines.push(twoColumn("TOTAL", money(transaction.total_amount), width));

  return lines;
}

function keysHint(): string {
  if (modal) return " [Esc] close ";
  if (productForm) return " TYPE field · Tab next · Enter save · Esc cancel · Ctrl+S save ";
  if (currentView === "POS") {
    if (focus === "SEARCH") {
      return " TYPE search · Enter add · ↑↓ pick · Esc hotkeys · Tab focus · F10 checkout ";
    }
    if (focus === "CART") {
      return " ↑↓ item · +/- qty · Del remove · ^Del clear · F10 checkout · Q quit ";
    }
    return " ↑↓ select · Enter add · 1-9 quick · / search · F10 checkout · D discount · Q ";
  }
  if (currentView === "INVENTORY") {
    return " F1 POS · F2 inv · F3 history · A add · Enter edit · Del delete · F5 theme · Q ";
  }
  return " F1 POS · F2 inv · F3 history · Enter receipt · R reprint · F5 theme · Q ";
}

function helpLines(): string[] {
  return [
    "RETRO POS — KEYBOARD GUIDE",
    "──────────────────────────────────────────",
    "",
    "GLOBAL",
    "  F1   Point of sale",
    "  F2   Inventory management",
    "  F3   Sales history",
    "  F4   This help screen",
    "  F5   Cycle theme (Amber → Dracula → Catppuccin)",
    "  Q    Quit (only when search is not focused)",
    "  ^C   Quit immediately",
    "",
    "SEARCH / BARCODE",
    "  / or S   Focus the search bar",
    "  Enter    Add the selected match (exact barcode wins)",
    "  ↑ / ↓    Choose among matches",
    "  Esc      Leave search; unlock single-key hotkeys",
    "",
    "CART",
    "  Tab      Move focus between search, catalogue, cart",
    "  ↑ / ↓    Select a cart line",
    "  + / -    Increase or decrease quantity",
    "  Del      Remove the selected line",
    "  ^Del     Clear the whole cart (confirmation)",
    "  D        Cycle discount 0 → 5 → 10 → 15 → 20%",
    "  F10      Checkout  (Space also works in NAV mode)",
    "",
    "INVENTORY",
    "  A        Add product       Enter / E  Edit product",
    "  Del / X  Delete product    Tab        Next form field",
    "  Enter    Save form         Esc        Cancel form",
    "",
    "HISTORY",
    "  ↑ / ↓    Select transaction",
    "  Enter    View the stored receipt",
    "  R        Reprint the receipt to the console",
    "",
    "Receipts are appended to receipts.log after every sale.",
  ];
}

function renderModal(): void {
  if (!modal) {
    modalLayer.visible = false;
    return;
  }

  modalLayer.visible = true;
  const theme = activeTheme;
  const isConfirm = modal.kind === "confirm";
  const modalWidth = Math.max(24, Math.min(isConfirm ? 62 : 70, renderer.width - 4));
  const modalHeight = Math.max(8, Math.min(isConfirm ? 9 : 38, renderer.height - 4));

  modalBox.width = modalWidth;
  modalBox.height = modalHeight;
  modalBox.left = Math.max(0, Math.floor((renderer.width - modalWidth) / 2));
  modalBox.top = Math.max(0, Math.floor((renderer.height - modalHeight) / 2));
  modalBox.backgroundColor = theme.surface;
  modalBox.borderColor = isConfirm ? theme.warning : theme.primary;
  modalBox.titleColor = isConfirm ? theme.warning : theme.primary;
  modalBox.bottomTitle = "";
  modalBody.width = Math.max(10, modalWidth - 4);
  modalHint.width = Math.max(10, modalWidth - 4);
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

  const lines = modal.kind === "help" ? helpLines() : receiptLines(modal.receipt);
  const visibleRows = Math.max(2, modalHeight - 3);
  const maxScroll = Math.max(0, lines.length - visibleRows);
  modalScroll = clamp(modalScroll, 0, maxScroll);
  const visible = lines.slice(modalScroll, modalScroll + visibleRows);

  modalBody.height = visibleRows;
  modalBody.content = visible.join("\n");

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

function updateUI(): void {
  activeTheme = getTheme();
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
  const headerRightWidth = Math.max(8, Math.floor(headerInner * 0.42));

  app.backgroundColor = activeTheme.background;

  header.backgroundColor = activeTheme.primary;
  header.borderColor = activeTheme.primary;
  headerTitle.fg = activeTheme.background;
  headerTitle.width = headerInner;

  const viewLabel =
    currentView === "POS" ? "POINT OF SALE" : currentView === "INVENTORY" ? "INVENTORY" : "SALES HISTORY";
  const modeLabel = productForm ? "EDIT" : inputMode ? "INSERT" : "NAV";
  let headerRight = `${modeLabel} · ${activeTheme.name}`;
  const todayLabel = `Today ${todayStats.count}/${money(todayStats.revenue)}`;
  if (todayLabel.length + headerRight.length + 3 <= headerRightWidth) {
    headerRight += ` · ${todayLabel}`;
  }
  headerTitle.content = twoColumn(
    `☕ RETRO POS  ·  ${viewLabel}`,
    `${headerRight} `,
    headerInner
  );

  searchBox.backgroundColor = activeTheme.surface;
  searchBox.borderColor = inputMode ? activeTheme.primary : activeTheme.border;
  searchBox.title = " SEARCH / SCAN ";
  searchBox.titleColor = inputMode ? activeTheme.primary : activeTheme.secondary;
  searchBox.bottomTitle = inputMode ? " input mode · Esc releases hotkeys " : " nav mode · / to search ";
  searchText.fg = inputMode ? activeTheme.text : activeTheme.muted;
  searchText.content = searchLine(Math.max(10, innerWidth - 6));
  searchText.width = Math.max(10, innerWidth - 6);

  bodyBox.height = bodyHeight;
  bodyBox.width = bodyWidth;
  catalogBox.width = catalogWidth;
  cartBox.width = cartWidth;

  const catalogFocused =
    (currentView === "POS" && (focus === "CATALOG" || focus === "SEARCH")) ||
    (currentView === "INVENTORY" && focus === "INVENTORY") ||
    (currentView === "HISTORY" && focus === "HISTORY");
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
    leftLines = renderInventory(catalogInner, contentRows);
    rightLines = renderInventoryDetails(cartInner, contentRows);
  } else {
    leftLines = renderHistoryList(catalogInner, contentRows);
    rightLines = renderHistoryDetails(cartInner, contentRows);
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

function isPlusKey(key: KeyEvent): boolean {
  return key.sequence === "+" || key.name === "+" || key.name === "plus";
}

function isMinusKey(key: KeyEvent): boolean {
  return key.sequence === "-" || key.name === "-" || key.name === "minus";
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
      const action = modal.action;
      const productId = modal.productId;
      modal = null;
      modalScroll = 0;
      if (action === "clear-cart") {
        cart = [];
        cartIndex = 0;
        setStatus("Cart cleared.", "warning");
      } else if (action === "delete-product" && productId !== undefined) {
        deleteConfirmedProduct(productId);
      }
      updateUI();
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
    setFormValue(form, form.field, formValue(form, form.field).slice(0, -1));
    updateUI();
    return;
  }

  if (key.ctrl && key.name === "s") {
    saveProductForm();
    return;
  }

  if (!isPrintable(key)) return;

  const character = key.sequence;
  const field = form.field;
  if (field === 2 && !/[0-9.]/.test(character)) return;
  if (field === 3 && !/[0-9]/.test(character)) return;

  setFormValue(form, field, `${formValue(form, field)}${character}`);
  updateUI();
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
    updateUI();
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

function handleNavigationKey(key: KeyEvent): void {
  if (key.name === "q") {
    renderer.destroy();
    process.exit(0);
  }

  if (key.name === "/" || key.name === "s") {
    if (currentView === "POS") {
      setFocus("SEARCH");
      updateUI();
    }
    return;
  }

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
      setStatus("Hotkeys active — press / to search, Tab to move focus.", "info");
      updateUI();
    }
    return;
  }

  if (key.name === "right" || key.name === "left") {
    if (currentView === "POS") {
      setFocus(key.name === "right" ? "CART" : "CATALOG");
    } else {
      setFocus(currentView === "INVENTORY" ? "INVENTORY" : "HISTORY");
    }
    updateUI();
    return;
  }

  if (key.name === "up" || key.name === "down") {
    const delta = key.name === "up" ? -1 : 1;
    if (currentView === "POS" && focus === "CART") {
      cartIndex = clamp(cartIndex + delta, 0, Math.max(0, cart.length - 1));
    } else if (currentView === "POS") {
      const items = filteredProducts();
      catalogIndex = clamp(catalogIndex + delta, 0, Math.max(0, items.length - 1));
    } else if (currentView === "INVENTORY") {
      inventoryIndex = clamp(inventoryIndex + delta, 0, Math.max(0, products.length - 1));
    } else {
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
    } else if (currentView === "INVENTORY") {
      inventoryIndex = clamp(inventoryIndex + delta, 0, Math.max(0, products.length - 1));
    } else {
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
    } else if (currentView === "INVENTORY") {
      inventoryIndex = clamp(value, 0, Math.max(0, products.length - 1));
    } else {
      historyIndex = clamp(value, 0, Math.max(0, history.length - 1));
    }
    updateUI();
    return;
  }

  if (currentView === "POS") {
    if (key.name === "d") {
      const current = DISCOUNTS.indexOf(discountPercent);
      discountPercent = DISCOUNTS[(current + 1) % DISCOUNTS.length] ?? 0;
      setStatus(`Discount set to ${discountPercent}%.`, "info");
      updateUI();
      return;
    }

    if (key.name === "f10" || key.name === "space") {
      checkout();
      return;
    }

    if (focus === "CART") {
      if (isPlusKey(key) || key.name === "=") {
        changeCartQuantity(1);
        updateUI();
        return;
      }
      if (isMinusKey(key)) {
        changeCartQuantity(-1);
        updateUI();
        return;
      }
      if (key.name === "delete" || key.name === "backspace") {
        if (key.ctrl || key.shift) {
          openClearCartConfirm();
          updateUI();
        } else {
          removeSelectedCartItem();
          updateUI();
        }
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
        if (product) {
          addToCart(product);
          updateUI();
        }
        return;
      }

      if (key.name === "=" || isPlusKey(key)) {
        const product = filteredProducts()[catalogIndex];
        if (product) {
          addToCart(product);
          updateUI();
        }
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

  if (currentView === "INVENTORY") {
    if (key.name === "a") {
      openProductForm("new");
      return;
    }
    if (key.name === "return" || key.name === "e") {
      openProductForm("edit");
      return;
    }
    if (key.name === "delete" || key.name === "x") {
      openDeleteConfirm();
      updateUI();
      return;
    }
    return;
  }

  // HISTORY
  if (key.name === "return") {
    openHistoryReceipt();
    return;
  }
  if (key.name === "r") {
    reprintHistoryReceipt();
  }
}

renderer.keyInput.on("keypress", (key) => {
  if (key.ctrl && key.name === "c") {
    renderer.destroy();
    process.exit(0);
  }

  // Function keys never collide with text entry, so they stay global.
  if (key.name === "f1") {
    switchView("POS");
    return;
  }
  if (key.name === "f2") {
    switchView("INVENTORY");
    return;
  }
  if (key.name === "f3") {
    switchView("HISTORY");
    return;
  }
  if (key.name === "f4") {
    openHelp();
    return;
  }
  if (key.name === "f5") {
    activeTheme = cycleTheme();
    setStatus(`Theme changed to ${activeTheme.name}.`, "success");
    updateUI();
    return;
  }

  if (modal) {
    handleModalKey(key);
    return;
  }

  if (key.name === "f10") {
    if (currentView === "POS") checkout();
    return;
  }

  if (productForm) {
    handleProductFormKey(key);
    return;
  }

  if (inputMode) {
    handleSearchKey(key);
    return;
  }

  handleNavigationKey(key);
});

renderer.on("resize", () => {
  updateUI();
});

updateUI();
