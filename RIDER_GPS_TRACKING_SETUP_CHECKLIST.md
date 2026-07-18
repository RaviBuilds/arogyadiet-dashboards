# Rider App — GPS Tracking Setup Checklist

**Purpose:** For the rider admin to walk through with every rider before their first shift on the new app build. Following these steps is what keeps the rider's live location visible on the admin dashboard for the entire shift — screen locked, phone in pocket, calls coming in, other apps open.

**Why this matters:** Phones aggressively try to save battery by killing apps running in the background. If these settings aren't set correctly, the rider's location will stop updating a few minutes after they lock their screen, even though the app is doing everything right. This is a phone setting problem, not an app bug — and it's different on every phone brand.

---

## 1. One-time setup per rider (do this before their first shift)

### Step 1 — Install the APK
- Install the provided release APK on the rider's phone.
- Open the app and log in with the rider's credentials.

### Step 2 — Open the "Finish tracking setup" banner
- On the rider dashboard (Home), if anything still needs granting, an amber banner appears: **"Finish tracking setup (N/3)"** (where N is how many of the 3 core steps are already done).
- Tap it to open the setup checklist. Each item shows either a green tick (done) or an **Allow** button. Complete all of them:

  1. **Location: "Allow all the time"** — tap **Allow**, then on the phone's popup choose **"Allow all the time"** (NOT "While using the app" or "Only this time"). This is the single most important setting — without it, tracking stops the moment the rider locks the screen or switches apps.
  2. **Notifications** — tap **Allow** and accept. This shows the ongoing tracking notification and helps the phone keep tracking alive.
  3. **Battery: don't optimise** — tap **Allow**, then choose **Allow / Don't optimize** on the phone's popup.

- As each is granted it turns into a green tick. When all three are done, the header changes to **"You're all set"** and the banner disappears.
- The checklist re-checks itself automatically when the rider returns to the app, and has a **"Re-check"** button at the bottom if a tick doesn't update immediately.
- If a popup doesn't appear (e.g. a permission was denied before, or the phone routes it to Settings), the app automatically opens **App Settings** — set Location to "Allow all the time" / turn Notifications on there manually, then return to the app.

### Step 3 — Complete the phone-maker battery settings (critical on Chinese-brand phones)
- Below the three core steps, riders on Vivo / Xiaomi / Oppo / Realme / OnePlus / Samsung phones see an extra **"[Brand] battery settings"** card with manual steps. These controls (Autostart / Auto-launch and OEM battery managers) live *outside* normal Android settings and **cannot be detected by the app**, so they must be done by hand.
- Follow every step listed for that brand (also in Section 2 below), then tap **"I've done this"** on the card, or use **"Open App Settings"** to jump to the right screen.
- Without these, the tracking service can be killed by the phone's own power manager and may not restart on its own.

### Step 4 — Confirm the persistent notification appears
- Once the rider taps **On Duty**, they should see a permanent notification: *"ArogyaDiet is tracking your route for delivery updates."*
- This notification is required by Android and is **intentionally not swipe-able** — it stays until the rider goes Off Duty. If it's not there, tracking is not active and setup should be re-checked before the rider starts their route.

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

- ✅ **It is safe to** lock the screen, put the phone in a pocket, take calls, and switch to other apps (maps, WhatsApp, etc.) while On Duty — tracking continues running in the background once the setup above is done.
- ✅ **It is safe to** close the app or restart the phone while On Duty — when the rider reopens the app it automatically resumes tracking (no need to toggle Off/On). After a phone restart the rider just needs to open the app once.
- ✅ Leave the persistent tracking notification alone. It is intentionally not swipe-able while On Duty — that's normal, not a fault.
- ✅ If the rider turns their device **Location/GPS off** by mistake, the app now shows a red **"Location is off — you're not being tracked"** warning with a **Retry** button, and stays On Duty. Turning Location back on and tapping Retry (or just reopening the app) resumes tracking.
- ❌ Don't manually "clear" or "force stop" the app from phone Settings while on a shift — this fully kills tracking; the rider will need to reopen the app to resume.
- ❌ Don't use third-party "battery saver" / "cleaner" / "booster" apps that auto-kill background apps — these can override the settings above. If the rider has one, ArogyaDiet Rider should be whitelisted there too, or the app removed.
- If the rider enables the phone's Battery Saver / Power Saving mode (e.g. on a low-battery warning), that can override the above settings on some phones. Ask riders to report if this happens.

---

## 4. What to check if a rider reports "my location isn't showing" or admin sees them going inactive

Ask the rider:
1. In the app's **"Finish tracking setup"** checklist, are all three items (Location "Allow all the time", Notifications, Battery) showing a green tick? If the banner still shows "(N/3)", setup is incomplete.
2. Is their Location set specifically to **"Allow all the time"** (not "While using the app")? Check: Settings → Apps → ArogyaDiet Rider → Permissions → Location.
3. What is their phone brand and model? Did they complete the brand-specific steps in Section 2 for their phone?
4. Is the "ArogyaDiet is tracking your route for delivery updates" notification visible right now?
5. Did they recently update their phone software, or install a new battery/cleaner app?

If all of the above check out and the issue persists, please pass along:
- Rider name / employee code
- Phone brand and model
- Approximate time the location was reported as stuck/missing

This info lets us check the exact upload history for that rider's device and pinpoint whether it's a settings issue or something new we haven't seen yet.

---

## 5. Current status (for the admin's awareness)

- This is a **pilot rollout**, not the final rider-wide release. A small group of test riders is using this build first so real-world issues can be caught and fixed before wider distribution.
- The core tracking fix (native background service) has been tested and confirmed working — including **screen locked for 12+ minutes continuously** on a Vivo phone with the location still updating, and automatic resume after the app is closed and reopened.
- The critical requirement is granting **Location = "Allow all the time"** plus notifications; the in-app "Finish tracking setup" checklist now walks every rider through this and won't clear until it's done.
- The remaining risk is phone-specific battery settings (Section 2), which the app cannot detect or set automatically — these depend on each rider completing the manual steps for their brand. This checklist exists specifically to close that gap.
