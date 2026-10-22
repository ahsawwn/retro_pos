import { appendFileSync } from "node:fs";

/**
 * Receipt formatting and persistence.
 *
 * The rendered receipt is deliberately plain ASCII so it can be dropped into an
 * ESC/POS printer driver, a console overlay, or the on-disk receipt journal
 * without any terminal escape sequences.
 */

export interface ReceiptItem {
  name: string;
  price: number;
  qty: number;
}

export interface ReceiptOptions {
  transactionId?: number;
  paymentMethod?: string;
  discountPercent?: number;
  date?: Date;
}

const WIDTH = 44;
const DEFAULT_RECEIPT_LOG = "receipts.log";

function line(char = "-"): string {
  return char.repeat(WIDTH);
}

function center(value: string): string {
  const text = value.slice(0, WIDTH);
  const left = Math.max(0, Math.floor((WIDTH - text.length) / 2));
  return `${" ".repeat(left)}${text}`.padEnd(WIDTH);
}

function money(value: number): string {
  return `$${value.toFixed(2)}`;
}

function twoColumn(label: string, value: string): string {
  return `${label}${value.padStart(Math.max(0, WIDTH - label.length))}`.slice(0, WIDTH);
}

/** Build the printable ESC/POS-style text receipt. */
export function generateReceiptText(
  items: ReceiptItem[],
  subtotal: number,
  discountPercent: number,
  total: number,
  paymentMethod = "Cash",
  options: ReceiptOptions = {}
): string {
  const date = options.date ?? new Date();
  const transactionId = options.transactionId ?? 0;
  const discountAmount = subtotal * (discountPercent / 100);
  const rows: string[] = [];

  rows.push(line("="));
  rows.push(center("RETRO CAFE POS"));
  rows.push(center("TERMINAL POINT OF SALE"));
  rows.push(line("="));
  rows.push(`Receipt #${String(transactionId).padStart(6, "0")}`);
  rows.push(date.toLocaleString());
  rows.push(line("-"));
  rows.push(
    `${"ITEM".padEnd(18)}${"QTY".padStart(4)}${"PRICE".padStart(9)}${"TOTAL".padStart(11)}`
  );
  rows.push(line("-"));

  for (const item of items) {
    const name = item.name.padEnd(18).slice(0, 18);
    const qty = String(item.qty).padStart(4);
    const price = money(item.price).padStart(9);
    const totalForItem = money(item.price * item.qty).padStart(11);
    rows.push(`${name}${qty}${price}${totalForItem}`);
  }

  rows.push(line("-"));
  rows.push(twoColumn("SUBTOTAL", money(subtotal)));
  if (discountPercent > 0) {
    rows.push(twoColumn(`DISCOUNT ${discountPercent}%`, `-${money(discountAmount)}`));
  }
  rows.push(twoColumn("TOTAL", money(total)));
  rows.push(twoColumn("PAYMENT", paymentMethod.toUpperCase()));
  rows.push(line("="));
  rows.push(center("||| ||| || ||| ||| || ||| ||"));
  rows.push(center(`TXN-${String(transactionId).padStart(10, "0")}`));
  rows.push(center("THANK YOU FOR YOUR VISIT"));
  rows.push(line("="));

  return rows.join("\n");
}

/**
 * Append one receipt to receipts.log. This is intentionally append-only: no
 * completed sale should ever overwrite an earlier receipt.
 */
export function appendReceiptToLog(receipt: string, path = DEFAULT_RECEIPT_LOG): string {
  const entry = `${receipt.trimEnd()}\n\n`;
  appendFileSync(path, entry, "utf8");
  return path;
}

/** Split a receipt into display lines for the in-app receipt viewer. */
export function receiptLines(receipt: string): string[] {
  return receipt.trimEnd().split("\n");
}
