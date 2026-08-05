# Requirements Document

## Introduction

ArogyaDiet ships two Capacitor-built Android applications — a Customer app and a Rider app. The client has no Google Play developer account, so both applications must be distributed as directly downloadable APK files that end users sideload manually. Manually forwarding APK files to each user is not acceptable.

This feature introduces a self-service distribution surface: two publicly accessible download pages inside the customer portal (`/app/customer` and `/app/rider`), APK binaries hosted in a private Supabase Storage bucket rather than in the git repository, a per-app release manifest that records the current version, a Cloudflare Turnstile challenge that must be passed before a download link is issued, and server-rendered QR codes shown on the Customer and Rider login pages for large viewports only.

The feature is read-only with respect to application data. It introduces no database tables, no Server Actions, and no authenticated behavior. Its primary risks are access-control (the existing middleware would today redirect anonymous and non-Customer traffic away from `/app/*`), cache-staleness (a fixed APK filename would let CDNs serve an outdated binary), bandwidth abuse (an openly addressable APK URL can be scraped and hotlinked at will), and information disclosure (the APK contents are readable by anyone who obtains the binary).

Scope boundary: this feature covers distribution only. Building, signing, and uploading the APK files are operator activities performed outside the application; requirements about them are stated as verifiable release constraints, not as automated system behavior.

### Design decisions carried into these requirements

These decisions were settled during requirements review and constrain the criteria below:

- **The Release_Bucket is private, not public.** A publicly readable bucket makes the Turnstile challenge decorative: a client that obtains the storage URL once can re-fetch the binary indefinitely without ever presenting a token. Anonymous read is therefore denied at the bucket, and every download is served through a time-limited Signed_Download_URL minted server-side.
- **There is no anonymous download redirect.** An open `GET` route that 302s to the binary is a complete bypass of the challenge. The stable, shareable, QR-encoded URL is the Download_Page itself; release-to-release stability is provided by the Release_Manifest indirection inside the Download_Grant_Endpoint.
- **The challenge gates the download, not the page HTML.** Rendering the Download_Page is unconditional. Gating the HTML behind an interstitial would cost every legitimate visitor a round trip before they can see what they are installing, while protecting a response that carries no value. The asset worth protecting is the APK bytes.
- **The second protection layer is rate limiting, not a second challenge.** Turnstile establishes that a human is present at the moment of request; a Download_Rate_Limit on the Download_Grant_Endpoint bounds how much bandwidth any single origin can draw even when it presents valid tokens. Two independent controls on the same endpoint, rather than the same control applied twice.
- **The download control requires client JavaScript.** The Turnstile widget is a client-side script, so the download control is a Client Component. This is a deliberate, contained exception; the QR codes and all page content remain server-rendered.

## Glossary

