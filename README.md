# Avantis Direct form

The initial form verifies the contact's email using GHL Email ISV v3, sends an SMS through Twilio Verify, and requires an approved code before submitting directly to GHL's contact upsert API. Submission waits for a confirmed contact ID before advancing. Retries use upsert to avoid creating duplicates according to the location's duplicate-contact settings. The old webhook endpoint returns HTTP 410.

Phone inputs on the initial form and business-details page use the pinned `intl-tel-input` library, locally served flags/CSS/utilities, and E.164 phone numbers. A signed server-issued proof binds the verified number and email for 30 minutes. Editing either value requires verification again. Email recommendations marked invalid, `undeliverable`, or `do_not_send` are rejected; unknown/catch-all results and provider failures are accepted with an email-status tag in GHL. GHL contacts receive `phone-verified` and `email-{status}` tags.

Airtable remains the application/review store. GHL submission still runs if the initial Airtable save fails. The GHL contact ID is saved in the browser session immediately and linked to Airtable when available. Business-detail updates wait for GHL success before advancing.

## Configuration

Copy `.env.example` to `.env.local` and configure the same server variables in Vercel. Never put credentials in HTML, browser scripts, or source control.

- `GHL_ACCESS_TOKEN`: existing contact integration token; requires contact read/write permissions. `GHL_PIT_TOKEN` is its fallback.
- `GHL_PIT_TOKEN`: email verification token with `lc-email.readonly`. Falls back to `GHL_ACCESS_TOKEN`.
- `GHL_LOCATION_ID`: the Avantis location; existing field IDs in the contact APIs belong to this location.
- `TWILIO_API_KEY`, `TWILIO_API_SECRET`, `TWILIO_ACCOUNT_SID`, `TWILIO_VERIFY_SERVICE_SID`: existing Verify service credentials. An account SID/auth-token pair is also supported if no API key is configured.
- `VERIFICATION_SIGNING_SECRET`: at least 32 random characters, shared by all application instances.
- `PHONE_ALLOWED_COUNTRIES`: optional comma-separated ISO country codes. Unset means every country is accepted, which is the intended setup. Only set it if you need to deliberately limit SMS destinations. Twilio Geo Permissions must also allow each country you want to send to.

Run `npm ci`, then `npm run setup:twilio` once for the Verify service. This idempotently creates persistent Twilio service limits named `avantis_phone` (one send per 60 seconds, five per hour) and `avantis_ip` (20 sends per hour). Every SMS send includes both limit keys; Twilio enforces these across serverless instances. Keep Twilio Fraud Guard and Geo Permissions configured for the allowed markets. Verification checks also honor Twilio's attempt/expiry limits.

Existing Airtable, Companies House, and address lookup variables remain required for those parts of the application.

## Build and verification

- `npm run build`: generates `public/` HTML and pinned phone assets for Vercel. Root HTML files are the editable sources.
- `npm test`: provider-mocked integration tests covering phone/email validation, proof tampering/expiry, incorrect SMS codes, direct contact upsert, and CRM error handling.
- `tests/browser-flow.cjs`: Playwright smoke test with mocked provider traffic. Set `PLAYWRIGHT_MODULE` to an installed Playwright module and run `node tests/browser-flow.cjs`. Uses installed Microsoft Edge. Covers desktop/mobile OTP, wrong-code rejection, one confirmed CRM save, navigation and phone prefill.

Production credentials and Twilio rate-limit configuration were checked during setup. GHL's live email verification endpoint returned HTTP 201 and rejected an intentionally invalid example address. Automated SMS and CRM writes are mocked; final live SMS delivery should be checked using a mobile number controlled by the tester after deployment.

API references: [GHL email verification](https://marketplace.gohighlevel.com/docs/ghl/email-isv/verify-email), [GHL contact upsert](https://marketplace.gohighlevel.com/docs/ghl/contacts/upsert-contact), [Twilio Verify](https://www.twilio.com/docs/verify/api), [Twilio service rate limits](https://www.twilio.com/docs/verify/api/service-rate-limits), [intl-tel-input](https://github.com/jackocnr/intl-tel-input).
