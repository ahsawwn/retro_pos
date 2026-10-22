export interface ReceiptItem {
  name: string;
  price: number;
  qty: number;
}

export function generateReceiptText(
  items: ReceiptItem[],
  subtotal: number,
  discountPercent: number,
  total: number,
  paymentMethod: string
): string {
  const dateStr = new Date().toLocaleString();
  const discountAmount = subtotal * (discountPercent / 100);
  
  let receipt = "";
  receipt += "================================================\n";
  receipt += "               RETRO CAFE POS                   \n";
  receipt += "          Terminal Point of Sale                \n";
  receipt += "================================================\n";
  receipt += `Date: ${dateStr}\n`;
  receipt += "------------------------------------------------\n";
  receipt += "ITEM                 QTY     PRICE       TOTAL  \n";
  receipt += "------------------------------------------------\n";

  items.forEach((item) => {
    const lineTotal = (item.price * item.qty).toFixed(2);
    const nameFormatted = item.name.padEnd(18, " ").substring(0, 18);
    const qtyFormatted = String(item.qty).padEnd(6, " ");
    const priceFormatted = `$${item.price.toFixed(2)}`.padEnd(10, " ");
    const totalFormatted = `$${lineTotal}`.padStart(8, " ");
    receipt += `${nameFormatted}${qtyFormatted}${priceFormatted}${totalFormatted}\n`;
  });

  receipt += "------------------------------------------------\n";
  receipt += `SUBTOTAL:                           $${subtotal.toFixed(2)}\n`;
  if (discountPercent > 0) {
    receipt += `DISCOUNT (${discountPercent}%):                       -$${discountAmount.toFixed(2)}\n`;
  }
  receipt += `NET TOTAL:                          $${total.toFixed(2)}\n`;
  receipt += `PAYMENT METHOD:                     ${paymentMethod}\n`;
  receipt += "================================================\n";
  receipt += "          ║█║▌║█║▌│║▌║▌█║                     \n";
  receipt += "          TXN-890123984019                      \n";
  receipt += "      THANK YOU FOR YOUR VISIT!                 \n";
  receipt += "================================================\n";

  return receipt;
}