- **Download_Page**: A publicly accessible React Server Component page that presents one Android application for download. Two instances exist: the Customer Download_Page at path `/app/customer` and the Rider Download_Page at path `/app/rider`, both served on the `customer` subdomain.
- **App_Slug**: The identifier distinguishing the two applications. Permitted values are exactly `customer` and `rider`.
- **Release_Bucket**: The private Supabase Storage bucket named `app-releases` that holds all APK objects and Release_Manifest objects.
- **APK_Object**: A signed Android application package stored in the Release_Bucket at `app-releases/{App_Slug}/arogyadiet-{App_Slug}-v{semver}.apk`.
- **Release_Manifest**: A JSON object stored in the Release_Bucket at `app-releases/{App_Slug}/latest.json` that describes the currently published release of one application.
- **Manifest_Parser**: The module that reads Release_Manifest JSON text and produces a validated Release_Manifest value, or an error.
- **Manifest_Serializer**: The module that converts a validated Release_Manifest value back into Release_Manifest JSON text.
- **Turnstile_Widget**: The Cloudflare Turnstile client-side widget rendered on the Download_Page, which produces a Turnstile_Token when its challenge is satisfied.
- **Turnstile_Token**: The single-use response token issued by the Turnstile_Widget and submitted to the Download_Grant_Endpoint.
- **Turnstile_Site_Key**: The public Turnstile key, read from the environment variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
- **Turnstile_Secret_Key**: The private Turnstile key, read from the server-only environment variable `TURNSTILE_SECRET_KEY`.
- **Siteverify_Service**: The Cloudflare endpoint `https://challenges.cloudflare.com/turnstile/v0/siteverify`, which validates a Turnstile_Token against the Turnstile_Secret_Key.
- **Token_Verifier**: The server-side module that submits a Turnstile_Token to the Siteverify_Service and returns a verification outcome.
- **Download_Grant_Endpoint**: The public route handler at `/api/app-download/grant` that accepts an App_Slug and a Turnstile_Token, and returns a Signed_Download_URL when verification and rate limiting both pass.
- **Signed_Download_URL**: A time-limited Supabase Storage signed URL authorizing a single client to retrieve one APK_Object.
- **Signed_URL_TTL**: The validity period of a Signed_Download_URL, set to 120 seconds.
- **Download_Rate_Limit**: The per-client-IP ceiling on successful Download_Grant_Endpoint responses, set to 5 grants per 10-minute window per App_Slug.
- **Download_Control**: The Client Component on the Download_Page that renders the Turnstile_Widget, calls the Download_Grant_Endpoint, and initiates the browser download.
- **QR_Block**: A server-rendered presentation unit containing a title, an inline SVG QR code encoding a Download_Page URL, and the same URL rendered as plain text.
- **QR_Generator**: The server-side module that produces inline SVG QR code markup for a given URL using the `qrcode` npm package.
- **Download_Base_URL**: The absolute origin used to construct Download_Page URLs for QR encoding, read from the environment variable `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL`.
- **Portal_Middleware**: The existing request middleware in `src/middleware.ts` that performs subdomain-to-portal rewriting, unauthenticated redirection, and per-portal role gating.
- **Public_Path_Allowlist**: The set of path prefixes in Portal_Middleware that an unauthenticated request is permitted to reach without redirection to `/login`. It currently contains `/login`, `/signup`, `/auth`, `/forgot-password`, and `/update-password`.
- **Customer_Portal_Gate**: The Portal_Middleware branch that runs when the request subdomain is `customer` and a session exists, and that redirects to `/unauthorized` unless the session maps to role `CUSTOMER` with exactly one Customer_Record whose onboarding status is `IN_PROGRESS` or `COMPLETED`.
- **Semver_String**: A version string of the form `MAJOR.MINOR.PATCH` where each part is a non-negative integer without leading zeros.
- **Android_Media_Type**: The HTTP content type `application/vnd.android.package-archive`.
- **Install_Guide**: The on-page, step-by-step instructions describing how to sideload an APK_Object on Android, including the unknown-sources permission prompt and the Google Play Protect warning screen.
- **Large_Viewport**: A viewport at or above the Tailwind CSS `lg` breakpoint.
- **Signing_Keystore**: The Android signing keystore used to sign APK_Objects.

## Requirements

### Requirement 1: Publicly Accessible Download Pages

**User Story:** As a prospective Customer or Rider, I want to open an app download page without logging in, so that I can install the mobile application before I have any account or session.

#### Acceptance Criteria

1. WHEN an anonymous visitor requests `/app/customer` on the `customer` subdomain, THE Download_Page SHALL respond with HTTP 200 and render the Customer app download content.
2. WHEN an anonymous visitor requests `/app/rider` on the `customer` subdomain, THE Download_Page SHALL respond with HTTP 200 and render the Rider app download content.
3. THE Download_Page SHALL render as a React Server Component located at `src/app/customer/(public)/app/{App_Slug}/page.tsx`.
4. THE Download_Page SHALL render identical content for an anonymous visitor and for an authenticated visitor of any role.
5. THE Download_Page SHALL exclude all authenticated user data, session identifiers, and personally identifiable information from the rendered response.
6. WHEN a visitor requests a path under `/app/` whose App_Slug is neither `customer` nor `rider`, THE Download_Page SHALL respond with HTTP 404.
7. THE Download_Page SHALL render its content without requiring the visitor to satisfy the Turnstile_Widget first.

