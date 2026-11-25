# Pharma Plus

Pharma Plus is a React pharmacy storefront and owner dashboard backed by local PostgreSQL.

## Requirements

- Node.js 20.19 or newer
- PostgreSQL 17 running locally

pgAdmin 4 is the database management client; PostgreSQL Server must also be installed and running.

## Set up the database

Create a database named `pharma_plus` in pgAdmin, then run `database/schema.sql` in its Query Tool. This creates the pharmacy, medicine, supplier, inventory, customer, staff, sales, payment, discount, settings, and account tables, along with starter categories. It also creates order-status history and verified-purchase product-review tables. Customer accounts are platform-wide. Each pharmacy-owner account creates its own pharmacy, and its products and inventory are isolated from other pharmacies.

Alternatively, create a `.env` file from `.env.example`, then set your PostgreSQL password in it. The `.env` file is ignored by Git.

```sh
copy .env.example .env
```

On macOS or Linux, you can instead use the current OS user when it is allowed to connect:

```sh
createdb pharma_plus
npm run db:setup
```

The API uses `127.0.0.1` on Windows and the local PostgreSQL socket at `/tmp` on macOS/Linux. It defaults to port `5432`, database `pharma_plus`, and the current OS username. Override these with `PGHOST`, `PGPORT`, `PGDATABASE`, `PGUSER`, and `PGPASSWORD` in `.env` when needed.

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

## Cart quotes, inventory, and payment

The client cart stores a pharmacy ID on each item and refuses to mix pharmacies. The server independently checks medicine ownership and current batch-backed sellable stock. Cart quantities are commercial packs; when pack dimensions are known, checkout shows the corresponding base-unit count. Inventory and batch quantities remain counted in sellable packs, matching the existing medicine stock model.

Checkout uses `POST /api/checkout/quote` to return current line prices, pack quantities, GST-based tax, an optional active discount code, and the selected pharmacy's delivery fee (or zero for pickup). The quote is valid for ten minutes. `POST /api/orders` accepts the same cart and checkout choices plus the returned `quoteId`; it rechecks prices, stock, pharmacy settings, discount validity, and the selected address while locking inventory. If anything changed, the API returns a correction or a refreshed quote and requires customer confirmation again. Orders and payments remain pending; selecting UPI never marks payment as paid without verified gateway confirmation. Cart state is currently held in the client and is not persisted, so there is no `/api/me/cart` endpoint.

Pharmacy owners can upload a PNG, JPEG, or WebP UPI QR image (maximum 1 MB) from **Delivery → Marketplace listing details**. When the customer selects UPI at checkout, the app displays the QR belonging to the pharmacy in their cart and the confirmed order total. A QR scan does not verify payment: UPI orders remain pending until a payment gateway confirms them.

## Customer profiles, saved addresses, and pickup

Customers can edit their account name and phone and save multiple labeled delivery addresses, each with a contact number and optional coordinates. Manual street details are optional only when a valid latitude/longitude pair is saved. The **Use GPS** action requests device permission only after a click; permission denial is shown without blocking manual entry. Coordinates are stored directly, with no reverse geocoding. Profile photos are stored in that browser/device's local storage and are not uploaded.

At checkout, customers choose delivery or pharmacy pickup and select a saved address for delivery. Pickup is available only when the pharmacy has enabled it and does not require an address or delivery fee. Delivery requires a selected saved address and the pharmacy's disclosed delivery fee. Address APIs are customer-scoped: `GET/PATCH /api/me/profile`, `GET/POST /api/me/addresses`, and `PATCH /api/me/addresses/:id`. Order creation accepts `fulfillmentMethod` (`delivery` or `pickup`) and, for delivery, an owned `addressId`; GPS-only destinations are stored as coordinates with a null address string.

## Product details, recommendations, and favorites

`GET /api/medicines/:id` returns the approved pharmacy's medicine details, persisted review summary, sellable quantity, warnings, and up to six in-stock recommendations from the same category and pharmacy. Pass `?pharmacyId=<id>` to scope recommendations to another explicitly selected approved pharmacy; medicine details remain scoped to the pharmacy listing identified by the medicine ID. Expired medicine and batch quantities are excluded from sellable stock. The detail page reports pack quantity conversion when pack dimensions are recorded and disables ordering when no sellable stock remains.

