import { BoxRenderable, TextRenderable, createCliRenderer } from "@opentui/core";
import { initDb, getProducts, searchProducts, addProduct, deleteProduct, recordTransaction } from "./db/database";
import { getTheme, cycleTheme } from "./themes/themes";
import { generateReceiptText } from "./utils/printer";

initDb();
let products = getProducts() as any[];
let cart: { id: number; name: string; price: number; qty: number; barcode: string }[] = [];
let activeTheme = getTheme();

let searchQuery = "";
let discountPercent = 0;
let currentView: "POS" | "INVENTORY" = "POS";

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  backgroundColor: activeTheme.background,
});

// --- UI LAYOUT NODES ---
const mainPanel = new BoxRenderable(renderer, {
  width: "100%",
  height: "100%",
  backgroundColor: activeTheme.background,
  flexDirection: "column",
  padding: 1,
  gap: 1,
});

// Header
const titleBar = new BoxRenderable(renderer, {
  width: "100%",
  height: 3,
  borderStyle: "single",
  borderColor: activeTheme.primary,
  paddingX: 2,
  justifyContent: "space-between",
  alignItems: "center",
});
const titleText = new TextRenderable(renderer, { content: "", fg: activeTheme.primary });
const subtitleText = new TextRenderable(renderer, { content: "", fg: activeTheme.muted });
titleBar.add(titleText);
titleBar.add(subtitleText);
mainPanel.add(titleBar);

// Search Bar Box
const searchBarBox = new BoxRenderable(renderer, {
  width: "100%",
  height: 3,
  borderStyle: "single",
  borderColor: activeTheme.secondary,
  paddingX: 1,
  alignItems: "center",
});
const searchTextNode = new TextRenderable(renderer, { content: "", fg: activeTheme.text });
searchBarBox.add(searchTextNode);
mainPanel.add(searchBarBox);

// Split Body
const bodyBox = new BoxRenderable(renderer, {
  width: "100%",
  height: 12,
  flexDirection: "row",
  gap: 1,
});

// Catalog Box
const catalogBox = new BoxRenderable(renderer, {
  width: "60%",
  height: "100%",
  borderStyle: "single",
  borderColor: activeTheme.secondary,
  padding: 1,
  flexDirection: "column",
  gap: 1,
});
const catalogHeader = new TextRenderable(renderer, { content: "", fg: activeTheme.secondary });
catalogBox.add(catalogHeader);

const catalogTextNode = new TextRenderable(renderer, { content: "", fg: activeTheme.text });
catalogBox.add(catalogTextNode);
bodyBox.add(catalogBox);

// Cart Box
const cartBox = new BoxRenderable(renderer, {
  width: "40%",
  height: "100%",
  borderStyle: "single",
  borderColor: activeTheme.accent,
  padding: 1,
  flexDirection: "column",
  gap: 1,
});
const cartHeader = new TextRenderable(renderer, { content: "", fg: activeTheme.accent });
const cartBodyNode = new TextRenderable(renderer, { content: "", fg: activeTheme.text });
cartBox.add(cartHeader);
cartBox.add(cartBodyNode);
bodyBox.add(cartBox);

mainPanel.add(bodyBox);

// Footer
const footerBar = new BoxRenderable(renderer, {
  width: "100%",
  height: 3,
  borderStyle: "single",
  borderColor: activeTheme.muted,
  paddingX: 1,
  alignItems: "center",
});
const footerTextNode = new TextRenderable(renderer, { content: "", fg: activeTheme.muted });
footerBar.add(footerTextNode);
mainPanel.add(footerBar);

renderer.root.add(mainPanel);