### Requirement 2: Middleware Access Exemptions for the Public App Paths

**User Story:** As a prospective user, I want the download links and QR codes to work regardless of my login state or role, so that scanning a code never lands me on a login screen or an access-denied screen.

#### Acceptance Criteria

1. THE Portal_Middleware SHALL include the path prefix `/app` in the Public_Path_Allowlist.
2. WHEN an unauthenticated request targets a path beginning with `/app/`, THE Portal_Middleware SHALL allow the request to proceed to the Download_Page without redirecting to `/login`.
3. WHEN an authenticated request targets a path beginning with `/app/` on the `customer` subdomain, THE Portal_Middleware SHALL bypass the Customer_Portal_Gate and allow the request to proceed.
4. WHEN an authenticated request whose role code is `ADMIN`, `RIDER`, `MASTER_ADMIN`, or `FRANCHISE_ADMIN` targets a path beginning with `/app/` on the `customer` subdomain, THE Portal_Middleware SHALL respond with the Download_Page rather than a redirect to `/unauthorized`.
5. WHEN an authenticated request targets a path beginning with `/app/`, THE Portal_Middleware SHALL leave the request path unchanged apart from the existing `/customer` portal rewrite.
6. THE Portal_Middleware SHALL restrict the authenticated-user landing redirect to the exact paths `/`, `/login`, and `/signup`, so that paths beginning with `/app/` are not redirected to a portal landing route.
7. THE Portal_Middleware SHALL leave requests to the Download_Grant_Endpoint unaffected, by way of its existing early return for paths beginning with `/api`.
8. THE Portal_Middleware SHALL preserve its existing behavior for every path that does not begin with `/app`.

### Requirement 3: Private APK Storage in Supabase Storage

**User Story:** As a maintainer, I want APK binaries in a private Supabase Storage bucket instead of the git repository, so that the repository stays small and the binaries cannot be fetched without passing our challenge.

#### Acceptance Criteria

1. THE Release_Bucket SHALL be a Supabase Storage bucket named `app-releases`.
2. THE Release_Bucket SHALL be configured as private.
3. WHEN an anonymous client requests an APK_Object by its unsigned storage URL, THE Release_Bucket SHALL deny the request.
4. WHEN an anonymous client attempts an insert, update, or delete operation on the Release_Bucket, THE Release_Bucket SHALL deny the operation.
5. WHEN a client authenticated with the service role key performs a read, insert, update, or delete operation on the Release_Bucket, THE Release_Bucket SHALL permit the operation.
6. WHEN a client presents a valid, unexpired Signed_Download_URL for an APK_Object, THE Release_Bucket SHALL serve that APK_Object.
7. THE Release_Bucket SHALL store the Customer APK_Object at object path `customer/arogyadiet-customer-v{semver}.apk`.
8. THE Release_Bucket SHALL store the Rider APK_Object at object path `rider/arogyadiet-rider-v{semver}.apk`.
9. THE Release_Bucket SHALL store each APK_Object with the content type Android_Media_Type.
10. THE Release_Bucket SHALL store one Release_Manifest per App_Slug at object path `{App_Slug}/latest.json`.
11. THE Release_Bucket SHALL expose no object other than APK_Objects and Release_Manifests.

### Requirement 4: Release Manifest Format and Parsing

**User Story:** As a maintainer, I want each app's current release described by a small JSON manifest, so that publishing a new version is an upload plus a manifest edit with no code change and no redeployment.

#### Acceptance Criteria

