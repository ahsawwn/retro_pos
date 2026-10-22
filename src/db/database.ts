import { Database } from "bun:sqlite";

/**
 * Data layer for RetroPOS.
 *
 * Everything that touches SQLite lives here so the UI layer only deals with
 * plain objects. `bun:sqlite` is synchronous, which is a good fit for a small
 * local point-of-sale terminal: checkout writes are atomic and never leave the
 * database in a half-updated state.
 */

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
  total_amount: number;
  payment_method: string;
  items_json: string;
}

export interface TransactionStats {
  count: number;
  revenue: number;
}

export interface ProductInput {
  name: string;
  barcode: string;
  price: number;
  stock: number;
}

const db = new Database("retro_pos.db", { create: true });

// WAL keeps reads snappy while a checkout write is in progress.
db.exec("PRAGMA journal_mode = WAL;");
db.exec("PRAGMA foreign_keys = ON;");

const PRODUCT_COLUMNS = "id, name, barcode, price, stock, category_id";

/**
 * Older RetroPOS databases only stored `total_amount`. Add the missing
 * receipt columns in place so existing sales remain readable.
 */
function migrateLegacyTransactions(): void {
  const columns = db.query("PRAGMA table_info(transactions)").all() as { name: string }[];
  const names = new Set(columns.map((column) => column.name));

  if (!names.has("subtotal")) {
    db.exec("ALTER TABLE transactions ADD COLUMN subtotal REAL NOT NULL DEFAULT 0;");
  }
  if (!names.has("discount_amount")) {
    db.exec("ALTER TABLE transactions ADD COLUMN discount_amount REAL NOT NULL DEFAULT 0;");
  }

  // Legacy rows had no discount data; treat their total as the subtotal.
  if (!names.has("subtotal") || !names.has("discount_amount")) {
    db.exec("UPDATE transactions SET subtotal = total_amount WHERE subtotal = 0;");
  }
}


/** Create tables, indexes, and a small demo catalogue on first run. */
export function initDb(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS products (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      barcode TEXT UNIQUE NOT NULL,
      price REAL NOT NULL,
      stock INTEGER NOT NULL,
      category_id INTEGER,
      FOREIGN KEY (category_id) REFERENCES categories(id)
    );

    CREATE TABLE IF NOT EXISTS transactions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT NOT NULL,
      subtotal REAL NOT NULL,
      discount_amount REAL NOT NULL,
      total_amount REAL NOT NULL,
      payment_method TEXT NOT NULL,
      items_json TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode);
    CREATE INDEX IF NOT EXISTS idx_transactions_timestamp ON transactions(timestamp DESC);
  `);

  migrateLegacyTransactions();

  const res = db.query("SELECT COUNT(*) as count FROM products").get() as { count: number };
  if (res.count === 0) {
    db.exec(`
      INSERT INTO categories (name) VALUES ('Coffee & Drinks'), ('Bakery');
      INSERT INTO products (name, barcode, price, stock, category_id) VALUES
        ('Espresso Single', '8901001', 3.50, 50, 1),
        ('Cappuccino', '8901002', 4.50, 40, 1),
        ('Croissant', '8901003', 3.00, 25, 2),
        ('Caramel Macchiato', '8901004', 5.25, 30, 1),
        ('Americano', '8901005', 3.75, 45, 1),
        ('Blueberry Muffin', '8901006', 3.25, 20, 2),
        ('Iced Latte', '8901007', 4.75, 35, 1),
        ('Cheesecake Slice', '8901008', 6.00, 15, 2);
    `);
  }
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
  return (db
    .query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE barcode = ?`)
    .get(barcode.trim()) as Product | null) ?? null;
}

export function getProductById(id: number): Product | null {
  return (db
    .query(`SELECT ${PRODUCT_COLUMNS} FROM products WHERE id = ?`)
    .get(id) as Product | null) ?? null;
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
      .query(
        `INSERT INTO products (name, barcode, price, stock, category_id)
         VALUES (?, ?, ?, ?, 1)`
      )
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

export function updateProductStock(id: number, stock: number): void {
  db.query("UPDATE products SET stock = MAX(0, ?) WHERE id = ?").run(Math.trunc(stock), id);
}

export function deleteProduct(id: number): boolean {
  const result = db.query("DELETE FROM products WHERE id = ?").run(id);
  return result.changes > 0;
}

/* ------------------------------------------------------------------ */
/* Transactions                                                        */
/* ------------------------------------------------------------------ */

/**
 * Persist a completed sale and deduct stock in one SQLite transaction.
 * Returns the new transaction id.
 */
export function recordTransaction(
  subtotal: number,
  discountAmount: number,
  total: number,
  method: string,
  items: CartItem[]
): number {
  const timestamp = new Date().toISOString();

  const writeSale = db.transaction(() => {
    const result = db
      .query(
        `INSERT INTO transactions (timestamp, subtotal, discount_amount, total_amount, payment_method, items_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(timestamp, subtotal, discountAmount, total, method, JSON.stringify(items));

    const deductStock = db.query("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?");
    for (const item of items) {
      deductStock.run(item.qty, item.id);
    }

    return Number(result.lastInsertRowid);
  });

  return writeSale();
}

/** Most recent sales first. History is intentionally capped for terminal speed. */
export function getRecentTransactions(limit = 100): TransactionRecord[] {
  const safeLimit = Math.max(1, Math.min(500, Math.trunc(limit)));
  return db
    .query(
      `SELECT id, timestamp, subtotal, discount_amount, total_amount, payment_method, items_json
       FROM transactions
       ORDER BY id DESC
       LIMIT ?`
    )
    .all(safeLimit) as TransactionRecord[];
}

export function getTransactionById(id: number): TransactionRecord | null {
  return (db.query("SELECT * FROM transactions WHERE id = ?").get(id) as TransactionRecord | null) ?? null;
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
      `SELECT COUNT(*) as count, COALESCE(SUM(total_amount), 0) as revenue
       FROM transactions
       WHERE date(timestamp, 'localtime') = date('now', 'localtime')`
    )
    .get() as { count: number; revenue: number };

  return { count: row.count, revenue: row.revenue };
}

export { db };
