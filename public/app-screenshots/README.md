# App Screenshots

This directory contains screenshots for the ArogyaDiet mobile apps displayed on the download pages.

## Current Files

| File | Description | Size |
|------|-------------|------|
| `customer.svg` | Placeholder screenshot of the Customer App | 375x812px |
| `rider.svg` | Placeholder screenshot of the Rider App | 375x812px |

## Replacing Placeholders

The current files are SVG placeholders. Replace them with actual app screenshots:

### For PNG Screenshots (Recommended for production)
1. Capture screenshots from the actual apps
2. Save as `customer.png` and `rider.png` (375x812px recommended)
3. Update `src/lib/appDistribution/content.ts` to reference `.png` files:
   - Change `/app-screenshots/customer.svg` to `/app-screenshots/customer.png`
   - Change `/app-screenshots/rider.svg` to `/app-screenshots/rider.png`
4. Delete the SVG placeholder files

### Screenshot Guidelines

#### Customer App Screenshot
Should showcase one of:
- Subscription management screen with meal plan details
- Delivery tracking view
- Pause/resume functionality
- Address change feature

#### Rider App Screenshot
Should showcase one of:
- Route overview with delivery stops list
- GPS duty tracking screen
- Delivery confirmation interface
- Payout summary view

## Technical Requirements

- **Format**: PNG (recommended) or SVG
- **Size**: Mobile aspect ratio (9:19.5 or similar), optimized for phone frame display
- **Quality**: High resolution, clear text, representative of actual app UI
- **Content**: Use realistic but non-sensitive sample data

## Usage

These images are referenced in `src/lib/appDistribution/content.ts` and displayed in the CSS phone frame on the download pages at:
- `/app/customer` - Customer app download page
- `/app/rider` - Rider app download page

## Notes

- These are local static files to avoid touching `next.config.ts` remote image patterns
- The Supabase bucket is now private, so remote URLs would not work
- SVG placeholders render immediately; replace with actual screenshots before production