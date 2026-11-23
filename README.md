# Pharma Plus

Pharma Plus is a React pharmacy storefront and owner dashboard backed by local PostgreSQL.

## Requirements

- Node.js 20.19 or newer
- PostgreSQL 17 running locally

pgAdmin 4 is the database management client; PostgreSQL Server must also be installed and running.

## Set up the database

Create a database named `pharma_plus` in pgAdmin, then run `database/schema.sql` in its Query Tool. This creates the pharmacy, medicine, supplier, inventory, customer, staff, sales, payment, discount, settings, and account tables, along with starter categories. It also creates order-status history and verified-purchase product-review tables. Customer accounts are platform-wide. Each pharmacy-owner account creates its own pharmacy, and its products and inventory are isolated from other pharmacies.

Alternatively, with the local server running and the current macOS user allowed to connect:

```sh
createdb pharma_plus
npm run db:setup
```

The API uses the local PostgreSQL socket at `/tmp`, port `5432`, database `pharma_plus`, and the current OS username by default. Override these with `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` when needed.

To connect in pgAdmin, register a server with host `127.0.0.1`, port `5432`, maintenance database `postgres`, and your macOS username. The local Homebrew setup accepts local connections without a password by default. Select the `pharma_plus` database to browse its tables.

## Run the app locally

```sh
npm install
npm run db:setup
npm run dev
```

The development command starts the API and Vite frontend. Open the Vite URL printed in the terminal. The redesigned welcome screen leads into separate account-type selection and sign-in/sign-up screens:

- Choose **Sign in** or **Create new account**. New users select **Customer** or **Pharmacy owner** before continuing. Pharmacy owners register with their name, pharmacy name, email, and a password of at least 12 characters; each owner can manage only that pharmacy's inventory.
- Customers can browse category-filtered medicines, search pharmacies, review a separate cart and checkout, track delivery status, and save profile details using either the device's current GPS coordinates or a manually entered delivery address. Customer accounts work across pharmacies.

Both account types use the same local PostgreSQL database. Owner inventory changes persist in PostgreSQL and can be inspected in pgAdmin under `public.medicines`. Customer profile details are saved under `public.user_accounts` and `public.customer_addresses`; GPS coordinates are stored as latitude and longitude without reverse-geocoding or sending them to a lookup service.

Customers can filter medicines by category, search pharmacies, place orders, follow status timestamps, and share a one-time delivery code with the pharmacy at handoff. The API stores only a hash of the code. A customer can review a medicine after a delivered order; reviews and ratings are saved in `public.product_reviews`. Owner workspaces show inventory alerts, expiry attention, stock movements, and order fulfillment. Re-run `npm run db:setup` after updating the project to apply the idempotent schema changes.

## Build and use a local-network Android APK

Keep the Mac and phone on the same trusted Wi-Fi. Build the debug APK:

```sh
npm run mobile:build
```

The command detects the Mac's LAN address, generates a local development TLS certificate, builds and syncs the Android app, and writes `release/Pharma-Plus-mobile-debug.apk`. The certificate authority is bundled into this debug APK; its private key remains in the ignored `.devcerts/` directory.

Start the HTTPS API on the Mac before opening the APK:

```sh
npm run api:mobile
```

Install `release/Pharma-Plus-mobile-debug.apk` on the phone, keep both devices on that Wi-Fi, then create an account or sign in and choose **Customer** or **Pharmacy owner**. Customers can choose a device GPS location or enter a delivery address manually from their profile. Pharmacy owners can add or edit medicines from the single-screen inventory editor; changes are saved in `public.medicines` and scoped to their pharmacy. Customer orders and order-status timestamps are stored in `public.sales_orders` and `public.order_status_events`; the owner's delivery screen verifies the customer's code before marking an order delivered. The Mac firewall must allow incoming connections to port `3002`.

This is a local development setup, not a production deployment. The APK is tied to the Mac's current LAN IP and debug certificate; rebuild it if that IP changes. Do not use real patient data or expose this development API to the public internet.

For a production frontend build without Android packaging, run `npm run build`.
