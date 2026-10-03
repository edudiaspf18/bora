import type { Metadata } from "next";
import { Fraunces, Geist, Inter } from "next/font/google";
import "./globals.css";

// Nonce de CSP exige render dinâmico em todas as páginas.
export const dynamic = "force-dynamic";

const geist = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const editorial = Fraunces({ subsets: ["latin"], variable: "--font-editorial" });

export const metadata: Metadata = {
  title: { default: "Bora", template: "%s · Bora" },
  description: "Cardápio digital e pedidos para o seu negócio de comida.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="pt-BR"
      className={`${geist.variable} ${inter.variable} ${editorial.variable}`}
    >
      <body className="min-h-dvh bg-background font-sans text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
