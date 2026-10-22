import { Database } from "bun:sqlite";
import { existsSync, readFileSync, writeFileSync } from "node:fs";

/**
 * Data layer for RetroPOS.
 *
 * Everything that touches SQLite lives here so the screens only deal with
 * plain objects. `bun:sqlite` is synchronous, which keeps checkout atomic and
 * makes a local terminal feel instant.
 */

export type StoreType = "cafe" | "retail";
export type UserRole = "Admin" | "Manager" | "Cashier";

export interface Product {
  id: number;
  name: string;
  barcode: string;
  price: number;
  stock: number;
  category_id: number | null;
}

export interface CartItem {
  id: number;
  name: string;
  price: number;
  qty: number;
  barcode: string;
}

export interface TransactionRecord {
  id: number;
  timestamp: string;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  tax_rate: number;
  total_amount: number;
  payment_method: string;
  cashier_id: number | null;
  cashier_name: string;
  amount_tendered: number;
  change_due: number;
  items_json: string;
  till_session_id: number | null;
}

export interface TillSession {
  id: number;
  opened_at: string;
  opened_by: string;
  opening_float: number;
  closed_at: string | null;
  closed_by: string | null;
  closing_count: number | null;
  notes: string;
}

export interface TillMovement {
  id: number;
  session_id: number;
  kind: "in" | "out";
  amount: number;
  reason: string;
  created_at: string;
  created_by: string;
}

export interface TillReport {
  session: TillSession;
  salesCount: number;
  grossSales: number;
  cashSales: number;
  cardSales: number;
  otherSales: number;
  movementsIn: number;
  movementsOut: number;
  expectedCash: number;
  countedCash: number | null;
  variance: number | null;
}

export interface TransactionStats {
  count: number;
  revenue: number;
}

export interface StoreConfig {
  id: number;
  name: string;
  address: string;
  store_type: StoreType;
  currency: string;
  tax_rate: number;
}

export interface StoreConfigInput {
  name: string;
  address: string;
  storeType: StoreType;
  currency: string;
  taxRate: number;
}

export interface UserRecord {
  id: number;
  username: string;
  pin_hash: string;
  role: UserRole;
  created_at: string;
}

export interface Ingredient {
  id: number;
  name: string;
  unit: string;
  stock: number;
  low_stock: number;
}

export interface IngredientInput {
  name: string;
  unit: string;
  stock: number;
  lowStock: number;
}

export interface RecipeLine {
  ingredient_id: number;
  name: string;
  unit: string;
  quantity: number;
  stock: number;
}

export interface RecipeInput {
  ingredientId: number;
  quantity: number;
}

export interface SaleInput {
  subtotal: number;
  discountAmount: number;
  taxAmount: number;
  taxRate: number;
  total: number;
  method: string;
  items: CartItem[];
  cashierId: number | null;
  cashierName: string;
  amountTendered: number;
  changeDue: number;
  tillSessionId?: number | null;
  allowNegative?: boolean;
}

export interface PaymentBreakdown {
  method: string;
  count: number;
  amount: number;
}

export interface TopProduct {
  name: string;
  qty: number;
  revenue: number;
}

export interface AnalyticsSnapshot {
  today: TransactionStats;
  week: TransactionStats;
  allTime: TransactionStats;
  methods: PaymentBreakdown[];
  topProducts: TopProduct[];
  lowStockProducts: Product[];
  lowStockIngredients: Ingredient[];
}

export interface ImportResult {
  inserted: number;
  updated: number;
  skipped: number;
  errors: string[];
}

export interface ProductInput {
  name: string;
  barcode: string;
  price: number;
  stock: number;
}

const db = new Database("retro_pos.db", { create: true });

db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const PRODUCT_COLUMNS = "id, name, barcode, price, stock, category_id";
const TRANSACTION_COLUMNS =
  "id, timestamp, subtotal, discount_amount, tax_amount, tax_rate, total_amount, " +
  "payment_method, cashier_id, cashier_name, amount_tendered, change_due, items_json, till_session_id";

/* ------------------------------------------------------------------ */
/* Schema                                                              */
/* ------------------------------------------------------------------ */

function migrateLegacyTransactions(): void {
  const columns = db.query("PRAGMA table_info(transactions)").all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  const additions: Array<[string, string]> = [
    ["subtotal", "REAL NOT NULL DEFAULT 0"],
    ["discount_amount", "REAL NOT NULL DEFAULT 0"],
    ["tax_amount", "REAL NOT NULL DEFAULT 0"],
    ["tax_rate", "REAL NOT NULL DEFAULT 0"],
    ["cashier_id", "INTEGER"],
    ["cashier_name", "TEXT NOT NULL DEFAULT 'Legacy'"],
    ["amount_tendered", "REAL NOT NULL DEFAULT 0"],
    ["change_due", "REAL NOT NULL DEFAULT 0"],
    ["till_session_id", "INTEGER"],
  ];

  for (const [name, definition] of additions) {
    if (!names.has(name)) db.exec(`ALTER TABLE transactions ADD COLUMN ${name} ${definition};`);
  }

  // Legacy rows only stored a total; make them printable and readable.
  db.exec("UPDATE transactions SET subtotal = total_amount WHERE subtotal = 0;");
  db.exec("UPDATE transactions SET amount_tendered = total_amount WHERE amount_tendered = 0;");
}