1. THE Release_Manifest SHALL contain the fields `version`, `filename`, `size`, `sha256`, `releasedAt`, and `whatsNew`.
2. THE Release_Manifest SHALL express `version` as a Semver_String.
3. THE Release_Manifest SHALL express `size` as a non-negative integer count of bytes of the APK_Object.
4. THE Release_Manifest SHALL express `sha256` as a 64-character lowercase hexadecimal string.
5. THE Release_Manifest SHALL express `releasedAt` as an ISO 8601 timestamp with an explicit UTC offset.
6. WHEN the Manifest_Parser receives Release_Manifest JSON text in which all six fields are present and each field satisfies its stated format, THE Manifest_Parser SHALL return a validated Release_Manifest value.
7. IF the Manifest_Parser receives text that is not valid JSON, THEN THE Manifest_Parser SHALL return an error identifying the input as malformed JSON.
8. IF the Manifest_Parser receives JSON in which a required field is absent or violates its stated format, THEN THE Manifest_Parser SHALL return an error naming the offending field.
9. THE Manifest_Serializer SHALL convert a validated Release_Manifest value into Release_Manifest JSON text that the Manifest_Parser accepts.
10. FOR ALL validated Release_Manifest values, parsing the output of the Manifest_Serializer SHALL produce a Release_Manifest value equal to the input value (round-trip property).
11. FOR ALL Release_Manifest JSON text accepted by the Manifest_Parser, serializing then re-parsing SHALL produce a Release_Manifest value equal to the first parse result (round-trip property).

### Requirement 5: Turnstile Challenge on the Download Page

**User Story:** As a maintainer, I want a bot check in front of the download action, so that scrapers and bandwidth abusers cannot pull our APK binaries in bulk.

#### Acceptance Criteria

1. THE Download_Control SHALL render the Turnstile_Widget on the Download_Page.
2. THE Download_Control SHALL configure the Turnstile_Widget with the Turnstile_Site_Key.
3. THE Download_Control SHALL never expose the Turnstile_Secret_Key to the client.
4. WHILE no Turnstile_Token has been obtained, THE Download_Control SHALL present the download control in a disabled state.
5. WHEN the Turnstile_Widget yields a Turnstile_Token, THE Download_Control SHALL enable the download control.
6. WHEN the visitor activates the enabled download control, THE Download_Control SHALL submit the App_Slug and the Turnstile_Token to the Download_Grant_Endpoint.
7. WHEN the Download_Grant_Endpoint returns a Signed_Download_URL, THE Download_Control SHALL initiate the browser download from that URL.
8. IF the Turnstile_Widget reports that its challenge failed, THEN THE Download_Control SHALL display a retry message and keep the download control disabled.
9. IF the Turnstile_Widget reports that its Turnstile_Token expired, THEN THE Download_Control SHALL discard the token, reset the widget, and return the download control to its disabled state.
10. IF the Turnstile_Widget script cannot be loaded, THEN THE Download_Control SHALL display a message stating the verification step is unavailable and instructing the visitor to retry later.
11. WHERE the visitor has JavaScript disabled, THE Download_Page SHALL display a message stating that JavaScript is required to verify the download request.
12. IF the environment variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is absent or empty, THEN THE Download_Page SHALL suppress the download control, display a notice that downloads are temporarily unavailable, and record a server-side warning.
13. THE Turnstile_Widget SHALL be operable by keyboard alone.
14. THE Download_Control SHALL announce each verification state change to assistive technologies.

### Requirement 6: Server-Side Token Verification and Download Grant

**User Story:** As a maintainer, I want the APK URL issued only after our server has confirmed the challenge token with Cloudflare, so that a forged or replayed token yields nothing.

#### Acceptance Criteria

