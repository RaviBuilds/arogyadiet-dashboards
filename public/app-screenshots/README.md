# App Screenshots

Device mockups shown on the public APK download pages.

## Current files

| File | Description | Intrinsic size |
|------|-------------|----------------|
| `customer.png` | Customer App home screen | 1857 x 3096 |
| `rider.png` | Rider App on-duty home screen | 1857 x 3096 |

## Important: the artwork includes its own device frame

Both files are **pre-rendered 3D device mockups on a transparent background** — the
phone bezel, notch and shadow are baked into the image. `AppMockup.tsx` therefore
renders the image bare, with only a soft halo behind it.

If you replace these with **flat screenshots** (no frame, opaque background), the
page will look wrong: a bare rectangle floating on the gradient. In that case
either re-render the screenshot into a device frame first, or reintroduce a CSS
phone frame in `AppMockup.tsx`.

## Replacing them

1. Export the new mockup as a transparent PNG at roughly 1857 x 3096 (any
   9:19.5-ish phone ratio works; the component reserves the aspect ratio from the
   `width`/`height` props, so update those if your ratio differs).
2. Save as `customer.png` / `rider.png` — same filenames, no spaces. Spaces in a
   filename become `%20` in the URL and are easy to get wrong.
3. Update the `alt` text in `src/lib/appDistribution/content.ts` if the mockup now
   shows a different screen. The alt text describes the screen content, so a stale
   description is worse than a generic one.

No `next.config.ts` change is needed — these are local static files, and the
`images.remotePatterns` whitelist only applies to remote sources.

## Where they are used

Referenced from `src/lib/appDistribution/content.ts`, rendered by
`src/app/customer/(public)/app/[slug]/_components/AppMockup.tsx` on:

- `/app/customer`
- `/app/rider`

## Guidelines

- Use realistic but non-sensitive sample data. These pages are public and
  unauthenticated, so anything visible in the mockup is effectively published.
- Keep the important content in the upper two thirds — the mockup is scaled to fit
  the column and the lower portion reads as secondary.
