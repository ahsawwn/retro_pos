import { appendFileSync, existsSync } from "node:fs";

/**
 * Thermal receipt formatting for 80mm and 57mm rolls.
 *
 * 80mm paper at Font A is 42 columns; 57mm paper is 32 columns. The plain
 * receipt is used by the in-app viewer, console overlay, and receipts.log.
 * `generateEscPosReceipt` wraps the same text with printer initialization,
 * feed lines, and a real ESC/POS cut command for a serial/USB thermal printer.
 */

export type ReceiptWidthMm = 80 | 57;

/** Columns for each paper width. */
export const RECEIPT_COLUMNS: Record<ReceiptWidthMm, number> = { 80: 42, 57: 32 };
export const RECEIPT_WIDTH = 42;
export const ESC_POS_INIT = "\x1b@";
export const ESC_POS_CUT = "\x1d\x56\x00";
const DEFAULT_RECEIPT_LOG = "receipts.log";
const COMMON_PRINTER_DEVICES = ["/dev/usb/lp0", "/dev/lp0", "/dev/ttyUSB0", "COM1"];

export interface PrintResult {
  ok: boolean;
  device?: string;
  error?: string;
}

export interface DetectedPrinter {
  device?: string;
  error?: string;
}


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
  /** Paper width in millimetres. Defaults to 80mm (42 columns). */
  widthMm?: ReceiptWidthMm;
}

function columnsFor(widthMm?: ReceiptWidthMm): number {
  return RECEIPT_COLUMNS[widthMm ?? 80] ?? RECEIPT_WIDTH;
}

function line(width: number, char = "-"): string {
  return char.repeat(width);
}

function clip(value: string, width: number): string {
  return value.length > width ? value.slice(0, width) : value;
}

function center(value: string, width: number): string {
  const text = clip(value, width);
  const left = Math.max(0, Math.floor((width - text.length) / 2));
  return `${" ".repeat(left)}${text}`.padEnd(width);
}

function twoColumn(label: string, value: string, width: number): string {
  const safeLabel = clip(label, width);
  const safeValue = clip(value, width);
  return `${safeLabel}${safeValue.padStart(Math.max(0, width - safeLabel.length))}`.slice(0, width);
}