function migrateLegacyProducts(): void {
  const columns = db.query("PRAGMA table_info(products)").all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));
  if (!names.has("category_id")) db.exec("ALTER TABLE products ADD COLUMN category_id INTEGER;");
}

/** Create every table, index, and migration. No demo data is seeded here. */
export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL UNIQUE
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT NOT NULL UNIQUE,
      price REAL NOT NULL,
      stock INTEGER NOT NULL DEFAULT 0,
      category_id INTEGER,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      subtotal REAL NOT NULL DEFAULT 0,
      discount_amount REAL NOT NULL DEFAULT 0,
      tax_amount REAL NOT NULL DEFAULT 0,
      tax_rate REAL NOT NULL DEFAULT 0,
      total_amount REAL NOT NULL DEFAULT 0,
      payment_method TEXT NOT NULL DEFAULT 'Cash',
      cashier_id INTEGER,
      cashier_name TEXT NOT NULL DEFAULT 'Cashier',
      amount_tendered REAL NOT NULL DEFAULT 0,
      change_due REAL NOT NULL DEFAULT 0,
      items_json TEXT NOT NULL DEFAULT '[]'
    );

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      pin_hash TEXT NOT NULL,
      role TEXT NOT NULL CHECK (role IN ('Admin', 'Manager', 'Cashier')),
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS store_config (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      name TEXT NOT NULL,
      address TEXT NOT NULL DEFAULT '',
      store_type TEXT NOT NULL CHECK (store_type IN ('cafe', 'retail')),
      currency TEXT NOT NULL DEFAULT '$',
      tax_rate REAL NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS ingredients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL COLLATE NOCASE UNIQUE,
      unit TEXT NOT NULL,
      stock REAL NOT NULL DEFAULT 0,
      low_stock REAL NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS product_recipes (
      product_id INTEGER NOT NULL,
      ingredient_id INTEGER NOT NULL,
      quantity REAL NOT NULL,
      PRIMARY KEY (product_id, ingredient_id),
      FOREIGN KEY (product_id) REFERENCES products(id) ON DELETE CASCADE,
      FOREIGN KEY (ingredient_id) REFERENCES ingredients(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS till_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      opened_at TEXT NOT NULL,
      opened_by TEXT NOT NULL DEFAULT 'Cashier',
      opening_float REAL NOT NULL DEFAULT 0,
      closed_at TEXT,
      closed_by TEXT,
      closing_count REAL,
      notes TEXT NOT NULL DEFAULT ''
    );

    CREATE TABLE IF NOT EXISTS till_movements (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_id INTEGER NOT NULL,
      kind TEXT NOT NULL CHECK (kind IN ('in', 'out')),
      amount REAL NOT NULL,
      reason TEXT NOT NULL DEFAULT '',
      created_at TEXT NOT NULL,
      created_by TEXT NOT NULL DEFAULT 'Cashier',
      FOREIGN KEY (session_id) REFERENCES till_sessions(id) ON DELETE CASCADE
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_product_recipes_product ON product_recipes(product_id);
    CREATE INDEX IF NOT EXISTS idx_till_movements_session ON till_movements(session_id);
  `);

  migrateLegacyProducts();
  migrateLegacyTransactions();
}

/* ------------------------------------------------------------------ */
/* Store profile and settings                                          */
/* ------------------------------------------------------------------ */

export function getStoreConfig(): StoreConfig | null {
  return (
    (db
      .query("SELECT id, name, address, store_type, currency, tax_rate FROM store_config WHERE id = 1")
      .get() as StoreConfig | null) ?? null
  );
}

export function saveStoreConfig(input: StoreConfigInput): StoreConfig {
  const name = input.name.trim();
  const address = input.address.trim();
  const currency = input.currency.trim();
  if (!name) throw new Error("Store name is required.");
  if (!currency) throw new Error("Currency symbol is required.");
  if (input.storeType !== "cafe" && input.storeType !== "retail") throw new Error("Choose a valid store type.");
  if (!Number.isFinite(input.taxRate) || input.taxRate < 0 || input.taxRate > 100) {
    throw new Error("Tax rate must be between 0 and 100.");
  }

  const now = new Date().toISOString();
  db.query(
    `INSERT INTO store_config (id, name, address, store_type, currency, tax_rate, created_at, updated_at)
     VALUES (1, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       address = excluded.address,
       store_type = excluded.store_type,
       currency = excluded.currency,
       tax_rate = excluded.tax_rate,
       updated_at = excluded.updated_at`
  ).run(name, address, input.storeType, currency, input.taxRate, now, now);

  return getStoreConfig()!;
}

export function getSetting(key: string): string | null {
  const row = db.query("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | null;
  return row?.value ?? null;
}

export function setSetting(key: string, value: string): void {
  db.query(
    "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).run(key, value);
}

export function deleteSetting(key: string): void {
  db.query("DELETE FROM settings WHERE key = ?").run(key);
}

/* ------------------------------------------------------------------ */
/* Users                                                               */
/* ------------------------------------------------------------------ */

export function createUserRecord(username: string, pinHash: string, role: UserRole): number {
  const result = db
    .query("INSERT INTO users (username, pin_hash, role, created_at) VALUES (?, ?, ?, ?)")
    .run(username.trim(), pinHash, role, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function getUserRecordByUsername(username: string): UserRecord | null {
  return (
    (db
      .query("SELECT id, username, pin_hash, role, created_at FROM users WHERE username = ? COLLATE NOCASE")
      .get(username.trim()) as UserRecord | null) ?? null
  );
}

export function getUserRecordById(id: number): UserRecord | null {
  return (
    (db
      .query("SELECT id, username, pin_hash, role, created_at FROM users WHERE id = ?")
      .get(id) as UserRecord | null) ?? null
  );
}

export function listUserRecords(): UserRecord[] {
  return db
    .query("SELECT id, username, pin_hash, role, created_at FROM users ORDER BY username COLLATE NOCASE")
    .all() as UserRecord[];
}

export function countUsers(): number {
  return (db.query("SELECT COUNT(*) AS count FROM users").get() as { count: number }).count;
}

export function countAdmins(): number {
  return (db.query("SELECT COUNT(*) AS count FROM users WHERE role = 'Admin'").get() as { count: number }).count;
}

export function updateUserPinHash(id: number, pinHash: string): void {
  const result = db.query("UPDATE users SET pin_hash = ? WHERE id = ?").run(pinHash, id);
  if (result.changes === 0) throw new Error("User not found.");
}

export function deleteUserRecord(id: number): boolean {
  return db.query("DELETE FROM users WHERE id = ?").run(id).changes > 0;
}

/* ------------------------------------------------------------------ */
/* Products                                                            */
/* ------------------------------------------------------------------ */

export function getProducts(): Product[] {
  return db
    .query(`SELECT ${PRODUCT_COLUMNS} FROM products ORDER BY name COLLATE NOCASE`)
    .all() as Product[];
}

/** Match by product name or barcode (partial barcodes make scanning forgiving). */
export function searchProducts(query: string): Product[] {
  const term = query.trim();
  if (!term) return getProducts();

  const like = `%${term}%`;
  return db
    .query(
      `SELECT ${PRODUCT_COLUMNS}
       FROM products
       WHERE name LIKE ? OR barcode LIKE ?
       ORDER BY
         CASE WHEN barcode = ? THEN 0 WHEN barcode LIKE ? THEN 1 ELSE 2 END,
         name COLLATE NOCASE
       LIMIT 100`
    )
    .all(like, like, term, `${term}%`) as Product[];
}

export function getProductByBarcode(barcode: string): Product | null {
  return (
    (db
      .query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = ?`)
      .get(barcode.trim()) as Product | null) ?? null
  );
}

