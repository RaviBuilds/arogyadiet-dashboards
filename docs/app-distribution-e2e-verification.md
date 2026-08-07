# App APK Distribution — End-to-End Verification Checklist

## Task 14.1: Run the full quality gate

All three commands must pass without errors:

### npm run lint
```bash
npm run lint
```
**Expected outcome:** No linting errors related to app distribution code.

**What it checks:**
- TypeScript syntax and type safety (strict mode)
- ESLint rules for code quality
- No unused imports or variables
- Proper naming conventions

### npm run test
```bash
npm run test
```
**Expected outcome:** All tests pass (optional test tasks marked with `*` may be skipped).

**What it checks:**
- Unit tests for core modules (manifest parsing, slug validation, etc.)
- Property tests for invariants
- Integration tests for API endpoints

### npm run build
```bash
npm run build
```
**Expected outcome:** Build completes without errors. The `/app/customer` and `/app/rider` routes are pre-rendered as static HTML.

**What it checks:**
- TypeScript compilation
- All Server Components render correctly
- Static params generate for both app slugs
- No runtime errors during build
- App download pages (`/app/[slug]`) appear in the build output

**Verification:**
```bash
# Check build output for the download pages
npm run build | grep "customer/(public)/app\|rider/(public)/app"
# Should show:
# ✓ /customer/app/customer
# ✓ /customer/app/rider
```

---

## Task 14.2: Verify the download flow on a physical Android device

**Prerequisites:**
- Physical Android device (Android 10 or later) with a camera
- The app is deployed to a live environment (or use a test deployment)
- The Turnstile keys and APK files are configured in Supabase

### Step 1: Scan the QR code

1. Open the ArogyaDiet customer portal login page
2. On large viewports (desktop/tablet), look for the QR code in the right panel
3. On mobile viewports, the QR code is hidden (marked as `hidden lg:flex`)
4. Scan the QR code using the default phone camera app
5. **Expected outcome:** Browser opens and navigates to `https://customer.arogyadiet.com/app/customer`

### Step 2: Complete the Turnstile challenge

1. The page loads with the download control visible
2. A Turnstile widget appears (checkbox or silent challenge)
3. Complete the verification challenge
4. **Expected outcome:** After verification, the button changes to "Download App"

### Step 3: Trigger the download

1. Click the "Download App" button
2. **Expected outcome:** 
   - The button shows "Downloading..." with a spinner
   - After a few seconds, the APK file begins downloading
   - The file is saved with the versioned name (e.g., `arogyadiet-customer-v1.0.0.apk`)

### Step 4: Verify the install flow

1. After download completes, open the file from the Downloads folder
2. Android shows the "Install unknown app?" prompt
3. Tap "Settings" → enable "Allow from this source" (or similar, varies by Android version)
4. Go back and tap "Install"
5. Android shows the "Play Protect" warning screen (Google Play Protect checking the app)
6. **Verification checkpoint:** Record the exact wording and button location of:
   - The "unknown sources" permission prompt
   - The Play Protect warning
   - The continue/install button locations
   - **Compare with wording in** `src/app/customer/(public)/app/[slug]/_components/InstallGuide.tsx`
   - **If different:** Update the component to match actual device prompts

7. Tap the continue button
8. App installs and shows on the home screen

### Step 5: Verify the Install Guide accuracy

1. After completing steps 1-4 in person, return to the download page
2. Scroll down to the "Installation Guide" section
3. Compare each step with what you actually saw:
   - Does the wording match?
   - Are button locations described accurately?
   - Is the Android version range correct (Android 10+)?
4. **Update** `InstallGuide.tsx` if any discrepancies are found

### Checklist for this task

- [ ] QR code is scannable and resolves to the correct URL
- [ ] Turnstile widget appears and completes
- [ ] Download starts with the correct filename (includes version)
- [ ] Unknown-sources permission prompt text matches the guide
- [ ] Play Protect warning screen appears as described
- [ ] Install completes successfully
- [ ] Install Guide wording is accurate and current

---

## Task 14.3: Verify the bypass and limit paths against the deployment

### Test 1: Verify unsigned bucket URL is denied

**Purpose:** Confirm that anonymous read from storage is denied, so the entire rate-limit and Turnstile flow is actually protective.

1. Go to Supabase Dashboard → Storage → `app-releases`
2. Find the `customer/latest.json` or an APK file
3. Get the unsigned object URL (without signing it)
   - Example format: `https://mozolxjkzytjigdmngqq.supabase.co/storage/v1/object/public/app-releases/customer/arogyadiet-customer-v1.0.0.apk`
4. Try to fetch it in the browser or with curl:
   ```bash
   curl -i "https://mozolxjkzytjigdmngqq.supabase.co/storage/v1/object/public/app-releases/customer/arogyadiet-customer-v1.0.0.apk"
   ```
