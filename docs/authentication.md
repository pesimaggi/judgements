# Authentication: Clerk, with public research

## What is implemented

Search, filters, sorting, legal-source navigation, document/act readers and the
well remain public. Nothing checks a plan, balance or usage allowance.

The header offers **Skrá inn** and **Vistað**. The former disabled save placeholder
is now **Vista**, on search results and in the judgment reader. Anonymous users
can click it: a small Icelandic dialog opens, and the original document is saved
after Clerk activates the session. **Vistað** opens the saved-judgment list;
saved items can also be removed. Folders, saved searches and other future account
features have not been built.

Clerk's prebuilt components handle the verification flow, errors, resend timers,
OAuth transfers and account management. They inherit the site's navy/stone
palette and fonts. `SignIn` uses `withSignUp` and `transferable` so new and existing
users enter through the same screen. Microsoft is ordered before Google.
Dashboard configuration below is required to make these the available methods.

The SDK is `@clerk/nextjs` 6.39.7 or a compatible v6 patch, matching the existing
Next.js 14/React 18 application. A migration to Next.js 15+ is not required for
this change. Clerk Core 3 examples using SDK v7 are not drop-in replacements.

## Clerk dashboard setup

1. Create an application named **Lögbrunnur**. Start with its development instance
   for local/staging verification; production uses a separate instance and keys.
2. In **User & authentication**, enable email sign-up and sign-in. Require email
   verification, selecting **Email verification code** both for registration
   verification and passwordless sign-in. Disable passwords and email links for
   this configuration. Do not require username, phone number, name or organisation.
3. In **SSO connections**, add **Microsoft** and **Google**, each **For all users**,
   enabled for both sign-up and sign-in. Disable other providers if present.
   Development instances can use Clerk's shared provider credentials; production
   needs the custom provider credentials described below.
4. Keep sign-up public and use a single active session. Do not enable a waitlist,
   organisation requirement or mandatory account-setup task. No Google One Tap
   banner is mounted by the application.
5. Set application URLs to the actual application origin: home `/`, sign-in
   `/sign-in`, sign-up `/sign-up`. Both authentication routes are hosted in this
   app; `/sign-up` exists for Clerk's new-user transfer and is not a separate
   navigation choice. Do not configure global forced redirects to `/`: the
   components supply the original page for both sign-in and sign-up.
6. Keep Clerk's normal verified-email account-linking safeguards enabled.
   Do not implement email-based merging in Postgres. Matching verified addresses
   can link automatically; different addresses require the user to connect an
   additional account in **Aðgangur**, where Clerk verifies ownership.

Configure the verification email's branding/language in Clerk as desired. The
application's Icelandic UI does not itself translate email templates. Clerk sends
the code: no SMTP service, password, reset token or email-code table is added here.

