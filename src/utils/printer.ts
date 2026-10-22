import { appendFileSync } from "node:fs";

/**
 * 80mm thermal receipt formatting.
 *
 * Standard 80mm paper at Font A is 42 columns. The plain receipt is used by
 * the in-app viewer, console overlay, and receipts.log. `generateEscPosReceipt`
 * wraps the same text with printer initialization, feed lines, and a real
 * ESC/POS cut command for a serial/USB thermal printer.
 */

export const RECEIPT_WIDTH = 42;
export const ESC_POS_INIT = "\x1b@";
export const ESC_POS_CUT = "\x1d\x56\x00";
const DEFAULT_RECEIPT_LOG = "receipts.log";

export interface ReceiptItem {
  name: string;
  price: number;
  qty: number;
}

export interface ReceiptData {
  storeName: string;
  storeAddress: string;
  transactionId: number;
  cashier: string;
  date: Date;
  items: ReceiptItem[];
  subtotal: number;
  discountAmount?: number;
  discountPercent?: number;
  taxRate?: number;
  taxAmount?: number;
  total: number;
  paymentMethod: string;
  amountTendered?: number;
  changeDue?: number;
  currency?: string;
}

function line(char = "-"): string {
  return char.repeat(RECEIPT_WIDTH);
}

function clip(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value;
}

function center(value: string): string {
  const text = clip(value, RECEIPT_WIDTH);
  const left = Math.max(0, Math.floor((RECEIPT_WIDTH - text.length) / 2));
  return `${" ".repeat(left)}${text}`.padEnd(RECEIPT_WIDTH);
}

function twoColumn(label: string, value: string): string {
  const safeLabel = clip(label, RECEIPT_WIDTH);
  const safeValue = clip(value, RECEIPT_WIDTH);
  return `${safeLabel}${safeValue.padStart(Math.max(0, RECEIPT_WIDTH - safeLabel.length))}`.slice(
    0,
    RECEIPT_WIDTH
  );
}

function wrapWords(value: string, width: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = word;
    } else if (`${current} ${word}`.length <= width) {
      current = `${current} ${word}`;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines;
}

function money(value: number, currency = "$"): string {
  return `${currency}${value.toFixed(2)}`;
}

function itemRow(name: string, qty: string, unit: string, total: string): string {
  return (
    `${clip(name, 16).padEnd(16)}` +
    `${clip(qty, 4).padStart(4)}` +
    `${clip(unit, 11).padStart(11)}` +
    `${clip(total, 11).padStart(11)}`
  );
}

/** Build the 42-column receipt body (no control characters). */
export function generateReceiptText(data: ReceiptData): string {
  const currency = data.currency || "$";
  const rows: string[] = [];
  const addressLines = wrapWords(data.storeAddress, RECEIPT_WIDTH);

  rows.push(line("="));
  for (const addressLine of wrapWords(data.storeName, RECEIPT_WIDTH)) rows.push(center(addressLine));
  for (const addressLine of addressLines) rows.push(center(addressLine));
  rows.push(line("="));
  rows.push(twoColumn("Receipt", `#${String(data.transactionId).padStart(6, "0")}`));
  rows.push(twoColumn("Cashier", clip(data.cashier, 24)));
  rows.push(twoColumn("Date", clip(data.date.toLocaleString(), 30)));
  rows.push(line("-"));
  rows.push(itemRow("ITEM", "QTY", "PRICE", "TOTAL"));
  rows.push(line("-"));

  for (const item of data.items) {
    const nameLines = wrapWords(item.name, 16);
    const first = nameLines.shift() ?? "";
    rows.push(itemRow(first, String(item.qty), money(item.price, currency), money(item.price * item.qty, currency)));
    for (const continuation of nameLines) rows.push(itemRow(continuation, "", "", ""));
  }

  rows.push(line("-"));
  rows.push(twoColumn("Subtotal", money(data.subtotal, currency)));
  const discountAmount = data.discountAmount ?? 0;
  if (discountAmount > 0) {
    const label = data.discountPercent ? `Discount ${data.discountPercent}%` : "Discount";
    rows.push(twoColumn(label, `-${money(discountAmount, currency)}`));
  }
  const taxAmount = data.taxAmount ?? 0;
  const taxRate = data.taxRate ?? 0;
  if (taxAmount > 0 || taxRate > 0) {
    rows.push(twoColumn(`Tax ${taxRate.toFixed(taxRate % 1 === 0 ? 0 : 2)}%`, money(taxAmount, currency)));
  }
  rows.push(line("-"));
  rows.push(twoColumn("NET TOTAL", money(data.total, currency)));
  rows.push(twoColumn("Payment", data.paymentMethod.toUpperCase()));
  const tendered = data.amountTendered ?? data.total;
  rows.push(twoColumn("Tendered", money(tendered, currency)));
  rows.push(twoColumn("Change", money(data.changeDue ?? 0, currency)));
  rows.push(line("="));
  rows.push(center("THANK YOU FOR YOUR VISIT"));
  rows.push("");
  rows.push(center(`*TXN-${String(data.transactionId).padStart(6, "0")}*`));
  rows.push(center("|| ||| || ||| | ||| || ||| || |"));
  rows.push("");
  rows.push("");
  rows.push("");
  rows.push("");

  return rows.map((row) => clip(row, RECEIPT_WIDTH)).join("\n");
}

/**
 * Wrap a plain receipt in ESC/POS bytes for a real 80mm printer:
 * initialize, print, feed four lines, then partial cut.
 */
export function generateEscPosReceipt(receipt: string): string {
  return `${ESC_POS_INIT}\n${receipt.trimEnd()}\n\n\n\n${ESC_POS_CUT}`;
}

/** Append one receipt to receipts.log. Completed sales are never overwritten. */
export function appendReceiptToLog(receipt: string, path = DEFAULT_RECEIPT_LOG): string {
  appendFileSync(path, `${receipt.trimEnd()}\n\n`, "utf8");
  return path;
}

/** Split a receipt into display lines for the in-app receipt viewer. */
export function receiptLines(receipt: string): string[] {
  return receipt.trimEnd().split("\n");
}