5. **Expected outcome:** 403 Forbidden or 404 Not Found (no 200 OK with file content)

**Why this matters:** If anonymous read is allowed, a single leaked signed URL is a permanent bypass of Turnstile and rate limiting.

### Test 2: Verify signed URLs expire

**Purpose:** Confirm that signed download URLs have a bounded TTL.

1. Trigger a download through the normal flow (complete Turnstile, get signed URL)
2. Copy the signed URL from the response
3. Wait 120+ seconds (the TTL from `src/lib/appDistribution/storage.ts` `SIGNED_URL_TTL_SECONDS = 120`)
4. Try to use the expired signed URL in a new browser tab or curl request:
   ```bash
   curl -i "<expired-signed-url>"
   ```
5. **Expected outcome:** 403 Forbidden (signature expired or invalid)

### Test 3: Verify rate limit is enforced

**Purpose:** Confirm that downloads are throttled per IP per app.

**Setup:**
- From a single IP address (or behind a NAT), attempt multiple downloads in rapid succession
- The limit is 5 grants per 10 minutes per app per IP (configurable in `src/lib/appDistribution/rateLimit.ts`)

**Steps:**
1. Complete Turnstile verification 5 times (or use curl with the grant endpoint)
2. On the 5th attempt, download should succeed
3. On the 6th attempt within the same 10-minute window:
   ```bash
   curl -X POST https://customer.arogyadiet.com/api/app-download/grant \
     -H "Content-Type: application/json" \
     -d '{"slug": "customer", "token": "..."}' \
     -i
   ```
4. **Expected outcome:**
   - Status: `429 Too Many Requests`
   - Response body: `{"error": "RATE_LIMITED", "retryAfterSeconds": <remaining-seconds>}`
   - Header: `Retry-After: <remaining-seconds>`

5. Wait for the time specified in `Retry-After` and try again
6. **Expected outcome:** Request succeeds (grant is allowed)

### Checklist for this task

- [ ] Unsigned storage URL returns 403/404 (not 200)
- [ ] Signed URL expires after 120 seconds
- [ ] 5 rapid grants succeed from one IP
- [ ] 6th grant within 10 minutes returns 429
- [ ] `Retry-After` header is present and non-zero
- [ ] After waiting, the next grant succeeds
- [ ] Rate limit is per-IP per-app (different app slug resets the count)

---

## Task 14.4: Document the release procedure

**Location:** `docs/app-distribution-release-procedure.md`

**Contents verified:**
- [ ] Upload steps are clear and match actual Supabase UI
- [ ] Manifest format is documented with example JSON
- [ ] Key ordering is explained
- [ ] Keystore constraint is prominent (cannot change between releases)
- [ ] Rollback steps are provided
- [ ] Security verification script is referenced
- [ ] No code redeployment is needed for new releases (only new uploads)

**Document checklist:**
- [ ] Phase 1 (Build the APK) is complete
- [ ] Phase 2 (Upload to storage) is complete
- [ ] Phase 3 (Verify deployment) is complete
- [ ] Security checklist is provided
- [ ] Keystore rotation risks are documented
- [ ] Monitoring instructions are provided

---

## Sign-Off Criteria

All four tasks (14.1 through 14.4) must pass for the feature to be considered production-ready:

✅ **14.1:** Build, lint, and test all pass  
✅ **14.2:** Download flow works end-to-end on a real Android device  
✅ **14.3:** Security properties hold (bucket is private, rate limit is enforced)  
✅ **14.4:** Release procedure is documented and verified

---

## Troubleshooting

### QR code doesn't appear
- Check `NEXT_PUBLIC_APP_DOWNLOAD_BASE_URL` is set in environment
- Check `src/lib/appDistribution/config.ts` returns non-null value
- Ensure `AppDownloadQrBlock` component is rendering (check browser console)

### Turnstile widget doesn't load
- Verify `NEXT_PUBLIC_TURNSTILE_SITE_KEY` is set
- Check Cloudflare dashboard for site registration
- Verify domain is whitelisted in Turnstile settings
- Check browser console for script load errors

### Download fails with 429
- This is expected after 5 downloads in 10 minutes
- Wait for `Retry-After` seconds and try again
- Or access from a different IP/network

### Download fails with 503
- Manifest file may be unavailable in Supabase Storage
- APK file may be missing or in wrong bucket/path
- Check Supabase Storage paths:
  - `app-releases/customer/arogyadiet-customer-v1.0.0.apk`
  - `app-releases/customer/latest.json`
  - `app-releases/rider/arogyadiet-rider-v1.0.0.apk`
  - `app-releases/rider/latest.json`

### Install fails after download
- Verify the APK is built with the same keystore as previous versions
- Run `scripts/verify-apk-secrets.mjs` to check for embedded credentials
- Ensure Android device has enough storage space