References: [authentication options](https://clerk.com/docs/guides/configure/auth-strategies/sign-up-sign-in-options),
[combined sign-in](https://clerk.com/docs/nextjs/reference/components/authentication/sign-in),
[account linking](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/account-linking).

## Environment variables and domains

| Variable | Value | Where |
|---|---|---|
| `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | Clerk's `pk_test_…` or `pk_live_…` | Build and runtime |
| `CLERK_SECRET_KEY` | Matching instance's `sk_test_…` or `sk_live_…` | Server environment only; never a `NEXT_PUBLIC_` variable |
| `CLERK_AUTHORIZED_PARTIES` | Comma-separated exact application origins, no trailing slash | Server environment; also the allowed Origin list for private writes |
| `DATABASE_URL` | Existing Postgres connection | Already configured; keep it |

Local example: `CLERK_AUTHORIZED_PARTIES=http://localhost:3000`. Production example:
`https://your-domain.is,https://www.your-domain.is` (only include origins actually
serving this application). Supply this in production because the server may see
Railway's internal proxy URL rather than the public origin. Never use a wildcard.

Set both Clerk keys **before** building. Next.js embeds the publishable key into
the browser bundle, so switching keys requires a rebuild, not just a restart.
The code sets the sign-in/sign-up paths; no additional redirect environment
variables are needed. Google/Microsoft client secrets belong in Clerk, not Railway.

Inspection on 22 September 2026 found Railway's `judgements` service in project
`brave-reflection`, production environment, deploying `main`, with only the
Railway-generated domain `judgements-production.up.railway.app` and no Clerk keys.
No service variables, production data or deployment settings were changed.

For a Clerk production instance, choose a domain whose DNS you control, connect
it to Railway, and add/verify the CNAME records shown by Clerk. A generated Railway
hostname does not give you control of the required Clerk subdomain's DNS. Verify
DNS and certificates before switching to live keys. Development and production
Clerk identities are separate; use distinct test data rather than treating test
instance IDs as production IDs.

Reference: [Clerk environments](https://clerk.com/docs/guides/development/managing-environments).

## Google configuration

1. In Google Cloud, create/select a project and configure the OAuth consent screen
   for Lögbrunnur, including the application domain and required contact details.
2. Create an OAuth client of type **Web application**. Add the site's actual
   origins under **Authorized JavaScript origins**.
3. Copy **Authorized Redirect URI** from Clerk's Google connection into Google's
   authorized redirect URIs exactly. It is Clerk's callback, not `/sign-in` on
   the Lögbrunnur site.
4. Put the Google client ID and secret into Clerk's Google connection under
   **Use custom credentials**. Request only the normal identity scopes; no Drive,
   Gmail or other Google data is needed.
5. While testing, add required test users. Before public launch, switch the OAuth
   application's publishing status to **In production** and complete any Google
   verification required for its branding/scopes.

Reference: [Clerk's Google setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/google).

## Microsoft Entra configuration

1. In Microsoft Entra ID → **App registrations**, register Lögbrunnur. Select
   **Accounts in any organizational directory and personal Microsoft accounts**,
   so work/school accounts and Outlook/Hotmail accounts are supported.
2. Add a **Web** redirect URI using the exact callback shown in Clerk's Microsoft
   connection, not the site's `/sign-in` route.
3. Copy the **Application (client) ID**. Create a client secret and copy its
   **Value**, not its secret ID, into Clerk with the client ID.
4. Follow Clerk's current linked OpenID settings and `xms_edov` verified-email
   claim instructions. Do not remove its email-verification safeguards to make
   account linking easier. No mail/calendar API access is required.
5. Record the secret's expiry and rotate it in Entra and Clerk before it expires.
   Test both a personal Microsoft account and a work/school account. Some tenant
   administrators restrict third-party app consent; that is a tenant policy,
   not something Lögbrunnur should bypass.

Reference: [Clerk's Microsoft Entra setup](https://clerk.com/docs/guides/configure/auth-strategies/social-connections/microsoft).

## Application data and existing testers

Inspection of the repository found no authentication implementation, user table,
passwords, sessions, saved judgments, saved searches or collections. The only
account-shaped action was a disabled save placeholder. Browser-local help, scope
and progress preferences are untouched; anonymous AI feedback records are
untouched. There is no existing identity migration or speculative email matching.
This conclusion is based on application code/schema; production SQL rows were
not available through the connected Railway tools.

The only new table is `saved_documents`: Clerk user ID, document ID and creation
time. Its compound primary key prevents duplicate saves. The server derives the
owner from `auth()` on every protected request, never from a browser field.
All reads/deletes are owner-scoped, writes check their origin, and private responses
are `no-store`. There is no local user-profile mirror or webhook requirement.

For an existing database, `npm run db:setup-auth` creates only this table and its
index with additive SQL and is safe to rerun. Fresh installs can use `db:push`.
The existing Railway `db:deploy` command also creates the table through Prisma;
its unconditional `--accept-data-loss` has been removed. If deployment reports
unrelated schema drift, review it; do not re-enable that flag to get past it.
No database command was run against production during implementation.

If an operator discovers accounts in an out-of-repository legacy system, preserve
them and establish verified ownership before associating data with Clerk IDs.
Do not infer ownership from an unverified browser-supplied email. When deleting a
Clerk account, also delete that user's `saved_documents` rows through a trusted
operator procedure; automated cross-system account-deletion cleanup is not built.

## Continuing an action

`useAppAuth().run({ type: "save-document", documentId })` is the reusable entry
point. Future actions add a typed intent and executor, plus a server-authenticated
endpoint. Do not queue arbitrary browser-supplied API URLs or user identities.

The modal uses virtual routing and OAuth popups to leave the current page in
place. A tab-local, 30-minute continuation also records the action, local return
URL, anchor, scroll and current search filters/draft/page (or reader search).
It survives a redirect/reload. Dismissal clears it; successful writes clear it;
failed writes offer a retry. A write initiated by an existing account is not
replayed into a different account. Safe URL validation prevents external return
destinations. View state is never used as server authorization.

## Validation and production checklist

Automated checks are `npm run typecheck`, `npm test`, `npm run build`,
`npm run eval:ask`, and `npm run test:browser`. Install a browser once with
`npx playwright install chromium`. Browser tests expect a build without Clerk
keys, use fixture legal data and hit real unauthenticated route handlers. The
component tests simulate Clerk session activation; they do not prove provider
credentials or code delivery. In restricted runtimes the equivalent offline
evaluation command is `node --import tsx src/ask-eval/run.ts`.

Before production activation:

- Configure the Clerk instance, passwordless email, Google and Microsoft above.
- Configure the owned domain/DNS, production provider callbacks and live keys.
- Back up the database and apply the additive table setup, or review/run the
  normal non-destructive `db:deploy` pre-deploy step.
- Rebuild/deploy with the matching keys and exact authorized origins.
- For **each** of Microsoft, Google and email code, test a new and a returning
  user: search → filter/sort/page → open judgment → Vista → authenticate → one
  saved item, same page/query/anchor, no second click.
- Test invalid/expired email codes, resend, cancelled OAuth, denied consent,
  logout, expired sessions and retry after a failed save.
- Verify same-email linking retains the same Clerk ID and bookmarks. Verify a
  second person cannot read or remove the first person's bookmarks, including
  after switching accounts in the same browser.
- Repeat anonymous search and readers, and check a second device sees the saved
  item after login. Do not release an unverified provider configuration.

Live OAuth, email delivery, account linking, production migration and deployment
remain manual validation steps until credentials and dashboard access are supplied.