// --- UPDATE UI FUNCTION ---
function updateUI() {
  activeTheme = getTheme();

  titleText.content = `☕ RETRO POS — Mode: [${currentView}] | Theme: [${activeTheme.name}]`;
  titleText.fg = activeTheme.primary;
  titleBar.borderColor = activeTheme.primary;
  subtitleText.content = "F1: POS View | F2: Inventory View | F5: Theme";

  searchTextNode.content = `🔍 Search / Scan Barcode: > ${searchQuery}_`;
  searchBarBox.borderColor = activeTheme.secondary;

  // Filter Catalog
  const filteredProducts = searchQuery ? (searchProducts(searchQuery) as any[]) : products;

  if (currentView === "POS") {
    catalogHeader.content = `📦 Product Catalog (${filteredProducts.length} items):`;
    catalogHeader.fg = activeTheme.secondary;
    catalogBox.borderColor = activeTheme.secondary;

    const lines = filteredProducts.map(
      (p, i) => ` [${i + 1}] ${p.name} — $${p.price.toFixed(2)} | Stock: ${p.stock} | Barcode: ${p.barcode}`
    );
    catalogTextNode.content = lines.length > 0 ? lines.join("\n") : " No matching products found.";

    // Active Cart Update
    cartHeader.content = `🛒 Active Cart (Discount: ${discountPercent}%):`;
    cartHeader.fg = activeTheme.accent;
    cartBox.borderColor = activeTheme.accent;

    if (cart.length === 0) {
      cartBodyNode.content = " Cart is empty.\n Type name or barcode to add.";
    } else {
      const cartLines = cart.map((item) => ` • ${item.name} x${item.qty} = $${(item.price * item.qty).toFixed(2)}`);
      const subtotal = cart.reduce((sum, i) => sum + i.price * i.qty, 0);
      const total = subtotal * (1 - discountPercent / 100);

      cartLines.push("----------------------------------");
      cartLines.push(` Subtotal:  $${subtotal.toFixed(2)}`);
      if (discountPercent > 0) cartLines.push(` Discount: -$${(subtotal - total).toFixed(2)} (${discountPercent}%)`);
      cartLines.push(` TOTAL:    $${total.toFixed(2)}`);

      cartBodyNode.content = cartLines.join("\n");
    }

    footerTextNode.content = "[Type/Scan] Filter | [Enter] Select First | [1-9] Quick Add | [D] Discount | [C] Checkout | [Q] Quit";
  } else {
    // Inventory CRUD View
    catalogHeader.content = "🔧 Inventory Management (CRUD Mode):";
    catalogHeader.fg = activeTheme.primary;

    const invLines = products.map((p) => ` ID #${p.id} | ${p.name.padEnd(16)} | $${p.price.toFixed(2)} | Stock: ${p.stock}`);
    catalogTextNode.content = invLines.join("\n");

    cartHeader.content = "⚡ CRUD Quick Actions:";
    cartBodyNode.content = " [A] Add Quick Product\n [DEL] Delete Product by ID\n [Esc] Return to POS";

    footerTextNode.content = "[A] Add Item | [DEL] Delete Item | [F1] Return to POS View | [Q] Quit";
  }
}

updateUI();

// --- KEYBOARD & BARCODE SCANNER LISTENER ---
renderer.keyInput.on("keypress", (key) => {
  if (key.name === "q" || (key.ctrl && key.name === "c")) {
    renderer.destroy();
    process.exit(0);
  }

  // Switch Views
  if (key.name === "f1") {
    currentView = "POS";
    updateUI();
    return;
  }
  if (key.name === "f2") {
    currentView = "INVENTORY";
    updateUI();
    return;
  }
  if (key.name === "f5") {
    cycleTheme();
    updateUI();
    return;
  }

  // Discount Hotkey
  if (key.name === "d" && currentView === "POS") {
    discountPercent = discountPercent === 0 ? 10 : discountPercent === 10 ? 20 : 0;
    updateUI();
    return;
  }

  // Add Item in Inventory Mode
  if (key.name === "a" && currentView === "INVENTORY") {
    const randomBarcode = `890${Math.floor(1000 + Math.random() * 9000)}`;
    addProduct(`New Item #${products.length + 1}`, randomBarcode, 4.99, 50);
    products = getProducts() as any[];
    updateUI();
    return;
  }

  // Handle Search Input & Barcode Scanning
  if (key.name === "backspace") {
    searchQuery = searchQuery.slice(0, -1);
    updateUI();
    return;
  }

  if (key.name === "return") {
    if (searchQuery.trim().length > 0) {
      const matches = searchProducts(searchQuery) as any[];
      if (matches.length > 0) {
        const item = matches[0];
        const existing = cart.find((i) => i.id === item.id);
        if (existing) existing.qty += 1;
        else cart.push({ id: item.id, name: item.name, price: item.price, qty: 1, barcode: item.barcode });
      }
      searchQuery = "";
      updateUI();
    }
    return;
  }

  // Number keys quick add in POS Mode
  const num = parseInt(key.name || "");
  if (!isNaN(num) && num >= 1 && num <= 9 && currentView === "POS") {
    const filtered = searchQuery ? (searchProducts(searchQuery) as any[]) : products;
    if (num <= filtered.length) {
      const selected = filtered[num - 1];
      const existing = cart.find((i) => i.id === selected.id);
      if (existing) existing.qty += 1;
      else cart.push({ id: selected.id, name: selected.name, price: selected.price, qty: 1, barcode: selected.barcode });
      updateUI();
      return;
    }
  }

  // Standard character typing for search bar
  if (key.sequence && key.sequence.length === 1 && key.sequence >= " ") {
    searchQuery += key.sequence;
    updateUI();
    return;
  }

  // Complete Checkout
  if (key.name === "c" && currentView === "POS") {
    if (cart.length === 0) return;
    const subtotal = cart.reduce((acc, item) => acc + item.price * item.qty, 0);
    const total = subtotal * (1 - discountPercent / 100);

    recordTransaction(subtotal, discountPercent, total, "Cash", cart);
    const receipt = generateReceiptText(cart, subtotal, discountPercent, total, "Cash");

    renderer.destroy();
    console.log("\n==================================================");
    console.log("    TRANSACTION COMPLETE — PRINTING RECEIPT       ");
    console.log("==================================================\n");
    console.log(receipt);
    process.exit(0);
  }
});