// Root document. The sidebar shell lives in app/(dashboard)/layout.tsx so /sign-in never
// shows it, even while an expired session cookie is still set.
import type { Metadata } from "next";
import "@fontsource-variable/geist";
import "@fontsource-variable/geist-mono";
import "./globals.css";
import { SITE } from "../lib/site.ts";

const { name: title, description } = SITE;

// app/opengraph-image.png supplies og:image; on Vercel, Next resolves it against the production domain.
export const metadata: Metadata = {
  title,
  description,
  openGraph: { title, description, siteName: SITE.shortName, type: "website" },
  twitter: { card: "summary_large_image", title, description },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
