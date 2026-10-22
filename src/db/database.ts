import { Database } from "bun:sqlite";

const db = new Database("retro_pos.db", { create: true });

export function initDb() {
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
  `);

  const res = db.query("SELECT COUNT(*) as count FROM products").get() as { count: number };
  if (res.count === 0) {
    db.exec(`
      INSERT INTO categories (name) VALUES ('Coffee & Drinks'), ('Bakery');
      INSERT INTO products (name, barcode, price, stock, category_id) VALUES 
        ('Espresso Single', '8901001', 3.50, 50, 1),
        ('Cappuccino', '8901002', 4.50, 40, 1),
        ('Croissant', '8901003', 3.00, 25, 2),
        ('Caramel Macchiato', '8901004', 5.25, 30, 1);
    `);
  }
}

// --- CRUD OPERATIONS ---

export function getProducts() {
  return db.query("SELECT * FROM products").all();
}

export function searchProducts(query: string) {
  return db.query("SELECT * FROM products WHERE name LIKE ? OR barcode = ?").all(`%${query}%`, query);
}

export function getProductByBarcode(barcode: string) {
  return db.query("SELECT * FROM products WHERE barcode = ?").get(barcode);
}

export function addProduct(name: string, barcode: string, price: number, stock: number) {
  return db.query(`
    INSERT INTO products (name, barcode, price, stock, category_id) 
    VALUES (?, ?, ?, ?, 1)
  `).run(name, barcode, price, stock);
}

export function updateProductStock(id: number, stock: number) {
  return db.query("UPDATE products SET stock = ? WHERE id = ?").run(stock, id);
}

export function deleteProduct(id: number) {
  return db.query("DELETE FROM products WHERE id = ?").run(id);
}

export function recordTransaction(subtotal: number, discount: number, total: number, method: string, items: any[]) {
  const timestamp = new Date().toISOString();
  db.query(`
    INSERT INTO transactions (timestamp, subtotal, discount_amount, total_amount, payment_method, items_json)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(timestamp, subtotal, discount, total, method, JSON.stringify(items));

  // Deduct Stock
  items.forEach((item) => {
    db.query("UPDATE products SET stock = MAX(0, stock - ?) WHERE id = ?").run(item.qty, item.id);
  });
}

export { db };