export function getProductById(id: number): Product | null {
  return (
    (db
      .query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`)
      .get(id) as Product | null) ?? null
  );
}

function assertProductInput(input: ProductInput): void {
  if (!input.name.trim()) throw new Error("Product name is required.");
  if (!input.barcode.trim()) throw new Error("Barcode is required.");
  if (!Number.isFinite(input.price) || input.price <= 0) throw new Error("Price must be greater than zero.");
  if (!Number.isInteger(input.stock) || input.stock < 0) throw new Error("Stock must be a whole number.");
}

export function addProduct(name: string, barcode: string, price: number, stock: number): number {
  const input: ProductInput = { name: name.trim(), barcode: barcode.trim(), price, stock };
  assertProductInput(input);

  try {
    const result = db
      .query("INSERT INTO products (name, barcode, price, stock, category_id) VALUES (?, ?, ?, ?, 1)")
      .run(input.name, input.barcode, input.price, input.stock);
    return Number(result.lastInsertRowid);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new Error(`Barcode "${input.barcode}" is already in use.`);
    throw error;
  }
}

export function updateProduct(id: number, name: string, barcode: string, price: number, stock: number): void {
  const input: ProductInput = { name: name.trim(), barcode: barcode.trim(), price, stock };
  assertProductInput(input);

  try {
    const result = db
      .query("UPDATE products SET name = ?, barcode = ?, price = ?, stock = ? WHERE id = ?")
      .run(input.name, input.barcode, input.price, input.stock, id);
    if (result.changes === 0) throw new Error(`Product #${id} no longer exists.`);
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Product #")) throw error;
    if (String(error).includes("UNIQUE")) throw new Error(`Barcode "${input.barcode}" is already in use.`);
    throw error;
  }
}

export function deleteProduct(id: number): boolean {
  return db.query("DELETE FROM products WHERE id = ?").run(id).changes > 0;
}

/* ------------------------------------------------------------------ */
/* Ingredients and recipes (cafe BOM)                                  */
/* ------------------------------------------------------------------ */

export function getIngredients(): Ingredient[] {
  return db
    .query("SELECT id, name, unit, stock, low_stock FROM ingredients ORDER BY name COLLATE NOCASE")
    .all() as Ingredient[];
}

export function getIngredientById(id: number): Ingredient | null {
  return (
    (db
      .query("SELECT id, name, unit, stock, low_stock FROM ingredients WHERE id = ?")
      .get(id) as Ingredient | null) ?? null
  );
}

function assertIngredientInput(input: IngredientInput): void {
  if (!input.name.trim()) throw new Error("Ingredient name is required.");
  if (!input.unit.trim()) throw new Error("Unit is required (ml, g, pumps, units).");
  if (!Number.isFinite(input.stock) || input.stock < 0) throw new Error("Stock cannot be negative.");
  if (!Number.isFinite(input.lowStock) || input.lowStock < 0) throw new Error("Low-stock level cannot be negative.");
}

export function addIngredient(input: IngredientInput): number {
  assertIngredientInput(input);
  try {
    const result = db
      .query("INSERT INTO ingredients (name, unit, stock, low_stock) VALUES (?, ?, ?, ?)")
      .run(input.name.trim(), input.unit.trim(), input.stock, input.lowStock);
    return Number(result.lastInsertRowid);
  } catch (error) {
    if (String(error).includes("UNIQUE")) throw new Error(`Ingredient "${input.name.trim()}" already exists.`);
    throw error;
  }
}

export function updateIngredient(id: number, input: IngredientInput): void {
  assertIngredientInput(input);
  try {
    const result = db
      .query("UPDATE ingredients SET name = ?, unit = ?, stock = ?, low_stock = ? WHERE id = ?")
      .run(input.name.trim(), input.unit.trim(), input.stock, input.lowStock, id);
    if (result.changes === 0) throw new Error("Ingredient not found.");
  } catch (error) {
    if (error instanceof Error && error.message === "Ingredient not found.") throw error;
    if (String(error).includes("UNIQUE")) throw new Error(`Ingredient "${input.name.trim()}" already exists.`);
    throw error;
  }
}

export function deleteIngredient(id: number): boolean {
  return db.query("DELETE FROM ingredients WHERE id = ?").run(id).changes > 0;
}

export function getRecipesForProduct(productId: number): RecipeLine[] {
  return db
    .query(
      `SELECT r.ingredient_id, i.name, i.unit, r.quantity, i.stock
       FROM product_recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.product_id = ?
       ORDER BY i.name COLLATE NOCASE`
    )
    .all(productId) as RecipeLine[];
}

/** Replace a product's entire BOM in one transaction. */
export function setProductRecipe(productId: number, rows: RecipeInput[]): void {
  const replace = db.transaction(() => {
    db.query("DELETE FROM product_recipes WHERE product_id = ?").run(productId);
    const insert = db.query("INSERT INTO product_recipes (product_id, ingredient_id, quantity) VALUES (?, ?, ?)");
    for (const row of rows) {
      if (row.quantity > 0) insert.run(productId, row.ingredientId, row.quantity);
    }
  });
  replace();
}

/**
 * Available sellable units for every product.
 * Cafe products with a recipe are limited by their rarest ingredient; retail
 * products and cafe items without a recipe use their own unit stock.
 */
export function getProductAvailability(storeType: StoreType): Map<number, number> {
  const result = new Map<number, number>();
  const products = getProducts();
  if (storeType !== "cafe") {
    for (const product of products) result.set(product.id, product.stock);
    return result;
  }

  const recipeAvailability = db
    .query(
      `SELECT r.product_id, MIN(CAST(i.stock / r.quantity AS INTEGER)) AS available
       FROM product_recipes r
       JOIN ingredients i ON i.id = r.ingredient_id
       WHERE r.quantity > 0
       GROUP BY r.product_id`
    )
    .all() as { product_id: number; available: number }[];
  const recipeMap = new Map(recipeAvailability.map((row) => [row.product_id, row.available]));

  for (const product of products) {
    result.set(product.id, recipeMap.get(product.id) ?? product.stock);
  }
  return result;
}

export function getLowStockIngredients(): Ingredient[] {
  return db
    .query("SELECT id, name, unit, stock, low_stock FROM ingredients WHERE stock <= low_stock ORDER BY stock ASC")
    .all() as Ingredient[];
}

export function getLowStockProducts(threshold = 5): Product[] {
  return db
    .query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE stock <= ? ORDER BY stock ASC, name COLLATE NOCASE`)
    .all(threshold) as Product[];
}

/* ------------------------------------------------------------------ */
/* Till sessions and cash drawer                                       */
/* ------------------------------------------------------------------ */

const TILL_SESSION_COLUMNS =
  "id, opened_at, opened_by, opening_float, closed_at, closed_by, closing_count, notes";

export function getOpenTillSession(): TillSession | null {
  return (
    (db
      .query(`SELECT ${TILL_SESSION_COLUMNS} FROM till_sessions WHERE closed_at IS NULL ORDER BY id DESC LIMIT 1`)
      .get() as TillSession | null) ?? null
  );
}

export function getTillSessionById(id: number): TillSession | null {
  return (
    (db.query(`SELECT ${TILL_SESSION_COLUMNS} FROM till_sessions WHERE id = ?`).get(id) as TillSession | null) ?? null
  );
}

export function getRecentTillSessions(limit = 50): TillSession[] {
  const safeLimit = Math.max(1, Math.min(200, Math.trunc(limit)));
  return db
    .query(`SELECT ${TILL_SESSION_COLUMNS} FROM till_sessions ORDER BY id DESC LIMIT ?`)
    .all(safeLimit) as TillSession[];
}

export function openTillSession(openingFloat: number, openedBy: string, notes = ""): number {
  if (!Number.isFinite(openingFloat) || openingFloat < 0) throw new Error("Opening float cannot be negative.");
  if (getOpenTillSession()) throw new Error("A till session is already open. Close it before opening a new one.");

  const result = db
    .query("INSERT INTO till_sessions (opened_at, opened_by, opening_float, notes) VALUES (?, ?, ?, ?)")
    .run(new Date().toISOString(), openedBy, openingFloat, notes.trim());
  return Number(result.lastInsertRowid);
}

export function closeTillSession(id: number, closingCount: number, closedBy: string, notes = ""): void {
  if (!Number.isFinite(closingCount)) throw new Error("Counted cash must be a number.");
  const session = getTillSessionById(id);
  if (!session) throw new Error("Till session not found.");
  if (session.closed_at) throw new Error("Till session is already closed.");

  const existingNotes = session.notes.trim();
  const mergedNotes = notes.trim() ? (existingNotes ? `${existingNotes} · ${notes.trim()}` : notes.trim()) : existingNotes;

  db.query(
    "UPDATE till_sessions SET closed_at = ?, closed_by = ?, closing_count = ?, notes = ? WHERE id = ?"
  ).run(new Date().toISOString(), closedBy, closingCount, mergedNotes, id);
}

export function addTillMovement(sessionId: number, kind: "in" | "out", amount: number, reason: string, createdBy: string): void {
  if (!Number.isFinite(amount) || amount <= 0) throw new Error("Amount must be greater than zero.");
  const session = getTillSessionById(sessionId);
  if (!session) throw new Error("Till session not found.");
  if (session.closed_at) throw new Error("Cannot add a cash movement to a closed till.");

  db.query(
    "INSERT INTO till_movements (session_id, kind, amount, reason, created_at, created_by) VALUES (?, ?, ?, ?, ?, ?)"
  ).run(sessionId, kind, amount, reason.trim(), new Date().toISOString(), createdBy);
}

export function getTillMovements(sessionId: number): TillMovement[] {
  return db
    .query(
      "SELECT id, session_id, kind, amount, reason, created_at, created_by FROM till_movements WHERE session_id = ? ORDER BY id"
    )
    .all(sessionId) as TillMovement[];
}

/** Aggregate a session into an X or Z report. Counted cash is null while open. */
export function getTillReport(sessionId: number): TillReport | null {
  const session = getTillSessionById(sessionId);
  if (!session) return null;

  const sales = db
    .query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS gross
       FROM transactions WHERE till_session_id = ?`
    )
    .get(sessionId) as { count: number; gross: number };

  const byMethod = db
    .query(
      `SELECT payment_method AS method, COALESCE(SUM(total_amount), 0) AS amount
       FROM transactions WHERE till_session_id = ? GROUP BY payment_method`
    )
    .all(sessionId) as { method: string; amount: number }[];

  const movements = db
    .query(
      `SELECT
         COALESCE(SUM(CASE WHEN kind = 'in' THEN amount ELSE 0 END), 0) AS total_in,
         COALESCE(SUM(CASE WHEN kind = 'out' THEN amount ELSE 0 END), 0) AS total_out
       FROM till_movements WHERE session_id = ?`
    )
    .get(sessionId) as { total_in: number; total_out: number };

  const amountFor = (name: string): number => byMethod.find((row) => row.method === name)?.amount ?? 0;
  const cashSales = amountFor("Cash");
  const cardSales = amountFor("Card");
  const otherSales = round2(sales.gross - cashSales - cardSales);
  const expectedCash = round2(session.opening_float + cashSales + movements.total_in - movements.total_out);
  const countedCash = session.closing_count;
  const variance = countedCash === null ? null : round2(countedCash - expectedCash);

  return {
    session,
    salesCount: sales.count,
    grossSales: round2(sales.gross),
    cashSales: round2(cashSales),
    cardSales: round2(cardSales),
    otherSales,
    movementsIn: round2(movements.total_in),
    movementsOut: round2(movements.total_out),
    expectedCash,
    countedCash,
    variance,
  };
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

function ingredientRequirements(items: CartItem[]): Map<number, { needed: number; name: string; unit: string; stock: number }> {
  const needs = new Map<number, { needed: number; name: string; unit: string; stock: number }>();
  for (const item of items) {
    const recipe = getRecipesForProduct(item.id);
    for (const line of recipe) {
      const existing = needs.get(line.ingredient_id);
      const required = line.quantity * item.qty;
      if (existing) {
        existing.needed += required;
      } else {
        needs.set(line.ingredient_id, {
          needed: required,
          name: line.name,
          unit: line.unit,
          stock: line.stock,
        });
      }
    }
  }
  return needs;
}

/** Validate a cart against live stock without changing anything. */
export function validateSale(items: CartItem[], storeType: StoreType, allowNegative = false): string | null {
  if (allowNegative) {
    for (const item of items) {
      if (!getProductById(item.id)) return `${item.name} no longer exists in the catalogue.`;
    }
    return null;
  }

  for (const item of items) {
    const product = getProductById(item.id);
    if (!product) return `${item.name} no longer exists in the catalogue.`;

    if (storeType === "cafe") {
      const recipe = getRecipesForProduct(item.id);
      if (recipe.length > 0) continue;
    }
    if (item.qty > product.stock) {
      return `Stock changed: only ${product.stock} × ${item.name} remain.`;
    }
  }

  if (storeType === "cafe") {
    for (const need of ingredientRequirements(items).values()) {
      if (need.needed > need.stock) {
        return `Not enough ${need.name}: need ${need.needed}${need.unit}, have ${need.stock}${need.unit}.`;
      }
    }
  }

  return null;
}

/**
 * Persist a completed sale and deduct stock atomically.
 * Cafe products with a recipe consume ingredients; everything else consumes
 * its own finished stock.
 */
export function recordTransaction(input: SaleInput): number {
  const config = getStoreConfig();
  const storeType: StoreType = config?.store_type ?? "retail";
  const timestamp = new Date().toISOString();

  const writeSale = db.transaction(() => {
    const stockError = validateSale(input.items, storeType, input.allowNegative ?? false);
    if (stockError) throw new Error(stockError);

    const result = db
      .query(
        `INSERT INTO transactions
         (timestamp, subtotal, discount_amount, tax_amount, tax_rate, total_amount, payment_method,
          cashier_id, cashier_name, amount_tendered, change_due, items_json, till_session_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        timestamp,
        input.subtotal,
        input.discountAmount,
        input.taxAmount,
        input.taxRate,
        input.total,
        input.method,
        input.cashierId,
        input.cashierName,
        input.amountTendered,
        input.changeDue,
        JSON.stringify(input.items),
        input.tillSessionId ?? null
      );

    const allowNegative = input.allowNegative ?? false;
    const deductProduct = db.query(
      allowNegative
        ? "UPDATE products SET stock = stock - ? WHERE id = ?"
        : "UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?"
    );
    const deductIngredient = db.query(
      allowNegative
        ? "UPDATE ingredients SET stock = stock - ? WHERE id = ?"
        : "UPDATE ingredients SET stock = MAX(0, stock - ?) WHERE id = ?"
    );

    if (storeType === "cafe") {
      for (const item of input.items) {
        const recipe = getRecipesForProduct(item.id);
        if (recipe.length > 0) {
          for (const line of recipe) deductIngredient.run(line.quantity * item.qty, line.ingredient_id);
        } else {
          deductProduct.run(item.qty, item.id);
        }
      }
    } else {
      for (const item of input.items) deductProduct.run(item.qty, item.id);
    }

    return Number(result.lastInsertRowid);
  });

  return writeSale();
}

/** Most recent sales first. History is intentionally capped for terminal speed. */
export function getRecentTransactions(limit = 100): TransactionRecord[] {  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  return db
    .query(
      `SELECT ${TRANSACTION_COLUMNS}
       FROM transactions
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(safeLimit) as TransactionRecord[];
}

export function getTransactionById(id: number): TransactionRecord | null {
  return (
    (db.query(`SELECT ${TRANSACTION_COLUMNS} FROM transactions WHERE id = ?`).get(id) as TransactionRecord | null) ??
    null
  );
}

export function getTransactionItems(transaction: TransactionRecord | null): CartItem[] {
  if (!transaction) return [];
  try {
    const parsed = JSON.parse(transaction.items_json) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed as CartItem[];
  } catch {
    return [];
  }
}

export function getTodayStats(): TransactionStats {
  const row = db
    .query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS revenue
       FROM transactions
       WHERE date(timestamp, 'localtime') = date('now', 'localtime')`
    )
    .get() as { count: number; revenue: number };
  return { count: row.count, revenue: row.revenue };
}

function periodStats(whereClause: string): TransactionStats {
  const row = db
    .query(
      `SELECT COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS revenue
       FROM transactions WHERE ${whereClause}`
    )
    .get() as { count: number; revenue: number };
  return { count: row.count, revenue: row.revenue };
}

export function getAnalytics(): AnalyticsSnapshot {
  const methods = db
    .query(
      `SELECT payment_method AS method, COUNT(*) AS count, COALESCE(SUM(total_amount), 0) AS amount
       FROM transactions
       GROUP BY payment_method
       ORDER BY amount DESC`
    )
    .all() as PaymentBreakdown[];

  const productTotals = new Map<string, TopProduct>();
  const rows = db.query("SELECT items_json FROM transactions").all() as { items_json: string }[];
  for (const row of rows) {
    let items: CartItem[] = [];
    try {
      const parsed = JSON.parse(row.items_json) as unknown;
      if (Array.isArray(parsed)) items = parsed as CartItem[];
    } catch {
      items = [];
    }
    for (const item of items) {
      const current = productTotals.get(item.name) ?? { name: item.name, qty: 0, revenue: 0 };
      current.qty += item.qty;
      current.revenue += item.price * item.qty;
      productTotals.set(item.name, current);
    }
  }

  return {
    today: getTodayStats(),
    week: periodStats("datetime(timestamp) >= datetime('now', '-7 days')"),
    allTime: periodStats("1 = 1"),
    methods,
    topProducts: [...productTotals.values()].sort((a, b) => b.qty - a.qty).slice(0, 10),
    lowStockProducts: getLowStockProducts(),
    lowStockIngredients: getLowStockIngredients(),
  };
}

/* ------------------------------------------------------------------ */
/* Import and export                                                   */
/* ------------------------------------------------------------------ */

function csvEscape(value: string): string {
  if (/[",\n\r]/.test(value)) return `"${value.replaceAll('"', '""')}"`;
  return value;
}

export function exportProductsCsv(path = "products_export.csv"): number {
  const products = getProducts();
  const lines = ["name,barcode,price,stock"];
  for (const product of products) {
    lines.push(
      [product.name, product.barcode, product.price.toFixed(2), String(product.stock)].map(csvEscape).join(",")
    );
  }
  writeFileSync(path, `${lines.join("\n")}\n`, "utf8");
  return products.length;
}

/** Parse RFC-4180-style CSV, including quoted commas, quotes, and newlines. */
function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!;
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        field += character;
      }
    } else if (character === '"') {
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field.replace(/\r$/, ""));
      rows.push(row);
      row = [];
      field = "";
    } else {
      field += character;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field.replace(/\r$/, ""));
    rows.push(row);
  }
  return rows.filter((entry) => entry.some((cell) => cell.trim() !== ""));
}

