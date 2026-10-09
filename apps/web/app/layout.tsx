import type { Metadata } from "next";
import "../../../packages/ui/src/styles.css";
import "./globals.css";

/** Every page is rendered per request, so Next can put each request's CSP nonce on its own scripts. */
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Raring2go Business-in-a-Box",
  description: "Foundation bootstrap for the Raring2go operating system."
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
