# RetroPOS

A retro terminal point-of-sale built with [Bun](https://bun.com), [OpenTUI](https://opentui.com), and `bun:sqlite`.

RetroPOS is a complete keyboard-driven checkout terminal: PIN login with role-based access, first-run store setup, barcode/search sales, cash/card/mobile payments, inventory, cafe recipes, sales history, analytics, CSV/JSON import and export, and persistent themes and shortcuts.

## Run

```bash
bun install
bun start
```

Type check:

```bash
bun check
```

The first launch opens a nine-step onboarding wizard. It saves your store name, address, Cafe or Retail mode, currency symbol, tax rate, and the first Admin account, then signs you in automatically.

## Sign-in and roles

Every launch starts at the PIN login screen. Enter a username and a 4–6 digit PIN, or just the PIN on a shared terminal. PINs are salted and hashed with scrypt; the session itself is kept in memory.

| Role | Point of sale | Sales history | Inventory | Analytics | Settings |
| --- | --- | --- | --- | --- | --- |
| Admin | Yes | Yes | Yes | Yes | Yes |
| Manager | Yes | Yes | Yes | Yes | Yes |
| Cashier | Yes | Yes | No | No | No |

Admins can add users, reset PINs, and delete accounts from Settings. The last Admin and the signed-in account cannot be deleted. `F8` signs out and locks the terminal from any screen.

## Views and defaults

All bindings below are defaults. Every action can be remapped in **Settings → Keyboard shortcuts** and saved across restarts.

| Key | View |
| --- | --- |
| `F1` | Point of sale |
| `F2` | Inventory (Manager/Admin) |
| `F3` | Analytics (Manager/Admin) |
| `F4` | Settings (Manager/Admin) |
| `F5` | Cycle theme (Retro Amber → Dracula → Catppuccin Mocha) |
| `F6` | Sales history |
| `F7` | Keyboard help |
| `F8` | Sign out / lock terminal |
| `F10` | Checkout |

## Point of sale

- Type in the search bar to filter by product name or barcode. An exact barcode match always wins.
- `Enter` adds the highlighted product. `1`–`9` add the first nine visible products in nav mode.
- `+` / `-` change the selected cart quantity, `Delete` removes a line, and `Ctrl+Delete` clears the cart after confirmation.
- `D` cycles the cart discount through 0, 5, 10, 15, and 20%.
- Checkout supports Cash, Card, and Mobile. Cash accepts a tendered amount and shows change.
- Tax is calculated on the discounted subtotal. Totals, tax, tendered amount, and change are stored with the transaction.

### Payments

| Key | Action |
| --- | --- |
| `Enter` | Confirm payment |
| `←` / `→` or `Tab` | Change payment method |
| Digits | Enter the cash tendered amount (Cash only) |
| `Esc` | Cancel payment |

## Inventory and cafe recipes

**Retail mode** tracks a unit stock count per product and warns when stock is low.

**Cafe mode** adds an ingredient inventory and per-product recipes. Selling a product with a recipe deducts each ingredient by the configured amount. Products without a recipe fall back to their finished-product stock. Sellable availability is calculated from the scarcest linked ingredient.

| Key | Action |
| --- | --- |
| `A` | Add a product or ingredient |
| `Enter` / `E` | Edit the selected item |
| `Del` / `X` | Delete (confirmation) |
| `Tab` | Move between form fields |
| `Ctrl+S` | Save the form |
| `Esc` | Cancel the form |
| `R` | Edit the selected product's recipe (Cafe mode) |
| `I` | Toggle products / ingredients (Cafe mode) |

## Sales history and analytics

Sales history lists completed transactions; `Enter` opens the stored receipt and `R` reprints it to the terminal and receipt journals.

Analytics reports today, this week, and all-time revenue and transaction counts, top-selling products, payment-method cash flow, and low-stock warnings.

## Settings

- **Store profile** changes name, address, Cafe/Retail mode, currency symbol, and tax rate immediately.
- **Receipt printer** chooses Auto print / Ask / Off, sets the device path, and sends a test receipt.
- **Keyboard shortcuts** remaps every action. Capture a key, or use `Backspace` to restore that action's default.
- **User accounts** manages Admins, Managers, and Cashiers, including PIN resets.
- **Import / export** writes `products_export.csv` and imports products from CSV or JSON by upserting on barcode.
- **Sign out** locks the terminal without quitting the app.

Settings and the selected theme are stored in SQLite, so both survive restarts. The same applies to the store profile and key bindings.

## Receipts

Receipts use a 42-column, 80mm-friendly layout with centered store details, transaction number, cashier, timestamp, item grid, subtotal, discount, tax, net total, payment/change, and an ASCII barcode.

### Printing after checkout

Configure this in **Settings → Receipt printer**:

| Mode | Behavior |
| --- | --- |
| `Auto print` | Sends the receipt to the printer immediately after checkout. |
| `Ask after checkout` | Keeps the receipt on screen and prints only when you press `P`. |
| `Off` | Never sends to a printer; keeps receipts on screen and in the logs. |

The app auto-detects common device paths (`/dev/usb/lp0`, `/dev/lp0`, `/dev/ttyUSB0`, `COM1`). You can override the device in the same screen or with the `RETRO_POS_PRINTER` environment variable, and press `T` to send a test receipt. Printing never blocks a sale: if the printer is missing or a write fails, the receipt stays on screen with the ESC/POS copy in `receipts.escpos.log`.

You can also print any receipt later from Sales History with `P`.

Every sale is appended to:

- `receipts.log` — plain-text receipt journal.
- `receipts.escpos.log` — ESC/POS payload with initialization (`ESC @`), feed lines, and the cut command (`GS V 0`). The payload can be sent to a compatible printer, for example `cat receipts.escpos.log > /dev/usb/lp0`.

## Search and navigation shortcuts

| Key | Action |
| --- | --- |
| `/` | Focus the search bar (nav mode) |
| Type | Search by name or barcode |
| `↑` / `↓` | Move through matches |
| `Enter` | Add the selected match |
| `Esc` | Leave search / cancel the current form |
| `Ctrl+U` | Clear the search query or current import path |
| `P` | Print the open receipt (receipt viewer and Sales History) |
| `Q` | Quit from nav mode; `Ctrl+C` always quits |

Single-letter hotkeys are disabled while the search bar or a form has focus, so scanners and typing never trigger actions by accident. Function-key shortcuts such as `F8` still work while searching.

## Data

- `retro_pos.db` — SQLite database in WAL mode. Existing databases are migrated in place.
- `receipts.log` — append-only plain-text receipt journal.
- `receipts.escpos.log` — append-only ESC/POS receipt journal.
- `products_export.csv` — generated by the export action.
- `products_import.csv` — default import path; any `.csv` or `.json` path can be typed.

Runtime database and receipt files are ignored by Git.

## Project layout

```text
src/
  index.tsx           TUI screens, state, layout, keyboard handling
  auth.ts             PIN hashing, authentication, account operations, RBAC
  settings.ts         persistent shortcuts, theme, store profile, logout action
  db/database.ts      schema, migrations, catalogue, recipes, analytics, import/export
  themes/themes.ts    colour palettes and theme cycling
  utils/printer.ts    receipt rendering, ESC/POS wrapper, receipt journal
```

## Branches

- `main` — released baseline
- `develop` — integration branch
- `feat/retail-upgrade` — cart editing, inventory, history, receipts, and theming
- `feat/commercial-suite` — authentication, onboarding, analytics, cafe recipes, import/export, persistent preferences
