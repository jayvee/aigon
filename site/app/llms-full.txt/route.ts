import { source } from "@/lib/source";

export const revalidate = false;

export async function GET() {
  const pages = source.getPages();
  const sections = await Promise.all(
    pages.map(async (page) => {
      return `# ${page.data.title}\n\nURL: https://aigon.build${page.url}\n${page.data.description ? `\n${page.data.description}\n` : ""}`;
    }),
  );

  const content = [
    "# Aigon — Full Documentation",
    "",
    "Spec-driven development and multi-agent orchestration.",
    "",
    ...sections,
  ].join("\n");

  return new Response(content, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
