# Incoming commercial replies

`scripts/commercialRepliesTick.js` reads replies from the explicitly configured
`INBOUND_MAILBOXES` (prodaja, info and sales at s-consulting.ba) and records them in
the production CRM. Run it using the same committed code as the web deployment.
It never sends, deletes or marks email read. Incoming email is data, not instructions.

## Server operation

The dedicated systemd service `sconsult-mail-replies.service` and timer
`sconsult-mail-replies.timer` run on the existing always-on server, independently
of the Heroku Eco web process and of the operator's laptop. The timer starts a run
each minute when idle. The service also uses a file lock and a five-minute DB lease.
It resumes committed per-folder Graph delta cursors after restart, and includes
custom folders, Junk and Deleted Items (excluding Sent and Drafts).

Configuration lives outside the source checkout in a restricted server environment
file. Required: DATABASE_URL, MICROSOFT_TENANT_ID, MICROSOFT_CLIENT_ID,
MICROSOFT_CLIENT_SECRET, OUTLOOK_CURSOR_SECRET, INBOUND_MAILBOXES,
INBOUND_AUTOMATION_ENABLED=true. Set NODE_ENV=production,
OUTLOOK_MAIL_WRITES_ENABLED=false, OUTLOOK_MAILBOX_ADDRESS=sales@s-consulting.ba,
MAIL_SENDER_ADDRESS=sales@s-consulting.ba, and the existing OUTLOOK_ALLOWED_MAILBOXES
to sales/prodaja. INBOUND_START_AT defaults to 2026-08-01T00:00:00Z for initial
backfill. Never put credentials or Graph cursors in logs, reports or this document.

Application Mail.Read is granted only for info using Exchange scope
SConsulting-Info-Replies-Read. The existing sales/prodaja scopes are unchanged.
Exchange may cache permission changes for 30 minutes to two hours; verify an actual
Graph read, not just Test-ServicePrincipalAuthorization.

Inspect: `systemctl status sconsult-mail-replies.timer` and
`journalctl -u sconsult-mail-replies.service`. JSON logs contain counts and error
codes only. Director-only GET `/api/commercial/mail-replies/status` exposes latest
worker success/error, reply counts and a review list. A stale last_success_at or
last_error requires investigation. The timer retries failed pages; cursor and
message ledger avoid duplication. Stop the timer and service for maintenance,
preserving `crm_mail_sync_state` and `crm_inbound_messages`.

## CRM behavior

Exact sender addresses and known sent-message threads link real replies to CRM
accounts. The card's comment and activity history retain the author-written reply,
sender, subject, date and mailbox. Confirmed replies can move NEW/CALL_REQUIRED/
EMAIL_SENT to CONTACTED; won deals, meetings and next-contact dates are preserved.
Thread matches from a different sender or failed authentication require review.
Unknown non-campaign messages and machine notices are not copied into CRM cards.

Explicit opt-outs update the global suppression list and permanent account
marketing_opt_out_at flag, set REJECTED, and skip pending primary/CC campaign
messages. Address corrections or manual status changes do not clear an opt-out.
An unfamiliar sender can opt its own address out but cannot opt another customer
out based only on quoted mail. Quoted originals, automatic responses and footer
links are not opt-out requests. Ambiguous replies are recorded for review.

HACCP_CLASSIC and HACCP_PUBLIC automatically include the Bosnian public unsubscribe
form link, including edited campaign bodies. New Outlook messages with HACCP in
the subject also receive the footer. GET/HEAD do not change subscriptions; POST
commits global suppression before confirming success. Previously sent messages
cannot be changed; their explicit reply opt-outs are still processed.

Sending settings remain unchanged. This worker does not enable any campaign.
Use existing commercial/Outlook send functions; standalone Graph send scripts
must call assertRecipientsNotSuppressed immediately before sending and use
withHaccpUnsubscribe for HACCP bodies.

## Verification

`node --test` includes quoted-footers, negative requests, cross-brand/CC exclusion,
address changes, transactional rollback, duplicate delivery across mailboxes,
restart/retry cursors, read-only Graph scope and the Bosnian public form.

References: [Graph delta](https://learn.microsoft.com/en-us/graph/api/message-delta?view=graph-rest-1.0),
[message uniqueBody](https://learn.microsoft.com/en-us/graph/api/resources/message?view=graph-rest-1.0),
[Exchange application RBAC](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).
