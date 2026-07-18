import type { Metadata } from "next";
import { Fraunces } from "next/font/google";
import "./globals.css";
import { Toaster } from "sonner";

// Premium display serif used for headings/brand moments (login hero, card
// titles). Exposed as a CSS variable so it can be opted into via the
// `font-display` utility without changing the app-wide sans body font.
const fraunces = Fraunces({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  style: ["normal", "italic"],
  variable: "--font-fraunces",
  display: "swap",
});

export const metadata: Metadata = {
  title: "ArogyaDiet Dashboard",
  description: "We're Providing Everyday Fresh and Quality Products.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`h-full antialiased ${fraunces.variable}`}>
      <body className="min-h-full flex flex-col">
        {children}
        {/* This component listens for toast() calls and displays them */}
        <Toaster richColors position="top-right" />
      </body>
    </html>
  );
}