interface ImportRow {
  name?: unknown;
  barcode?: unknown;
  price?: unknown;
  stock?: unknown;
}

function normalizeImportRows(rows: ImportRow[]): ImportResult {
  const result: ImportResult = { inserted: 0, updated: 0, skipped: 0, errors: [] };

  for (const [index, row] of rows.entries()) {
    const name = String(row.name ?? "").trim();
    const barcode = String(row.barcode ?? "").trim();
    const price = Number.parseFloat(String(row.price ?? ""));
    const stock = Number.parseInt(String(row.stock ?? ""), 10);

    if (!name || !barcode || !Number.isFinite(price) || !Number.isInteger(stock)) {
      result.skipped += 1;
      result.errors.push(`Row ${index + 1}: name, barcode, price, and stock are required.`);
      continue;
    }

    try {
      const existing = getProductByBarcode(barcode);
      if (existing) {
        updateProduct(existing.id, name, barcode, price, stock);
        result.updated += 1;
      } else {
        addProduct(name, barcode, price, stock);
        result.inserted += 1;
      }
    } catch (error) {
      result.skipped += 1;
      result.errors.push(`Row ${index + 1}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return result;
}

/** Import products from a CSV or JSON file. Existing barcodes are updated. */
export function importProductsFile(path: string): ImportResult {
  if (!existsSync(path)) throw new Error(`File not found: ${path}`);
  const text = readFileSync(path, "utf8").replace(/^\uFEFF/, "");
  const extension = path.toLowerCase().split(".").pop();

  if (extension === "json" || text.trimStart().startsWith("[") || text.trimStart().startsWith("{")) {
    const parsed = JSON.parse(text) as unknown;
    const rows = Array.isArray(parsed)
      ? parsed
      : parsed && typeof parsed === "object" && Array.isArray((parsed as { products?: unknown }).products)
        ? (parsed as { products: unknown[] }).products
        : null;
    if (!rows) throw new Error("JSON must be an array of products or { \"products\": [...] }.");
    return normalizeImportRows(
      rows.map((row) => {
        const record = row as Record<string, unknown>;
        return {
          name: record.name ?? record.item,
          barcode: record.barcode ?? record.sku,
          price: record.price ?? record.unit_price,
          stock: record.stock ?? record.quantity,
        };
      })
    );
  }

  const parsed = parseCsv(text);
  if (parsed.length < 2) throw new Error("CSV needs a header row and at least one product.");
  const header = parsed[0]!.map((cell) => cell.trim().toLowerCase());
  const indexOf = (...names: string[]) => header.findIndex((cell) => names.includes(cell));
  const nameIndex = indexOf("name", "item");
  const barcodeIndex = indexOf("barcode", "sku");
  const priceIndex = indexOf("price", "unit_price");
  const stockIndex = indexOf("stock", "quantity");
  if ([nameIndex, barcodeIndex, priceIndex, stockIndex].some((index) => index < 0)) {
    throw new Error("CSV header must include name, barcode, price, and stock.");
  }

  const rows: ImportRow[] = parsed.slice(1).map((cells) => ({
    name: cells[nameIndex],
    barcode: cells[barcodeIndex],
    price: cells[priceIndex],
    stock: cells[stockIndex],
  }));
  return normalizeImportRows(rows);
}

/* ------------------------------------------------------------------ */
/* Demo data                                                           */
/* ------------------------------------------------------------------ */

function ensureCategory(name: string): number {
  db.query("INSERT OR IGNORE INTO categories (name) VALUES (?)").run(name);
  const row = db.query("SELECT id FROM categories WHERE name = ?").get(name) as { id: number };
  return row.id;
}

interface SeedProduct {
  name: string;
  barcode: string;
  price: number;
  stock: number;
  category: string;
}

const CAFE_PRODUCTS: SeedProduct[] = [
  { name: "Espresso Single", barcode: "8901001", price: 3.5, stock: 999, category: "Coffee & Drinks" },
  { name: "Cappuccino", barcode: "8901002", price: 4.5, stock: 999, category: "Coffee & Drinks" },
  { name: "Croissant", barcode: "8901003", price: 3.0, stock: 25, category: "Bakery" },
  { name: "Caramel Macchiato", barcode: "8901004", price: 5.25, stock: 999, category: "Coffee & Drinks" },
  { name: "Americano", barcode: "8901005", price: 3.75, stock: 999, category: "Coffee & Drinks" },
  { name: "Blueberry Muffin", barcode: "8901006", price: 3.25, stock: 20, category: "Bakery" },
  { name: "Iced Latte", barcode: "8901007", price: 4.75, stock: 999, category: "Coffee & Drinks" },
  { name: "Cheesecake Slice", barcode: "8901008", price: 6.0, stock: 15, category: "Bakery" },
];

const RETAIL_PRODUCTS: SeedProduct[] = [
  { name: "Claw Hammer 16oz", barcode: "7001001", price: 18.99, stock: 24, category: "Hand Tools" },
  { name: "Screwdriver Set (12pc)", barcode: "7001002", price: 24.5, stock: 18, category: "Hand Tools" },
  { name: "Drill Bit Set (20pc)", barcode: "7001003", price: 32.0, stock: 12, category: "Power Tools" },
  { name: "Work Gloves", barcode: "7001004", price: 8.75, stock: 40, category: "Safety" },
  { name: "Duct Tape 50m", barcode: "7001005", price: 6.25, stock: 55, category: "Hardware" },
  { name: "Tape Measure 5m", barcode: "7001006", price: 9.5, stock: 30, category: "Tools" },
  { name: "Utility Knife", barcode: "7001007", price: 7.99, stock: 26, category: "Tools" },
  { name: "Assorted Screws (100pc)", barcode: "7001008", price: 11.25, stock: 45, category: "Hardware" },
];

const CAFE_INGREDIENTS: Array<{ name: string; unit: string; stock: number; low: number }> = [
  { name: "Coffee Beans", unit: "g", stock: 5000, low: 500 },
  { name: "Milk", unit: "ml", stock: 12000, low: 1500 },
  { name: "Caramel Syrup", unit: "pumps", stock: 300, low: 40 },
  { name: "Vanilla Syrup", unit: "pumps", stock: 250, low: 40 },
  { name: "Chocolate Syrup", unit: "pumps", stock: 180, low: 30 },
  { name: "Cups (12oz)", unit: "units", stock: 400, low: 50 },
];

const CAFE_RECIPES: Record<string, Array<[string, number]>> = {
  "Espresso Single": [["Coffee Beans", 18], ["Cups (12oz)", 1]],
  Cappuccino: [["Coffee Beans", 18], ["Milk", 150], ["Cups (12oz)", 1]],
  "Caramel Macchiato": [["Coffee Beans", 18], ["Milk", 150], ["Caramel Syrup", 2], ["Cups (12oz)", 1]],
  Americano: [["Coffee Beans", 18], ["Cups (12oz)", 1]],
  "Iced Latte": [["Coffee Beans", 18], ["Milk", 120], ["Cups (12oz)", 1]],
};

/** Seed demo catalogue and, for cafes, ingredients plus a few sample recipes. */
export function seedStoreData(storeType: StoreType): void {
  const categoryIds = new Map<string, number>();
  const seedProducts = storeType === "cafe" ? CAFE_PRODUCTS : RETAIL_PRODUCTS;
  const existingCount = (db.query("SELECT COUNT(*) AS count FROM products").get() as { count: number }).count;

  if (existingCount === 0) {
    const insert = db.query(
      "INSERT OR IGNORE INTO products (name, barcode, price, stock, category_id) VALUES (?, ?, ?, ?, ?)"
    );
    for (const product of seedProducts) {
      if (!categoryIds.has(product.category)) categoryIds.set(product.category, ensureCategory(product.category));
      insert.run(product.name, product.barcode, product.price, product.stock, categoryIds.get(product.category)!);
    }
  }

  if (storeType !== "cafe") return;

  const insertIngredient = db.query(
    "INSERT OR IGNORE INTO ingredients (name, unit, stock, low_stock) VALUES (?, ?, ?, ?)"
  );
  for (const ingredient of CAFE_INGREDIENTS) {
    insertIngredient.run(ingredient.name, ingredient.unit, ingredient.stock, ingredient.low);
  }

  const productsByName = new Map(getProducts().map((product) => [product.name, product]));
  const ingredientsByName = new Map(getIngredients().map((ingredient) => [ingredient.name, ingredient]));
  const hasRecipe = db.query("SELECT COUNT(*) AS count FROM product_recipes WHERE product_id = ?");

  for (const [productName, lines] of Object.entries(CAFE_RECIPES)) {
    const product = productsByName.get(productName);
    if (!product) continue;
    if ((hasRecipe.get(product.id) as { count: number }).count > 0) continue;

    const rows: RecipeInput[] = [];
    for (const [ingredientName, quantity] of lines) {
      const ingredient = ingredientsByName.get(ingredientName);
      if (ingredient) rows.push({ ingredientId: ingredient.id, quantity });
    }
    if (rows.length > 0) setProductRecipe(product.id, rows);
  }
}

export { db };
