import type { Metadata } from "next";
import Link from "next/link";
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
      <body>
        <header className="site-header">
          <div className="site-header__inner">
            <Link className="site-header__brand" href="/">
              PassArk
            </Link>
            <nav aria-label="Primary" className="site-header__nav">
              <Link href="/login">Sign in</Link>
              <Link href="/operator">Operator shell</Link>
            </nav>
          </div>
        </header>
        {children}
      </body>
    </html>
  );
}
