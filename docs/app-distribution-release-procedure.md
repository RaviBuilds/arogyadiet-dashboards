# App APK Distribution — Release Procedure

## Overview

This document describes the process for releasing new versions of the ArogyaDiet Customer and Rider Android applications through the APK distribution feature.

**Key constraint:** Every release of an app must be signed with the same keystore as its predecessor, or existing installs cannot update in place. Changing keystores breaks the update chain and requires users to uninstall and reinstall.

## Release Steps

### Phase 1: Build the APK

1. **Build the Android APK**
   - Use `capacitor build android` in the native build environment
   - Sign with the **same keystore** that was used for all previous releases
   - Example commands (from native-build CI/CD):
     ```bash
     npx capacitor build android --prod
     # Then sign in Android Studio or with jarsigner/zipalign
     ```

2. **Verify the APK integrity**
   - Run the security verification script:
     ```bash
     node scripts/verify-apk-secrets.mjs arogyadiet-customer-v1.0.1.apk
     node scripts/verify-apk-secrets.mjs arogyadiet-rider-v1.0.1.apk
     ```
   - Confirm the output shows:
     - No embedded service-role keys
     - No database credentials
     - No API secrets
     - Only references to public endpoints (customer portal, Razorpay, OneSignal)

3. **Compute the APK hash and size**
   - SHA256:
     ```bash
     sha256sum arogyadiet-customer-v1.0.1.apk
     sha256sum arogyadiet-rider-v1.0.1.apk
     ```
   - File size in bytes:
     ```bash
     stat -c%s arogyadiet-customer-v1.0.1.apk
     stat -c%s arogyadiet-rider-v1.0.1.apk
     ```

### Phase 2: Upload to Supabase Storage

1. **Log in to Supabase Dashboard**
   - Navigate to the Storage section
   - Select the `app-releases` bucket

2. **Upload the APK file**
   - Upload `arogyadiet-customer-v1.0.1.apk` to the `customer/` folder
   - Upload `arogyadiet-rider-v1.0.1.apk` to the `rider/` folder
   - Ensure content type is `application/vnd.android.package-archive`

3. **Create/update the manifest**
   - Create or update `customer/latest.json`:
     ```json
     {
       "version": "1.0.1",
       "filename": "arogyadiet-customer-v1.0.1.apk",
       "size": 52000000,
       "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
       "releasedAt": "2026-08-07T10:30:00+00:00",
       "whatsNew": "Bug fixes and performance improvements"
     }
     ```
   - Create or update `rider/latest.json` similarly
   - Keys must be in this exact order (serialization order matters)

### Phase 3: Verify the Deployment

1. **Verify manifest is readable**
   - Visit `https://customer.arogyadiet.com/app/customer` in a browser
   - Confirm the release details display (version, date, whatsNew)

2. **Verify QR codes resolve**
   - Scan the QR on the login page from a phone camera
   - Confirm it navigates to `https://customer.arogyadiet.com/app/customer`

3. **Verify grant endpoint**
   - Test the download flow end-to-end on a physical Android device:
     - Scan QR
     - Complete Turnstile verification
     - Confirm download starts
     - Verify the saved filename includes the version (e.g., `arogyadiet-customer-v1.0.1.apk`)

4. **Verify rate limiting**
   - Attempt 6 rapid downloads from the same IP within 10 minutes
   - Confirm the 6th attempt returns 429 with `Retry-After` header

## Important Notes

### No Code Redeployment Required

Publishing a new version requires **no Next.js code changes and no redeployment**:
- The download page reads the manifest from storage at each request (with 5-minute cache)
- The manifest contains the versioning information
- The download endpoint uses the manifest to determine which file to serve

Deploying new code is only necessary for:
- Changes to the download UI
- Security policy changes
- Infrastructure updates

### Keystore Constraint

**Critical:** The private keystore used to sign an APK **must never change** between releases, or the app cannot be updated in place on existing devices. Android requires the signature to remain constant.

If the keystore is lost or compromised:
1. A new release signed with a different keystore requires users to uninstall and reinstall
2. Existing installs will see an app store listing but cannot update
3. Consider this decision carefully and document it for the team

### Manifest File Format

The manifest serialization is deterministic. Keys must appear in this exact order:
1. `version`
2. `filename`
3. `size`
4. `sha256`
5. `releasedAt`
6. `whatsNew`

This ordering ensures:
- Git diffs are reviewable (the manifest doesn't move around)
- Round-trip serialization is deterministic (the same manifest produces the same bytes)
- Accidental re-ordering doesn't slip through review

## Rollback Procedure

If a release is defective and needs to be rolled back:

1. **Delete the APK from storage** (optional, but recommended to save bandwidth)
   - Supabase Storage → `app-releases` → `customer/arogyadiet-customer-v1.0.1.apk` → Delete

2. **Update the manifest** to point to the previous version
   - Edit `customer/latest.json`:
     ```json
     {
       "version": "1.0.0",
       "filename": "arogyadiet-customer-v1.0.0.apk",
       "size": 51000000,
       "sha256": "d3c0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b854",
       "releasedAt": "2026-08-01T10:00:00+00:00",
       "whatsNew": "Initial release"
     }
     ```

3. **Verify the rollback**
   - Reload the download page and confirm the version changed
   - Optionally trigger a new download to verify the old APK is served

## Monitoring

- **Download grant rate limit**: Check `app_download_throttle` table in Supabase for throttle hits
- **Manifest freshness**: Check the `revalidate = 300` cache on the download page (updates every 5 minutes)
- **Signed URL TTL**: Download URLs expire after 120 seconds; a very large APK may need longer (edit `src/lib/appDistribution/storage.ts` `SIGNED_URL_TTL_SECONDS`)

## Security Checklist

Before every release:

- [ ] APK is signed with the correct keystore
- [ ] Verification script (`verify-apk-secrets.mjs`) returns all green checks
- [ ] Manifest JSON is valid and keys are in order
- [ ] Hashes and sizes match the uploaded file
- [ ] `releasedAt` timestamp is in ISO 8601 format with explicit offset
- [ ] `whatsNew` describes the changes
- [ ] QR code on login pages resolves correctly
- [ ] Download flow works on a real device (test on both Android 10 and 13+)

## References

- Supabase Storage: https://supabase.com/docs/guides/storage
- Content-Disposition: attachment: https://developer.mozilla.org/en-US/docs/Web/HTTP/Headers/Content-Disposition
- Android app signing: https://developer.android.com/studio/publish/app-signing
- Keystore rotation risks: https://developer.android.com/studio/publish/app-signing#rotate-key
