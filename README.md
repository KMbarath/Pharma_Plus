# Pharma Plus

Pharma Plus is a React pharmacy storefront and owner dashboard backed by local PostgreSQL.

## Requirements

- Node.js 20.19 or newer
- PostgreSQL 17 running locally

pgAdmin 4 is the database management client; PostgreSQL Server must also be installed and running.

## Set up the database

Create a database named `pharma_plus` in pgAdmin, then run `database/schema.sql` in its Query Tool. This creates the pharmacy, medicine, supplier, inventory, customer, staff, sales, payment, discount, and settings tables, along with starter categories.

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

The development command starts the API and Vite frontend. Open the Vite URL printed in the terminal, then open **Pharmacy dashboard**. On first use, create the owner account on this Mac with a unique password of at least 12 characters. Use **Medicines** to add and manage medicines; changes persist in PostgreSQL.

## Build and use a local-network Android APK

Keep the Mac and phone on the same trusted Wi-Fi. Create the owner account in the Mac browser first, then build the debug APK:

```sh
npm run mobile:build
```

The command detects the Mac's LAN address, generates a local development TLS certificate, builds and syncs the Android app, and writes `release/Pharma-Plus-mobile-debug.apk`. The certificate authority is bundled into this debug APK; its private key remains in the ignored `.devcerts/` directory.

Start the HTTPS API on the Mac before opening the APK:

```sh
npm run api:mobile
```

Install `release/Pharma-Plus-mobile-debug.apk` on the phone, keep both devices on that Wi-Fi, and sign in with the owner account. After adding or editing a medicine, refresh `pharma_plus` in pgAdmin and inspect the `public.medicines` table. The Mac firewall must allow incoming connections to port `3002`.

This is a local development setup, not a production deployment. The APK is tied to the Mac's current LAN IP and debug certificate; rebuild it if that IP changes. Do not use real patient data or expose this development API to the public internet.

For a production frontend build without Android packaging, run `npm run build`.