1. THE Download_Grant_Endpoint SHALL accept only the HTTP POST method.
2. WHEN the Download_Grant_Endpoint receives a request, THE Token_Verifier SHALL submit the supplied Turnstile_Token and the Turnstile_Secret_Key to the Siteverify_Service before any Signed_Download_URL is created.
3. THE Token_Verifier SHALL include the originating client IP address in its submission to the Siteverify_Service.
4. WHEN the Siteverify_Service reports the Turnstile_Token as valid, THE Download_Grant_Endpoint SHALL read the Release_Manifest for the requested App_Slug and create a Signed_Download_URL for the APK_Object named by the manifest `filename` field.
5. THE Download_Grant_Endpoint SHALL create each Signed_Download_URL with a validity period of Signed_URL_TTL.
6. THE Download_Grant_Endpoint SHALL respond with HTTP 200 and a body containing the Signed_Download_URL, the manifest `version`, and the manifest `filename` on success.
7. IF the Siteverify_Service reports the Turnstile_Token as invalid, expired, or already redeemed, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 403 and create no Signed_Download_URL.
8. IF the request omits the Turnstile_Token, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 400 and create no Signed_Download_URL.
9. IF the requested App_Slug is neither `customer` nor `rider`, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 400 and create no Signed_Download_URL.
10. IF the Siteverify_Service is unreachable or returns a malformed response, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 503 and create no Signed_Download_URL.
11. IF the Release_Manifest for the requested App_Slug cannot be retrieved, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 503 and a message stating the download is temporarily unavailable.
12. IF the Manifest_Parser rejects the retrieved Release_Manifest, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 503 and a message stating the download is temporarily unavailable.
13. THE Download_Grant_Endpoint SHALL require no authenticated session.
14. THE Download_Grant_Endpoint SHALL exclude the Turnstile_Secret_Key, the service role key, and raw Siteverify_Service payloads from every response body it returns.
15. THE Download_Grant_Endpoint SHALL keep its own path unchanged across releases.
16. WHEN the Release_Manifest `version` changes, THE Download_Grant_Endpoint SHALL resolve to the APK_Object of the new version without a code change or a redeployment.
17. THE system SHALL expose no route that serves an APK_Object without a prior successful Turnstile_Token verification.

### Requirement 7: Download Rate Limiting

**User Story:** As a maintainer, I want a ceiling on how many download grants one origin can obtain, so that a client presenting valid tokens still cannot drain our storage bandwidth.

#### Acceptance Criteria

1. THE Download_Grant_Endpoint SHALL count successful grants per client IP address per App_Slug.
2. WHEN a client IP address has received Download_Rate_Limit successful grants for one App_Slug within the current window, THE Download_Grant_Endpoint SHALL respond with HTTP 429 to further requests for that App_Slug from that address.
3. THE Download_Grant_Endpoint SHALL include a `Retry-After` header stating the remaining window duration in every HTTP 429 response it returns.
4. WHEN the rate-limit window elapses, THE Download_Grant_Endpoint SHALL again grant requests from the previously limited client IP address.
5. THE Download_Grant_Endpoint SHALL apply the Download_Rate_Limit after Turnstile_Token verification succeeds.
6. THE Download_Grant_Endpoint SHALL derive the client IP address from the trusted forwarding header set by the hosting platform.
7. IF the client IP address cannot be determined, THEN THE Download_Grant_Endpoint SHALL treat the request as belonging to a single shared limiting bucket rather than exempting it.
8. WHEN the Download_Control receives an HTTP 429 response, THE Download_Control SHALL display a message stating the download limit was reached and when to retry.

### Requirement 8: Version-Distinct APK Filenames

**User Story:** As a user installing an update, I want the download to give me the newest build, so that a cached copy of a previous build is never served to me.

#### Acceptance Criteria

1. THE Release_Bucket SHALL name each APK_Object with the Semver_String of the release it contains.
2. WHEN a new release is published, THE Release_Bucket SHALL hold the new APK_Object under an object path that differs from the object path of every previously published APK_Object of the same App_Slug.
3. THE Release_Manifest `filename` field SHALL match the object name of the APK_Object for the manifest `version` value.

### Requirement 9: Download Page Content

**User Story:** As a visitor, I want the download page to show what the app is, what it looks like, and which build I am getting, so that I can decide to install it with confidence.

#### Acceptance Criteria

