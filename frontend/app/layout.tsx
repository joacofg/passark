import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "PassArk",
  description: "Single-company access and secret operations workspace.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
