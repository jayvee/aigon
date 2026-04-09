import "./global.css";
import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { Footer, Layout, Navbar } from "nextra-theme-docs";
import { Head } from "nextra/components";
import { getPageMap } from "nextra/page-map";
import { Analytics } from "@vercel/analytics/next";
import "nextra-theme-docs/style.css";

const geist = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
});

const geistMono = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
});

const sora = Sora({
  subsets: ["latin"],
  variable: "--font-sora",
});

export const metadata: Metadata = {
  title: {
    default: "Aigon | Open-Source AI Agent Orchestration",
    template: "%s | Aigon",
  },
  description:
    "Aigon is an open-source, spec-driven orchestration system for AI coding agents — run them head-to-head on the same feature, then score their work so you can ship with confidence.",
  metadataBase: new URL("https://www.aigon.build"),
  openGraph: {
    title: "Aigon | Open-Source AI Agent Orchestration",
    description:
      "Aigon is an open-source, spec-driven orchestration system for AI coding agents — run them head-to-head on the same feature, then score their work so you can ship with confidence.",
    type: "website",
    url: "https://www.aigon.build",
    siteName: "Aigon",
    images: [
      {
        url: "/img/og-image.png",
        width: 1200,
        height: 630,
        alt: "Aigon — run AI coding agents head-to-head, ship the best one",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Aigon | Open-Source AI Agent Orchestration",
    description:
      "Open-source orchestration for Claude, Gemini, Cursor, and Codex — run them head-to-head and ship the best implementation.",
    images: ["/img/og-image.png"],
  },
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "48x48" },
      { url: "/img/aigon-icon.svg", type: "image/svg+xml" },
      { url: "/img/favicon-192.png", sizes: "192x192", type: "image/png" },
    ],
    apple: "/img/apple-touch-icon.png",
  },
};

const logo = (
  <span className="flex items-center gap-2 font-semibold">
    <img
      src="/img/aigon-icon.svg"
      alt=""
      width={20}
      height={20}
      aria-hidden
    />
    Aigon
  </span>
);

const navbar = (
  <Navbar
    logo={logo}
    logoLink="/"
    projectLink="https://github.com/jayvee/aigon"
  />
);

const footer = (
  <Footer>
    <span>Apache 2.0 · {new Date().getFullYear()} &copy; Sen Labs</span>
    <span> · <a href="https://senlabs.ai" target="_blank" rel="noopener noreferrer">senlabs.ai</a></span>
  </Footer>
);

export default async function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      dir="ltr"
      className={`${geist.variable} ${geistMono.variable} ${sora.variable}`}
      suppressHydrationWarning
    >
      <Head />
      <body className="font-[family-name:var(--font-geist-sans)]">
        <Layout
          navbar={navbar}
          footer={footer}
          pageMap={await getPageMap()}
          docsRepositoryBase="https://github.com/jayvee/aigon/tree/main/site/content"
          sidebar={{ defaultMenuCollapseLevel: 1 }}
          darkMode={true}
          nextThemes={{
            defaultTheme: "light",
            attribute: "class",
            storageKey: "theme",
          }}
        >
          {children}
        </Layout>
        <Analytics />
      </body>
    </html>
  );
}
