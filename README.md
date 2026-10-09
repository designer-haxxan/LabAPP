# LabCare Billing

Offline-first lab management and billing as a static PWA (no build step).
HTML5 · ES modules · jQuery · Bootstrap 5 · Bootstrap Icons · IndexedDB · Service Worker · eposwala login API.

## Features

- **Patients**: registration with an automatic MR number (`MR-000001`), search by name, phone or MR number, visit history and outstanding balance.
- **Billing**: pick the patient, optional referring doctor, then add tests and packages. Prices can be lowered per line, with a bill discount, tax (optional), partial payment, payment method and a receipt print. Each bill gets a number (`LAB-000001`) and every test on it gets a report.
- **Dynamic test builder**: define any test with any number of parameters. Each parameter is numeric (with unit and reference ranges per gender and age band), a set of options (for example Positive / Negative), or free text. Department, sample type, turnaround, price and report notes are all editable.
- **Packages**: bundle tests into a package with its own price. The screen shows the saving against the individual total.
- **Results & reports**: a worklist (To do / Entered / Verified). Result entry shows high or low flags live, using the patient's age and gender. A second staff member verifies and finalises the report. Verified reports can be reopened for correction. Reports print one page per test, or all tests of a bill, marked PRELIMINARY until verified.
- **Referring doctors**: contact details, specialty, commission percentage, bills referred and commission payable per period. Commission is recorded on each bill when it is created, so later rate changes do not alter old bills.
- **Expenses**: categorised running costs (rent, electricity, salaries, reagents, consumables, transport and so on), with a category breakdown.
- **Supplies & stock**: lab consumables, reagents and office basics, with stock in and use, a reorder alert that only applies once an item has been stocked, stock history and stock value.
- **Reports**: daily book, money flow (billed, collected, expenses, net), outstanding balances, test volumes, payment methods, doctor commissions and expenses by category. Printable and exportable as CSV.
- **Backup & restore**: one JSON file containing all records and settings, with a SHA-256 checksum, record counts and version checks before anything is replaced. Restoring requires typing REPLACE.
- **Starter catalog**: 19 common tests (CBC, FBS, RBS, HbA1c, lipid profile, LFT, RFT, thyroid, vitamin D and B12, CRP, ESR, blood group, hepatitis B and C, dengue, malaria, Widal, urine routine) and 5 packages, with indicative Pakistani prices. There are also 41 consumable, reagent and office items with cost 0 for you to fill in. Starter records are added once and never overwritten. Settings can add missing ones again.
- **Roles**: Owner (everything), Manager (catalog, doctors, expenses, supplies, verification, voids, finance reports, settings, backup), Receptionist (patients, billing, payments, result entry, reports view).
- **PWA**: installable, works fully offline after the first online sign-in.

## Prices

The starter prices come from published 2026 Pakistani lab rate lists, for example CBC about Rs 600 and lipid profile about Rs 1,500. Labs differ, so set every price to your own rates in **Tests & Packages**. Dengue and other tests may fall under government rate caps; check these before you set the price.

## Architecture

```
index.html              App shell (splash, login, layout)
manifest.json           PWA manifest
service-worker.js       Precache of shell + CDN libs; cache-first; /api/ requests never cached
css/app.css             Design tokens, shell, login, shared components
css/lab.css             Lab components, charts, animations, A4 print styles
js/app.js               Boot, auth gate + session expiry, router (lazy-loaded modules), menus, SW updates
js/config.js            Login API base URL, support phone, app/schema/backup versions
js/core/                utils, settings (LocalStorage), ui (modals, pickers, toasts), views, badges, print
js/db/                  IndexedDB wrapper (atomic multi-store transactions) + schema
js/services/            auth, data (all business rules and writes), seed (starter catalog)
js/modules/             dashboard, billing, patients, catalog, doctors, results, expenses, supplies, reports, settings, backup
```

### Storage

| Where | What |
|---|---|
| IndexedDB `disterp_lab` | Patients, doctors, tests, groups, bills, payments, reports (test results), expenses, supplies, supply moves, audit log, counters |
| LocalStorage | Lab settings (`disterp.labsettings`), device preferences, `disterp.session` (`{ token, expiresAt, username }`), the shared phone id `minipos.deviceId` |

**Shared origin.** Every GitHub Pages site under `designer-haxxan.github.io` shares one origin. This app therefore namespaces everything with `CONFIG.APP_ID` (`disterp`): the database `disterp_lab`, the keys `disterp.*`, and the caches `disterp-*`. The earlier POS database `disterp_pos` is never modified. If you copy this app for another lab, **change `APP_ID`** in `js/config.js` and `service-worker.js`.

**Data integrity.** Every operation (bill, payment, void, result save or verify, expense, stock movement, patient or catalog save) runs in **one IndexedDB transaction**, so a failure leaves nothing partial behind. Test prices and parameters are copied into the bill and into each report when they are created. Later catalog edits therefore never change an existing bill or a finished report. A double tap or a retry after a refresh returns the bill that was already saved, instead of creating a second one. Bill and MR numbers come from counters inside the same transaction, so failed attempts do not use up numbers.

**Voids.** A bill can be voided only while none of its tests has results entered. Any amount already paid is written as a refund entry, so collections always add up.

**Flags.** Each reference range has a gender (any, male or female), an optional age band, and low and high limits. The first range that matches the patient is used. A result below the lower limit is flagged L, above the upper limit H, and within the range N. Flags are stored with the result, so they do not change if the ranges are edited later.

### Authentication

Login uses the eposwala API (`CONFIG.AUTH_API_BASE`, default `https://eposwala.com/api`):

```
POST /api/login   Content-Type: application/json
{ "username": "...", "password": "...", "deviceId": "..." }
2xx  → { "token": "...", "expiresAt": <unix ms>, "username": "..." }
!2xx → { "error": "missing_fields" | "invalid_credentials" | "device_mismatch" | "account_disabled" }
```

- Login requires internet. After that the app works offline until `expiresAt`. Passwords are never stored.
- One device per account. Moving to another phone goes through support (`CONFIG.SUPPORT_PHONE`).
- The login API is unchanged from the POS version.

## Setup

1. Set `AUTH_API_BASE` and `SUPPORT_PHONE` in `js/config.js` if they differ from the defaults. The login API must allow the origin the app is served from (CORS).
2. Run locally:

   ```bash
   python -m http.server 8765
   ```

   Then open http://localhost:8765. The app needs HTTP (ES modules and service worker), and `localhost` counts as secure.
3. Deploy the folder to GitHub Pages or any HTTPS host. Bump `VERSION` in `service-worker.js` whenever a cached file changes, so installed apps update.

## Known limitations

- **Data lives on the device.** There is no multi-device sync. Back up regularly (the dashboard reminds you after 7 days). To move data, use Backup & Restore.
- **Anyone with access to the device can read local data.** The offline session check runs in the browser. Use device lock screens.
- **No user management in the app.** Accounts, passwords and device resets are handled by the eposwala server.
- **Printing** uses the browser print dialog (A4 reports and receipts). There is no direct thermal-printer driver in this version.
- **Doctor commission** is shown as payable and is not deducted from the lab's collections.
- **No sample barcodes or instrument interfacing yet.** Results are entered by hand or on screen.