function wrapWords(value: string, width: number): string[] {
  const words = value.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return [];
  const lines: string[] = [];
  let current = "";

  for (const word of words) {
    if (!current) {
      current = clip(word, width);
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

/**
 * One item line laid out to the exact receipt width:
 * name | qty | unit price | line total, with the numeric columns shrinking on
 * narrow (57mm) paper so nothing is truncated off the right edge.
 */
function itemRow(name: string, qty: string, unit: string, total: string, width: number): string {
  const qtyWidth = 3;
  const valueWidth = Math.max(7, Math.min(11, Math.floor((width - qtyWidth) / 2)));
  const nameWidth = Math.max(6, width - qtyWidth - valueWidth * 2);
  const row =
    `${clip(name, nameWidth).padEnd(nameWidth)}` +
    `${clip(qty, qtyWidth).padStart(qtyWidth)}` +
    `${clip(unit, valueWidth).padStart(valueWidth)}` +
    `${clip(total, valueWidth).padStart(valueWidth)}`;
  return row.slice(0, width);
}

/** Build the receipt body (no control characters) at the requested paper width. */
export function generateReceiptText(data: ReceiptData): string {
  const currency = data.currency || "$";
  const width = columnsFor(data.widthMm);
  const rows: string[] = [];

  rows.push(line(width, "="));
  for (const addressLine of wrapWords(data.storeName, width)) rows.push(center(addressLine, width));
  for (const addressLine of wrapWords(data.storeAddress, width)) rows.push(center(addressLine, width));
  rows.push(line(width, "="));
  rows.push(twoColumn("Receipt", `#${String(data.transactionId).padStart(6, "0")}`, width));
  rows.push(twoColumn("Cashier", clip(data.cashier, Math.max(8, width - 9)), width));
  rows.push(twoColumn("Date", clip(data.date.toLocaleString(), Math.max(8, width - 6)), width));
  rows.push(line(width));
  rows.push(itemRow("ITEM", "QTY", "PRICE", "TOTAL", width));
  rows.push(line(width));

  const nameWidth = Math.max(6, width - 3 - Math.max(7, Math.min(11, Math.floor((width - 3) / 2))) * 2);
  for (const item of data.items) {
    const nameLines = wrapWords(item.name, nameWidth);
    const first = nameLines.shift() ?? "";
    rows.push(itemRow(first, String(item.qty), money(item.price, currency), money(item.price * item.qty, currency), width));
    for (const continuation of nameLines) rows.push(itemRow(continuation, "", "", "", width));
  }

  rows.push(line(width));
  rows.push(twoColumn("Subtotal", money(data.subtotal, currency), width));
  const discountAmount = data.discountAmount ?? 0;
  if (discountAmount > 0) {
    const label = data.discountPercent ? `Discount ${data.discountPercent}%` : "Discount";
    rows.push(twoColumn(label, `-${money(discountAmount, currency)}`, width));
  }
  const taxAmount = data.taxAmount ?? 0;
  const taxRate = data.taxRate ?? 0;
  if (taxAmount > 0 || taxRate > 0) {
    rows.push(twoColumn(`Tax ${taxRate.toFixed(taxRate % 1 === 0 ? 0 : 2)}%`, money(taxAmount, currency), width));
  }
  rows.push(line(width));
  rows.push(twoColumn("NET TOTAL", money(data.total, currency), width));
  rows.push(twoColumn("Payment", data.paymentMethod.toUpperCase(), width));
  const tendered = data.amountTendered ?? data.total;
  rows.push(twoColumn("Tendered", money(tendered, currency), width));
  rows.push(twoColumn("Change", money(data.changeDue ?? 0, currency), width));
  rows.push(line(width, "="));
  rows.push(center("THANK YOU FOR YOUR VISIT", width));
  rows.push("");
  rows.push(center(`*TXN-${String(data.transactionId).padStart(6, "0")}*`, width));
  rows.push(center("|| ||| || ||| | ||| || ||| || |", width));
  rows.push("");

  return rows.map((row) => clip(row, width)).join("\n");
}

/**
 * Wrap a plain receipt in ESC/POS bytes for a real 80mm printer:
 * initialize, print, feed four lines, then partial cut.
 */
export function generateEscPosReceipt(receipt: string): string {
  return `${ESC_POS_INIT}\n${receipt.trimEnd()}\n\n\n\n${ESC_POS_CUT}`;
}

/**
 * Resolve the printer path: explicit setting first, then RETRO_POS_PRINTER,
 * then common Linux/macOS/Windows device names.
 */
export function detectPrinterDevice(configured = ""): DetectedPrinter {
  const explicit = configured.trim() || (process.env.RETRO_POS_PRINTER ?? "").trim();
  if (explicit) {
    if (!existsSync(explicit)) return { error: `Printer not found at ${explicit}.` };
    return { device: explicit };
  }

  for (const candidate of COMMON_PRINTER_DEVICES) {
    if (existsSync(candidate)) return { device: candidate };
  }
  return { error: "No printer detected. Set a device in Settings → Receipt printer." };
}

/** Send one ESC/POS receipt to the configured device. */
export function printReceipt(receipt: string, configuredDevice = ""): PrintResult {
  const detected = detectPrinterDevice(configuredDevice);
  if (!detected.device) return { ok: false, error: detected.error };

  try {
    appendFileSync(detected.device, generateEscPosReceipt(receipt), "utf8");
    return { ok: true, device: detected.device };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "EACCES" || code === "EPERM") {
      return {
        ok: false,
        device: detected.device,
        error:
          `Permission denied writing to ${detected.device}. ` +
          `Add your user to the "lp" group: sudo usermod -aG lp $USER (then log out and back in).`,
      };
    }
    if (code === "EBUSY") {
      return { ok: false, device: detected.device, error: `${detected.device} is busy (held by another print job).` };
    }
    return {
      ok: false,
      device: detected.device,
      error: `Could not write to ${detected.device}: ${error instanceof Error ? error.message : String(error)}`,
    };
  }
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
