# Property financial statement and GRA supporting export

Finance → Profit & Loss → **Generate financial report** is available on web and mobile.
Choose Individual landlord or Registered business, the reporting dates, and the
taxpayer's registered name. TIN/Ghana Card PIN and tax office are optional for a
draft; they must be checked and completed when preparing the actual return.
The dates support calendar years and business fiscal periods of up to 366 days.

PDF is the primary format. Choose an individual Property or all authorised
Properties. The PDF contains a financial summary, income and expenditure,
property-level figures, expense categories, outstanding payments, report dates,
generation time, preparation notes and numbered pages. CSV remains a separate
option for the underlying receipts, refunds, expenses, fees and outstanding rows.
Web downloads the chosen file. Mobile opens the system save/share sheet and removes
its temporary cached copy afterwards. The app does not submit anything to GRA.
There are no new dependencies or database migrations.

## Official guidance checked on 29 October 2026

- [GRA Returns](https://gra.gov.gh/domestic-tax/returns/) identifies the taxpayer
  name, TIN, tax office, period, and return-specific financial information.
- [GRA Rent Tax](https://gra.gov.gh/portfolio/rent-tax/) provides rent-tax guidance
  and published residential/non-residential rates.
- [GRA Withholding Tax practice note, section 4.2.3](https://gra.gov.gh/wp-content/uploads/2020/09/Practice-Note-on-Withholding-of-Tax.pdf)
  distinguishes investment rental income from income earned in a letting
  business. Selecting “business” is not enough information to calculate a final
  liability, and the report does not apply a blanket rate to P&L profit.

## Contents and accounting boundaries

The report includes taxpayer metadata, per-currency summaries, all confirmed
receipts in the selected period, completed refunds against those receipts,
recorded property expenses, settled processing fees, and official source links.
Receipts identify the property, recorded property category, unit, tenant, lease,
charge kind, rental period where recorded, method, reference, date and amount.

Both formats share the existing calculation: recorded rent less completed rent
refunds, recorded expenses and settled processing fees. PDF uses the existing
backend ReportLab dependency and shared Unicode-safe document fonts. No values
are populated from templates, estimated records or placeholder financial data.

- Only rent and advance-rent charge payments enter the recorded rent subtotal.
  Deposits, agency fees and unallocated payments remain visible in the separate
  other-receipts subtotal. Their tax treatment must be reviewed separately.
- Pending, disputed and unconfirmed payments do not enter the schedules.
- Advance rent is reported on the recorded receipt date, without spreading it
  over the months it covers.
- Refunds follow the existing P&L convention: completed refunds restate their
  original receipt period, even when completed later. The model does not hold a
  reliable refund-completion timestamp; this is disclosed in the report.
- Expense dates are incurred dates, not verified cash-payment dates. Recorded
  expenses and refunds are not automatically allowable tax deductions.
- Processing fees require a settled transaction. Payouts are transfers and are
  not counted again as income. Currencies are never combined or converted.
- Received amounts can already be net of withholding. The report therefore
  labels them recorded rent receipts, leaves tax-purpose gross rent undetermined,
  and does not invent withholding credits or tax payments.
- Outstanding balances come from actual due/part-paid charges and the existing
  `outstanding_minor` calculation, including confirmations and recorded
  adjustments. Cancelled/settled charges and future due dates are excluded.
  Only charges due within the selected reporting period are included. Balances
  are current at report generation; the app does not claim to reconstruct a
  historical period-end receivables snapshot. Outstanding amounts never enter
  received income or net rental income.

## Scope and privacy

`POST /api/v1/organizations/<id>/finance/rent-tax-report/` requires a signed-in,
phone-verified Portfolio member with finance access. It reuses the existing
property-assignment rules, includes archived properties and inactive units
within that scope, and does not truncate the export to recent dashboard rows.
Formerly assigned properties and other Portfolios are excluded.

Taxpayer metadata is sent in the authenticated POST body, not URL parameters.
It is not persisted by this endpoint. Responses use `Cache-Control: private,
no-store`. Names, references and notes are escaped against CSV formula injection.
Closing the web form or leaving its Portfolio ignores an outstanding response.

New clients explicitly request `format: "pdf"` by default; the response contains
`filename`, `mime_type: "application/pdf"` and `pdf_base64`. CSV requests use
`format: "csv"` and receive `filename`, `mime_type` and `csv`. Omitting the format
retains CSV compatibility for already installed clients. Optional `property_id`
must belong to the caller's existing financial scope or the request returns 404.
The server's receipt, expense and fee calculations remain unchanged.

## Before filing

Reconcile the schedules with rent receipts and external records. Complete the
taxpayer identity, ownership shares, residency, gross-up for withholding,
certificates, GRA payments, allowable deductions, capital allowances, reliefs and
any other income or adjustments required by the applicable return. A business
may need additional financial statements. Review the refund treatment for the
specific filing period. These reports support preparation; they are not GRA's
official upload format, signed declaration, tax assessment or filing receipt.

## Verification

Commands run for this change:

```powershell
cd web
npm.cmd test
npx.cmd tsc --noEmit
cd ../mobile
npm.cmd test
npm.cmd run typecheck
cd ..
docker compose exec -T api pytest -q tests/integration/test_rent_tax_report.py tests/unit/test_profit_loss.py tests/integration/test_rent.py tests/integration/test_property_portfolio_scope.py
```

Results with PDF export: 562 web tests, 466 mobile tests and 84 backend tests passed;
both TypeScript checks passed. The 11 report tests passed again after pagination
refinement. Backend tests emitted 20 existing missing-staticfiles directory warnings
in the broader run. Changed-file web/mobile lint and backend Ruff checks passed. Native
save/share tests mock the platform APIs; physical-device sharing and signed-in
visual verification still require manual checks.

PDF-specific verification additionally covers default PDF downloads, decoded
bytes/media types, CSV export, native base64 file writing, temporary-file cleanup,
property scope, exact income/cost calculations, waived outstanding balances,
long names and multi-page statement rendering. Generated PDFs are rendered to
PNGs with Poppler for visual review; populated stress cases use only isolated
test-database records, never injected production financial rows.
