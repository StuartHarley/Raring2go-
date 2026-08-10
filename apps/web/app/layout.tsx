import type { Metadata } from "next";
import "./globals.css";

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