1. THE Download_Page SHALL render a mobile phone frame mockup containing a screenshot of the application it describes.
2. THE Download_Page SHALL render descriptive content stating the purpose of the application and the capabilities it provides.
3. THE Download_Page SHALL render a download control labelled "Download App" that submits to the Download_Grant_Endpoint for its App_Slug.
4. THE Download_Page SHALL display the `version` value from the Release_Manifest of its App_Slug.
5. THE Download_Page SHALL display the `size` value from the Release_Manifest of its App_Slug formatted as a human-readable file size.
6. THE Download_Page SHALL display the `releasedAt` value from the Release_Manifest of its App_Slug formatted as a calendar date.
7. WHERE the Release_Manifest `whatsNew` field is non-empty, THE Download_Page SHALL display its content.
8. IF the Release_Manifest for the App_Slug cannot be retrieved or is rejected by the Manifest_Parser, THEN THE Download_Page SHALL render the descriptive content and a notice that release details are temporarily unavailable, in place of the version, size, and release date values.
9. THE Download_Page SHALL exclude the APK_Object storage path and every Signed_Download_URL from its server-rendered markup.
10. THE Download_Page SHALL supply text alternatives for every non-decorative image it renders.

### Requirement 10: Android Sideload Install Guidance

**User Story:** As a first-time sideloader, I want explicit install steps including the security warnings I will hit, so that I can complete the install without assuming the app is broken or unsafe.

#### Acceptance Criteria

1. THE Install_Guide SHALL present the install steps in order: download the file, open the downloaded file, grant the install-from-this-source permission, confirm the install.
2. THE Install_Guide SHALL describe the Android prompt requesting permission to install applications from the current source, and state which option continues the install.
3. THE Install_Guide SHALL describe the Google Play Protect warning screen shown for applications installed outside the Google Play Store.
4. THE Install_Guide SHALL state where the option to continue past the Google Play Protect warning screen appears on that screen.
5. THE Download_Page SHALL render the Install_Guide for its App_Slug.

### Requirement 11: Platform Notice for Non-Android Visitors

**User Story:** As an iOS visitor, I want to be told the app is Android-only, so that I do not download a file my device cannot install.

#### Acceptance Criteria

1. WHEN the Download_Page is opened on an iOS device, THE Download_Page SHALL render an Android-only notice in place of the download control.
2. WHILE the Android-only notice is displayed, THE Download_Page SHALL suppress the download control and the Turnstile_Widget for the same App_Slug.
3. THE Download_Page SHALL continue to render the descriptive content, the phone frame mockup, and the release details when the Android-only notice is displayed.

### Requirement 12: Server-Side QR Code Generation

**User Story:** As a maintainer, I want QR codes rendered by our own server as SVG, so that no third-party image service is involved and no client JavaScript is shipped for them.

#### Acceptance Criteria

1. THE QR_Generator SHALL produce inline SVG markup encoding a supplied absolute URL using the `qrcode` npm package.
2. THE QR_Generator SHALL execute inside a React Server Component.
3. THE QR_Generator SHALL produce the SVG markup without issuing a network request at render time.
4. THE QR_Block SHALL encode the absolute URL formed by joining the Download_Base_URL with the path of the Download_Page for its App_Slug.
5. THE QR_Block SHALL encode a Download_Page URL only, and SHALL never encode a Signed_Download_URL.
6. THE QR_Block SHALL read the Download_Base_URL from the environment variable `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL`.
7. IF the environment variable `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL` is absent or empty, THEN THE QR_Block SHALL omit itself from the rendered page and record a server-side warning.
8. THE QR_Block SHALL ship no client JavaScript.
9. FOR ALL absolute URLs supplied to the QR_Generator, decoding the produced QR code SHALL yield the supplied URL (round-trip property).

### Requirement 13: QR Placement and Viewport Gating on Login Pages

**User Story:** As a user at a laptop, I want a QR code on the login screen, so that I can move the app onto my phone without typing a URL; on a phone I do not want that space consumed.

#### Acceptance Criteria

