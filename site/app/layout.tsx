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
    default: "Aigon | Spec-Driven AI Development & Multi-Agent Orchestration",
    template: "%s | Aigon",
  },
  description:
    "Aigon is a CLI-first, vendor-independent workflow for research, feature delivery, and feedback loops across Claude, Gemini, Codex, and Cursor.",
  metadataBase: new URL("https://aigon.build"),
  openGraph: {
    title: "Aigon | Spec-Driven Multi-Agent Orchestration",
    description:
      "Spec-driven development and multi-agent orchestration — run one agent or orchestrate competing implementations in parallel, then evaluate and merge the best outcome.",
    type: "website",
    url: "https://aigon.build",
  },
  icons: {
    icon: [
      { url: "/img/aigon-icon-32.svg", type: "image/svg+xml" },
      { url: "/img/favicon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/img/favicon-16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/img/favicon-32.png",
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
    <span>MIT {new Date().getFullYear()} &copy; Aigon</span>
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
