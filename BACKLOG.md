# Backlog

Ideas for later. Nothing here is scheduled.

## Venmo CSV import (for tax records)
Venmo has no API for personal accounts, but it lets you download a monthly statement as CSV (Venmo → Statements). An import screen could:
- read the CSV and pick out payments from the payer,
- match each one to a week, using the "Tempo · week of …" note that the Pay with Venmo button adds, or oldest unpaid week first,
- show the matches for review before recording them.

Most useful together with a yearly income summary for filing taxes: total hours, gross pay and payments received per year, exportable as CSV or PDF.

## Automatic Venmo payment recording
Venmo emails a receipt for every payment received. Cloudflare Email Routing could forward those emails to an Email Worker that records the payment. Needs a custom domain on Cloudflare (workers.dev can't receive email) and breaks if Venmo changes its email format, so only worth it if CSV import isn't enough.
