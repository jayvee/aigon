import { source } from "@/lib/source";

export const revalidate = false;

export function GET() {
  const pages = source.getPages();
  const lines = [
    "# Aigon",
    "",
    "> Spec-driven development and multi-agent orchestration.",
    "",
    "## Docs",
    "",
    ...pages.map((page) => `- [${page.data.title}](https://aigon.build${page.url})`),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
