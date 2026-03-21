import "./global.css";
import type { Metadata } from "next";
import { Geist, Geist_Mono, Sora } from "next/font/google";
import { RootProvider } from "fumadocs-ui/provider";
import type { ReactNode } from "react";

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

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${geist.variable} ${geistMono.variable} ${sora.variable}`}

      suppressHydrationWarning
    >
      <body className="font-[family-name:var(--font-geist-sans)]">
        <RootProvider
          theme={{
            defaultTheme: "dark",
          }}
        >
          {children}
        </RootProvider>
      </body>
    </html>
  );
}
