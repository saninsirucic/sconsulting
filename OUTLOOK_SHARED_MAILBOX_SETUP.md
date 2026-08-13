# Shared Outlook mailbox setup

The `/api/outlook` API uses Microsoft Graph application permissions for one fixed
mailbox: `sales@s-consulting.ba`. It does not store user OAuth tokens and it does
not change the separate AI email/campaign module.

## Microsoft 365 configuration

Use the preferred **Exchange Application RBAC-only** model:

1. Create or reuse a single-tenant Microsoft Entra application, its enterprise
   application (service principal), and a client credential. Do **not** add
   Microsoft Graph `Mail.ReadWrite` or `Mail.Send` application permissions in
   Entra for this model.
2. Connect to Exchange Online as an authorized administrator and create the
   Exchange pointer to that enterprise application. `ObjectId` below is the
   enterprise application's service-principal Object ID, not the Object ID shown
   on the App registrations page.
3. Create a resource scope that matches only the shared mailbox, then grant the
   two scoped application roles.

```powershell
New-ServicePrincipal -AppId <APPLICATION_CLIENT_ID> -ObjectId <ENTERPRISE_APP_OBJECT_ID> -DisplayName "S Consulting Outlook"
New-ManagementScope -Name "SConsulting-Sales-Mailbox" -RecipientRestrictionFilter "PrimarySmtpAddress -eq 'sales@s-consulting.ba'"
New-ManagementRoleAssignment -Name "SConsulting-Sales-MailReadWrite" -App <ENTERPRISE_APP_OBJECT_ID> -Role "Application Mail.ReadWrite" -CustomResourceScope "SConsulting-Sales-Mailbox"
New-ManagementRoleAssignment -Name "SConsulting-Sales-MailSend" -App <ENTERPRISE_APP_OBJECT_ID> -Role "Application Mail.Send" -CustomResourceScope "SConsulting-Sales-Mailbox"
Test-ServicePrincipalAuthorization -Identity <ENTERPRISE_APP_OBJECT_ID> -Resource sales@s-consulting.ba
```

The final test should report `InScope: True` for both roles. Also test a mailbox
outside this scope and require `InScope: False`. Authorization changes can take
between 30 minutes and two hours to reach Graph caches.

Exchange RBAC assignments and Entra API grants are additive. An unscoped Entra
`Mail.ReadWrite` or `Mail.Send` application grant would therefore bypass this
single-mailbox scope and must not coexist with the RBAC-only configuration. If a
tenant requires the older Entra-grant/Application Access Policy alternative,
that is a separate fallback design and must be independently constrained and
reviewed before use.

Microsoft's authoritative procedure and role list:
[Role Based Access Control for Applications in Exchange Online](https://learn.microsoft.com/en-us/exchange/permissions-exo/application-rbac).

## Backend variables

Set `MICROSOFT_TENANT_ID`, `MICROSOFT_CLIENT_ID`, and
`MICROSOFT_CLIENT_SECRET`. Keep both `OUTLOOK_MAILBOX_ADDRESS` and
`OUTLOOK_ALLOWED_MAILBOXES` equal to `sales@s-consulting.ba`. Production also
needs `JWT_SECRET` or a separate `OUTLOOK_CURSOR_SECRET`.

`OUTLOOK_MAIL_WRITES_ENABLED` defaults to `false`. With that value the inbox,
folders, messages, and attachments are readable, while every modifying action
returns `503 OUTLOOK_WRITES_DISABLED`. Enable it only after Graph permissions,
Exchange scope, mailbox delivery, and recipient testing are verified.

Attachments are JSON base64 and are constrained by the three
`OUTLOOK_MAX_*` variables shown in `.env.example`. Keep the per-file limit below
Microsoft Graph's 3 MB direct-upload boundary. Secrets and message bodies must
never be logged.