1. THE Customer login page SHALL render the QR_Block for the Customer Download_Page inside `src/app/customer/(auth)/login/LoginBrandPanel.tsx`.
2. THE Rider login page SHALL render the QR_Block for the Rider Download_Page inside `src/app/rider/(auth)/login/page.tsx`.
3. WHILE the viewport is a Large_Viewport, THE QR_Block SHALL be visible.
4. WHILE the viewport is narrower than a Large_Viewport, THE QR_Block SHALL be hidden.
5. THE QR_Block SHALL control its visibility using Tailwind CSS responsive utility classes only.
6. THE QR_Block SHALL determine its visibility without evaluating a JavaScript media query.
7. THE QR_Block SHALL render a title instructing the user to scan the code to download the app.
8. THE QR_Block SHALL render the encoded Download_Page URL as selectable plain text alongside the QR code.
9. THE QR_Block SHALL provide a text alternative describing the QR code destination.
10. THE Customer login page and the Rider login page SHALL each render exactly one QR_Block.

### Requirement 14: Configuration and Secret Handling

**User Story:** As a maintainer, I want the Turnstile and storage credentials configured by environment, so that keys can be rotated without a code change and the private key never reaches a browser.

#### Acceptance Criteria

1. THE system SHALL read the Turnstile_Site_Key from the environment variable `NEXT_PUBLIC_TURNSTILE_SITE_KEY`.
2. THE system SHALL read the Turnstile_Secret_Key from the environment variable `TURNSTILE_SECRET_KEY`.
3. THE system SHALL reference the Turnstile_Secret_Key exclusively in server-side code.
4. THE system SHALL exclude the Turnstile_Secret_Key from every client bundle.
5. THE system SHALL create every Signed_Download_URL using a Supabase client authenticated with the service role key, in server-side code only.
6. THE Turnstile configuration SHALL register the `customer` subdomain host as an allowed hostname.
7. WHEN the Turnstile_Site_Key or the Turnstile_Secret_Key is rotated, THE system SHALL adopt the new value without a code change.
8. IF the environment variable `TURNSTILE_SECRET_KEY` is absent or empty, THEN THE Download_Grant_Endpoint SHALL respond with HTTP 503 and record a server-side error.

### Requirement 15: Build and Distribution Security

**User Story:** As a maintainer, I want the distributed builds to contain no secrets, so that a user who obtains and inspects the APK cannot compromise the platform.

#### Acceptance Criteria

1. THE Customer Capacitor build configuration SHALL exclude service-role keys, database credentials, and API secrets.
2. THE Rider Capacitor build configuration SHALL exclude service-role keys, database credentials, and API secrets.
3. THE Customer and Rider builds SHALL reference only endpoints intended for public client access.
4. WHEN a release candidate build is prepared, THE release verification step SHALL confirm that the build configuration contains no value classified as a secret.

### Requirement 16: Repository Hygiene

**User Story:** As a maintainer, I want APK binaries kept out of version control, so that the repository does not accumulate large binary blobs.

#### Acceptance Criteria

1. THE repository `.gitignore` SHALL contain a pattern excluding files matching `*.apk`.
2. THE repository SHALL exclude the file `Arogya-rider.apk` from tracked content.
3. THE repository SHALL exclude APK binaries from the `public/` directory.

### Requirement 17: Release Operations Constraints

**User Story:** As a maintainer, I want the release procedure documented as constraints, so that a routine upload does not break in-place updates for users who already installed the app.

#### Acceptance Criteria

1. THE release procedure SHALL sign every APK_Object of a given App_Slug with the same Signing_Keystore used for the preceding release of that App_Slug.
2. THE release procedure SHALL upload each APK_Object using the Supabase dashboard or a client authenticated with the service role key.
3. WHEN a new APK_Object is uploaded, THE release procedure SHALL update the Release_Manifest for that App_Slug so that `version`, `filename`, `size`, `sha256`, and `releasedAt` describe the newly uploaded APK_Object.
4. THE release procedure SHALL require no application code change and no redeployment to publish a new release.
