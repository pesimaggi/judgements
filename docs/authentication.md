# Authentication: email codes through Clerk, with public research

## What is implemented

Search, filters, sorting, legal-source navigation, document/act readers and the
well remain public. Nothing checks a plan, balance or usage allowance.

The header offers **Skrá inn** and **Vistað**. The former disabled save placeholder
is now **Vista**, on search results and in the judgment reader. Anonymous users
can click it: a small Icelandic dialog opens, and the original document is saved
after Clerk activates the session. **Vistað** opens the saved-judgment list;
saved items can also be removed. Folders, saved searches and other future account
features have not been built.

The initial rollout is **email only**: enter an email address, receive a one-time
code, and enter the code. There are no passwords or Google/Microsoft buttons.
Clerk's prebuilt components handle verification, errors, resend timers and account
management using the site's navy/stone palette and fonts. `SignIn` uses
`withSignUp` and `transferable`, so new and returning users use the same screen.
The available methods come from Clerk's dashboard; disable social connections
there rather than merely hiding their buttons in CSS.

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
3. In **SSO connections**, leave **Microsoft**, **Google** and other social
   providers disabled. No Google Cloud or Microsoft Entra application is needed.
   Also leave phone authentication and other sign-in methods disabled.
4. Keep sign-up public and use a single active session. Do not enable a waitlist,
   organisation requirement or mandatory account-setup task. No Google One Tap
   banner is mounted by the application.
5. Set application URLs to the actual application origin: home `/`, sign-in
   `/sign-in`, sign-up `/sign-up`. Both authentication routes are hosted in this
   app; `/sign-up` exists for Clerk's new-user transfer and is not a separate
   navigation choice. Do not configure global forced redirects to `/`: the
   components supply the original page for both sign-in and sign-up.
6. Keep Clerk as the owner of identities and verified email addresses. Signing
   in again with the same email returns to the same Clerk account. Do not
   implement email-based merging in Postgres. Social login can be added later
   using Clerk's normal account-linking safeguards.

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

Local example: `CLERK_AUTHORIZED_PARTIES=http://localhost:3000`. For a Railway
test deployment, use `https://judgements-production.up.railway.app`. Production example:
`https://your-domain.is,https://www.your-domain.is` (only include origins actually
serving this application). Supply this in production because the server may see
Railway's internal proxy URL rather than the public origin. Never use a wildcard.

Set both Clerk keys **before** building. Next.js embeds the publishable key into
the browser bundle, so switching keys requires a rebuild, not just a restart.
The code sets the sign-in/sign-up paths; no additional redirect environment
variables are needed. No Google or Microsoft credentials are needed for email login.

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

## Testing on the current Railway URL

Email-only login avoids configuring Google and Microsoft, but **does not remove
Clerk's production-domain requirement**. Development keys can be used on the
Railway-generated hostname for a test deployment. Clerk development instances
are not intended for a public production service: they have a 100-user cap and
development email branding, and their users do not transfer to a production
instance. These are provider constraints, not limits implemented in Lögbrunnur.

Use disposable accounts for this stage. Do not activate a development instance
as the long-term home for testers' meaningful bookmarks. If development accounts
already have bookmarks when moving to production, preserve those rows and arrange
an explicit, verified identity mapping before switching instances; never silently
reassign ownership from a browser-supplied email. No automatic cross-instance
migration is implemented.

For the public launch with Clerk, use an owned domain and live keys even if email
remains the only login method. The code does not require enabling social login.
Google and Microsoft are deferred; adding them later should use Clerk's normal
provider configuration and verified account linking without replacing local IDs.

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

The email-code dialog uses virtual routing to leave the current page in place.
A tab-local, 30-minute continuation also records the action, local return
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

- Configure the Clerk instance for email codes only, with passwords and social
  connections disabled.
- Configure the owned domain/DNS and live Clerk keys. No Google/Microsoft
  callback or client-secret setup is needed for this rollout.
- Back up the database and apply the additive table setup, or review/run the
  normal non-destructive `db:deploy` pre-deploy step.
- Rebuild/deploy with the matching keys and exact authorized origins.
- With **email codes**, test a new and a returning user: search → filter/sort/page → open judgment → Vista → authenticate → one
  saved item, same page/query/anchor, no second click.
- Test invalid/expired email codes, resend, closing the login dialog, logout,
  expired sessions and retry after a failed save.
- Verify repeat email login retains the same Clerk ID and bookmarks. Verify a
  second person cannot read or remove the first person's bookmarks, including
  after switching accounts in the same browser.
- Repeat anonymous search and readers, and check a second device sees the saved
  item after login. Do not release an unverified provider configuration.

Live email delivery, new/returning email-code sign-in, production migration and
deployment remain manual validation steps until credentials and dashboard access
are supplied. Microsoft and Google are not required for this rollout.
