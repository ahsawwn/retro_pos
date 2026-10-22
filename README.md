# RetroPOS

A retro terminal point-of-sale built with [Bun](https://bun.com), [OpenTUI](https://opentui.com), and `bun:sqlite`.

Scan a barcode or search the catalogue, edit quantities in the cart, apply a discount,
and check out without leaving the terminal. Completed sales are written atomically to
SQLite, deducted from stock, and appended to `receipts.log`.

## Run

```bash
bun install
bun start
```

Type check:

```bash
bun check
```

## Views

| Key | View |
| --- | --- |
| `F1` | Point of sale |
| `F2` | Inventory |
| `F3` | Sales history |
| `F4` | Keyboard help |
| `F5` | Cycle theme (Retro Amber → Dracula → Catppuccin Mocha) |

## Shortcuts

### Search and barcode

| Key | Action |
| --- | --- |
| `/` or `S` | Focus the search bar (in nav mode) |
| Type | Search by name or barcode |
| `Enter` | Add the selected match; an exact barcode always wins |
| `↑` / `↓` | Move through matches |
| `Esc` | Leave search and unlock single-key hotkeys |
| `Ctrl+U` | Clear the search query |

### Cart

| Key | Action |
| --- | --- |
| `Tab` | Move focus between search, catalogue, and cart |
| `↑` / `↓` | Select a cart line |
| `+` / `-` | Increase or decrease quantity |
| `Delete` / `Backspace` | Remove the selected line |
| `Ctrl+Delete` / `Shift+Delete` / `X` | Clear the cart (asks for confirmation) |
| `D` | Cycle discount 0 → 5 → 10 → 15 → 20% |
| `F10` | Checkout |
| `Space` | Checkout while in nav mode |

### Inventory

| Key | Action |
| --- | --- |
| `A` | Add a product |
| `Enter` / `E` | Edit the selected product |
| `Del` / `X` | Delete the selected product (confirmation) |
| `Tab` | Move between form fields |
| `Ctrl+S` | Save the form |
| `Esc` | Cancel the form |

### History

| Key | Action |
| --- | --- |
| `↑` / `↓` | Select a transaction |
| `Enter` | View the stored receipt |
| `R` | Reprint the receipt to the console |

`Q` quits from nav mode; `Ctrl+C` always quits. Single-letter hotkeys are disabled
while the search bar or a product form has focus, so scanners and typing never
trigger an action by accident.

## Data

- `retro_pos.db` — SQLite database (WAL mode). Existing databases are migrated in place.
- `receipts.log` — append-only receipt journal.

Both runtime files are ignored by Git.

## Project layout

```text
src/
  index.tsx           TUI state, layout, keyboard handling
  db/database.ts      schema, migration, catalogue, and transaction queries
  themes/themes.ts    colour palettes and theme cycling
  utils/printer.ts    receipt rendering and receipts.log appending
```

## Branches

- `main` — baseline import
- `develop` — integration branch
- `feat/retail-upgrade` — cart editing, inventory, history, receipts, and theming
