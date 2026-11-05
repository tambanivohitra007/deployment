# Stockroom

A Tailwind storefront and admin dashboard with a Node.js API and a persistent SQLite database. The catalog is imported from DummyJSON once; product edits, inventory changes, and orders are then stored locally. Checkout is a **demo**: it does not collect money or arrange delivery.

## Run locally

Use Node.js 24.15+ (24.x) or 26+. In PowerShell, use `npm.cmd` if your execution policy blocks `npm.ps1`.

```powershell
npm.cmd ci
npm.cmd run build:css
npm.cmd run seed
npm.cmd run admin:create
npm.cmd start
```

Open **http://localhost:3000**. Use the Admin link to sign in with the account you created. There are no default credentials or public admin registration. The creation command asks for an email and a hidden password of 12–128 characters, and stores a salted scrypt password hash.

The seed command refuses to overwrite a nonempty catalog. Skip it if you want an empty store, or supply an offline export with `npm.cmd run seed -- --file products.json` (an object with a `products` array). You can create additional admins by running `admin:create` again with a different email.

This app must be served by the Node server. Opening `index.html` directly or using an IDE static server will not provide the API or session cookies. `npm.cmd run dev` restarts the server when source files change; refresh the browser after edits. Rebuild Tailwind after changing utility classes.

## What persists

- Products, inventory, demo orders, order statuses, admin accounts, and sessions live in `data/stockroom.sqlite` by default. Restarting the server preserves them.
- The shopping bag and unfinished checkout request use the browser tab's session storage. Retry a pending checkout from the same tab to avoid creating another order after a lost response. Clearing cookies or closing the tab can prevent recovery; admins can inspect saved orders.
- Order items retain their original names and prices even after products are edited or deleted.
- The dashboard refreshes when opened. Use **Refresh workspace** to pick up changes made by another browser.

Stock and prices are checked on the server. Checkout uses a database transaction so an order and all of its stock changes either succeed together or fail together. Retries reuse a checkout key. Product edits include a version number so stale admin forms cannot overwrite newer inventory changes; close and reopen the form after a conflict.

## Configuration and backups

Defaults work locally without an `.env` file. Copy `.env.example` to `.env` to change the bind host, port, exact public origin, or database path. Visit the configured `APP_ORIGIN`; other hostnames and cross-origin writes are rejected. `.env`, databases, backups, and dependencies are excluded from Git.

```powershell
npm.cmd run backup
```

This writes a consistent database snapshot into `data/backups`. Keep a separate protected copy outside the application host. Backups contain password hashes and session records and must remain private. To restore, stop the app and point `DATABASE_PATH` to a **copy** of the chosen backup, then restart. Do not overwrite an open SQLite database or reuse old WAL/SHM sidecar files.

For hosting, run one Node service with persistent local disk for SQLite, behind an HTTPS reverse proxy that preserves the configured Host header. Set `NODE_ENV=production`, `COOKIE_SECURE=true`, and an HTTPS `APP_ORIGIN`. The service refuses production startup without these settings. Do not deploy this as a static-only site or put the database on ephemeral/serverless storage.

Sessions use HttpOnly, SameSite cookies, rotate on sign-in/sign-out, and expire after eight hours for admins or 24 hours for guests. Writes require same-origin requests and a CSRF token. Admin routes enforce authentication on the server. Sign-in throttling is in memory and resets at server restart; behind a proxy it applies to the proxy IP. Add gateway rate limits before exposing a public service at scale.

## Checks and project layout

```powershell
npm.cmd test
npm.cmd run build:css
```

Tests use temporary databases, not the development catalog. API tests cover authentication, CSRF, validation, conflicting edits, checkout retries, stock concurrency, persistence, and private-file access. DOM integration tests exercise the actual HTML and JavaScript modules against the server; they do not replace visual browser testing.

- `index.html`, `admin.css`, `storefront.css`: views and styling.
- `js/main.js`: startup, navigation, and sign-in; `js/api.js`: HTTP and session handling.
- `js/admin.js`, `js/store.js`, `js/cart.js`: dashboard, collection, and checkout.
- `server/`: HTTP routes, validation, password/session handling, and database schema.
- `scripts/`: catalog import, admin creation, and backups.
- `assets/tailwind.css`: compiled and committed stylesheet; no runtime Tailwind CDN.

## Before accepting real purchases

This milestone provides a persistent **single-store** foundation. It is not yet a multi-tenant SaaS or a live payment system. Real purchases still need a payment provider with verified webhooks, customer/contact and shipping details, tax/shipping rules, refunds, and fulfillment. A public launch also needs account recovery/MFA, operational monitoring, tested backup restoration, and deployment-specific security review. Product images still use the imported catalog URLs; image uploads and hosting are a separate feature.
