# Rider App — GPS Tracking Setup Checklist

**Purpose:** For the rider admin to walk through with every rider before their first shift on the new app build. Following these steps is what keeps the rider's live location visible on the admin dashboard for the entire shift — screen locked, phone in pocket, calls coming in, other apps open.

**Why this matters:** Phones aggressively try to save battery by killing apps running in the background. If these settings aren't set correctly, the rider's location will stop updating a few minutes after they lock their screen, even though the app is doing everything right. This is a phone setting problem, not an app bug — and it's different on every phone brand.

---

## 1. One-time setup per rider (do this before their first shift)

### Step 1 — Install the APK
- Install the provided release APK on the rider's phone.
- Open the app and log in with the rider's credentials.

### Step 2 — Grant location permission correctly
- When prompted for location permission, the rider must choose **"Allow all the time"** — NOT "Allow only while using the app."
- If they accidentally pick "while using the app," tracking will stop the moment they switch apps or lock the screen.
- To fix afterward: Phone Settings → Apps → ArogyaDiet Rider → Permissions → Location → **Allow all the time**.

### Step 3 — Complete the in-app battery permission banner
- On the rider dashboard, if the phone isn't already set up correctly, an amber banner will appear: **"Fix location tracking before your shift."**
- Tap it and follow both steps shown:
  1. Tap **"Allow background location"** — this opens the phone's own permission popup. Choose **Allow / Don't optimize**.
  2. Follow the phone-specific instructions shown below the button (varies by brand — see Section 2).
- After completing the steps, reopen the app. The banner should disappear. If it doesn't, the setup wasn't completed correctly — go through the steps again.

### Step 4 — Enable "Autostart" / "Auto-launch" (critical, especially on Chinese-brand phones)
- Most phones (Vivo, Xiaomi, Oppo, Realme, OnePlus) have a separate **Autostart** permission, hidden outside normal Settings, that must be turned ON. Without it, the tracking service can get killed and may not restart on its own.
- See brand-specific steps in Section 2.

### Step 5 — Confirm the persistent notification appears
- Once the rider taps **On Duty**, they should see a permanent notification saying something like *"ArogyaDiet is tracking your location."*
- This notification is required by Android — it cannot be hidden. If it's not there, tracking is not active and must be checked before the rider starts their route.

---

## 2. Phone brand-specific settings (the part that's easy to miss)

Different phone brands hide extra battery/power-saving controls beyond the standard Android settings. **All applicable steps for the rider's specific brand must be completed** — completing only the standard Android permission is usually not enough.

### Vivo
- **i Manager app** → App manager → Autostart → turn ON for ArogyaDiet Rider.
- **i Manager app** → Battery → High background power consumption (or "Background power consumption management") → set ArogyaDiet Rider to **Allow / Unrestricted**.
- **Settings** → Battery → App battery usage → ArogyaDiet Rider → **Unrestricted** (this is a separate toggle from the one above — both are required).

### Xiaomi / Redmi / POCO (MIUI)
- **Settings** → Apps → Manage apps → ArogyaDiet Rider → **Autostart → ON**.
- **Settings** → Apps → Manage apps → ArogyaDiet Rider → Battery saver → **No restrictions**.
- **Security app** → Battery → App battery saver → ArogyaDiet Rider → **No restrictions**.

### Oppo
- **Settings** → Battery → App Battery Management → ArogyaDiet Rider → **Allow background activity**.
- **Settings** → Apps → App list → ArogyaDiet Rider → **Allow auto launch**.
- **Phone Manager app** → Privacy permissions → Startup manager → enable auto-start for ArogyaDiet Rider.

### Realme
- Same as Oppo (Realme uses the same ColorOS-based system):
- **Settings** → Battery → App Battery Management → **Allow background activity**.
- **Settings** → App management → App list → **Allow auto launch**.
- **Phone Manager app** → Permission privacy → Startup manager → enable for ArogyaDiet Rider.

### OnePlus
- **Settings** → Battery → Battery optimization → ArogyaDiet Rider → **Don't optimize**.
- **Settings** → Apps → ArogyaDiet Rider → Battery → Background usage → **Unrestricted / Allow**.

### Samsung
- **Settings** → Apps → ArogyaDiet Rider → Battery → **Unrestricted**.
- **Settings** → Battery and device care → Battery → Background usage limits → **Never sleeping apps** → add ArogyaDiet Rider.

### Any other brand
- Look for Battery or Power Saving settings for this specific app and set to **Unrestricted / No restrictions / Allow background activity**.
- If the phone has its own app manager / security app (common on Chinese-brand phones), also check there for an **Autostart / Auto-launch** setting.

---

## 3. Rider habits during a shift (things the rider should and shouldn't do)

- ✅ **It is safe to** lock the screen, put the phone in a pocket, take calls, and switch to other apps (maps, WhatsApp, etc.) while On Duty — tracking will continue running in the background once the setup above is done.
- ✅ Leave the persistent tracking notification alone — don't swipe it away or force-close the app from Recents while On Duty.
- ❌ Don't manually "clear" or "force stop" the app from phone Settings while on a shift — this fully kills tracking and the rider will need to reopen the app and go back On Duty to resume.
- ❌ Don't use any third-party "battery saver" or "cleaner" apps (e.g. some phone cleaner/booster apps) that auto-kill background apps — these can override the settings above. If the rider has one installed, ArogyaDiet Rider should be whitelisted there too, or the app removed.
- If the rider gets a low-battery warning and enables the phone's Battery Saver / Power Saving mode, that can also override the above settings on some phones. Ask riders to report if this happens.

---

## 4. What to check if a rider reports "my location isn't showing" or admin sees them going inactive

Ask the rider:
1. Did the amber "Fix location tracking" banner ever appear in the app? Did they complete both steps?
2. What is their phone brand and model?
3. Did they complete the brand-specific steps in Section 2 for their phone?
4. Is the "ArogyaDiet is tracking your location" notification visible right now?
5. Did they recently update their phone software, or install a new battery/cleaner app?

If all of the above check out and the issue persists, please pass along:
- Rider name / employee code
- Phone brand and model
- Approximate time the location was reported as stuck/missing

This info lets us check the exact upload history for that rider's device and pinpoint whether it's a settings issue or something new we haven't seen yet.

---

## 5. Current status (for the admin's awareness)

- This is a **pilot rollout**, not the final rider-wide release. A small group of test riders is using this build first so real-world issues can be caught and fixed before wider distribution.
- The core tracking fix (native background service, works through screen lock and app switching) has been tested and confirmed working — including under simulated worst-case conditions on a Vivo phone.
- The remaining risk is phone-specific battery settings (Section 2), which depend on each rider correctly completing the setup steps. This checklist exists specifically to close that gap.
