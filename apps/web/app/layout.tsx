import type { Metadata } from "next";
import "../../../packages/ui/src/styles.css";
import "./globals.css";

/** Every page is rendered per request, so Next can put each request's CSP nonce on its own scripts. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: {
    default: "Raring2go! Business-in-a-Box",
    template: "%s · Raring2go!"
  },
  description: "The Raring2go! franchise and publishing operating system.",
  applicationName: "Raring2go! Business-in-a-Box"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
