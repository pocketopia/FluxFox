import type { Metadata, Viewport } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'FluxFox — AI Phone Receptionist',
  description:
    'FluxFox is the AI phone receptionist that answers every call, texts back missed leads, and books appointments straight to your Google Calendar — 24/7.',
  icons: {
    icon: '/logo.png',
    shortcut: '/logo.png',
    apple: '/logo.png',
  },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
  themeColor: '#09090b',
};

/**
 * Day 13 — App Store Legal & Layout Wiring.
 *
 * The single Next.js RootLayout shared by every route in the App Router
 * tree (`/login`, `/dashboard`, `/privacy`, `/terms`, ...). It owns the
 * `<html>`/`<body>` shell, wires up `globals.css` (Tailwind + the Day 12
 * Expo WebView polish rules), and applies the dark cyber theme globally so
 * every page — including the App Store–required legal pages — renders on
 * a consistent `bg-zinc-950` background instead of flashing white while
 * Next.js streams the page in.
 */
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="bg-zinc-950 text-zinc-100 antialiased selection:bg-amber-500/30 selection:text-amber-200 font-sans">
        {children}
      </body>
    </html>
  );
}