Customer favorites persist per signed-in customer in `public.customer_favorites`: use `GET /api/me/favorites`, `POST /api/me/favorites` with `{ "medicineId": 1 }`, and `DELETE /api/me/favorites/:medicineId`. All three routes require a customer session.

## Exact-product pharmacy comparison

Customers open a medicine and choose **Compare prices & choose pharmacy** before entering the cart. The catalog matches listings only when brand, generic ingredient, strength, dosage form, pack quantity, and pack unit all match. Listings from pharmacies that are not admin-approved are excluded. Results show price, stock availability, pickup, the pharmacy's disclosed delivery fee, and (when customer and pharmacy coordinates exist) approximate straight-line distance. No reverse geocoding or route distance is used. Other listings with the same brand or generic ingredient are separated, marked **NOT AN EXACT MATCH**, and cannot be selected into the cart; the UI warns customers to consult a pharmacist rather than treating them as substitutions.

Pharmacy owners enter complete product identity details in **Medicines**. Existing records are not auto-classified from their name or pack label; edit them and enter identity from the product packaging before they can appear in exact-match comparisons. From **Delivery**, owners can set pickup availability, an optional disclosed delivery fee, and optional pharmacy latitude/longitude. Leave the delivery fee blank when it is unknown; customers will see that it was not disclosed. The API endpoints are `GET /api/catalog/compare?productKey=<medicine-id>`, `GET /api/pharmacies/:id`, and the authenticated owner marketplace-settings endpoints. Re-run `npm run db:setup` after updating to add the product identity, location, and inventory-batch indexes.

## Prescription documents and restricted medicines

Mark restricted products as **Prescription required** in the owner medicine editor. Customers attach a prescription PDF, JPEG, or PNG (maximum 5 MB) to the restricted cart items. The API validates the file signature, scans it with ClamAV, then encrypts it with AES-256-GCM in a private directory outside the web root. Uploads fail closed if malware screening or the encryption key is unavailable. Do not put prescription files under `public/`, `dist/`, or another static asset directory.

Configure `.env` before accepting uploads:

- Set `PRESCRIPTION_STORAGE_KEY` to a persistent random 32-byte hex key using the command in `.env.example`. Back it up securely; losing or changing the key makes stored documents unreadable.
- Install ClamAV and make `clamscan` available on `PATH`, or set `CLAMSCAN_PATH` to its executable.
- Optionally set `PRESCRIPTION_STORAGE_DIR` to a private, access-controlled directory outside the project root. The default is `~/.pharma-plus/private-prescriptions`; the API rejects storage paths inside the project, including `public/` and `dist/`.

The customer endpoints are `POST /api/me/prescriptions` (multipart fields `file` and JSON `items` containing `{ medicineId, quantity }`), `GET /api/me/prescriptions`, and `GET /api/me/prescriptions/:id/file`. The owner endpoints are `GET /api/owner/prescriptions`, `GET /api/owner/prescriptions/:id/file`, and `POST /api/owner/prescriptions/:id/review`. Document downloads require authentication, are served as attachments with no-store headers, and are scoped to the uploading customer or the pharmacy handling the restricted item.

Prescription review is available only to a signed-in pharmacy owner whose account name matches the authorized pharmacist on the pharmacy's latest admin-approved verification. The reviewer must confirm patient, prescriber, each medicine, authorized pack quantity, prescription dates, and applicable legal requirements. The reviewer, decision, reason, date range, and medicine approvals are recorded in verification history and audit events. Orders requiring restricted medicines cannot be quoted or placed without an approved, unexpired prescription with remaining quantity; the approval is checked again before pharmacy fulfillment. Declined orders release their prescription quantity reservation.

Prescription files are deleted automatically after the prescription expiry date plus 30 days. Pending files are removed 30 days after submission; rejected or correction-requested files are removed 30 days after the decision. Cleanup runs hourly while the API is running. Minimal verification and audit metadata remains after document deletion. The selected retention period is a development policy and must be checked against applicable local law before production use. Use synthetic prescription documents in development; this local application is not a production health-record system.

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
