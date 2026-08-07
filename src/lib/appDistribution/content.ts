// src/lib/appDistribution/content.ts
// Per-slug copy, feature list, screenshot path, and page title for the download pages.

import type { AppSlug } from "./slug";

/**
 * Content for an app download page.
 * Used by the Download_Page to render hero, features, and screenshot.
 */
export interface AppContent {
  /** The app's display title */
  title: string;
  /** Short tagline shown below the title */
  tagline: string;
  /** Longer description of the app's purpose */
  description: string;
  /** Feature list with icon names, titles, and descriptions */
  features: { icon: string; title: string; copy: string }[];
  /** Screenshot image path and alt text */
  screenshot: { src: string; alt: string };
}

/**
 * Content for each app, keyed by slug.
 * Screenshot paths point at public/app-screenshots/ as local static files.
 */
export const APP_CONTENT: Record<AppSlug, AppContent> = {
  customer: {
    title: "ArogyaDiet Customer App",
    tagline: "Your wellness journey, delivered daily",
    description:
      "Manage your meal subscriptions with ease. Pause deliveries when you're away, update your address for specific days, and track your meals in real-time — all from your phone.",
    features: [
      {
        icon: "Calendar",
        title: "Manage Subscription",
        copy:
          "View and manage your active meal plan. See upcoming deliveries, check your subscription status, and review your meal preferences.",
      },
      {
        icon: "Pause",
        title: "Pause and Resume Days",
        copy:
          "Going on vacation or need a break? Pause your deliveries for specific dates and resume when you're back. Your subscription extends automatically.",
      },
      {
        icon: "MapPin",
        title: "Change Delivery Address",
        copy:
          "Need your meal delivered somewhere else? Update your delivery address for any specific day — perfect for when you're working from a different location.",
      },
      {
        icon: "Truck",
        title: "Track Today's Delivery",
        copy:
          "See exactly where your meal is. Track your rider in real-time and get an accurate estimate of when your food will arrive.",
      },
      {
        icon: "Receipt",
        title: "View Billing and Invoices",
        copy:
          "Access your complete payment history. Download invoices, view upcoming charges, and manage your payment methods all in one place.",
      },
    ],
    screenshot: {
      src: "/app-screenshots/customer.png",
      alt: "ArogyaDiet Customer App home screen showing a 30-day plan at 100 percent complete, today's meal with a photo, and a notice that a delivery partner has been assigned",
    },
  },
  rider: {
    title: "ArogyaDiet Rider App",
    tagline: "Deliver wellness, earn on your schedule",
    description:
      "Your complete delivery companion. See your assigned route for the day, track your duty hours with GPS, confirm deliveries with a tap, and view your earnings summary.",
    features: [
      {
        icon: "Route",
        title: "Today's Assigned Route",
        copy:
          "Start your day knowing exactly where to go. View all your assigned deliveries for the day, optimized for efficiency with addresses and customer notes.",
      },
      {
        icon: "Map",
        title: "Live GPS Duty Tracking",
        copy:
          "Clock in and let the app track your duty hours automatically. GPS tracking ensures accurate records for your work hours and route completion.",
      },
      {
        icon: "CheckCircle",
        title: "Delivery Confirmation",
        copy:
          "Confirm each delivery with a single tap. Capture proof of delivery and mark orders as complete to keep customers informed in real-time.",
      },
      {
        icon: "Wallet",
        title: "Payout Summary",
        copy:
          "Track your earnings with a clear breakdown. See completed deliveries, distance traveled, and your expected payout for each pay period.",
      },
    ],
    screenshot: {
      src: "/app-screenshots/rider.png",
      alt: "ArogyaDiet Rider App home screen showing an On Duty toggle with background tracking active, today's overview of pending drops and estimated payout, and a Start Route button",
    },
  },
};
