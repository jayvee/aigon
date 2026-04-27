import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const revalidate = false;

async function getMdxFiles(dir: string, prefix = ""): Promise<{ path: string; title: string; description: string }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { path: string; title: string; description: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...await getMdxFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith(".mdx")) {
      const content = await readFile(join(dir, entry.name), "utf-8");
      const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
      const slug = entry.name === "index.mdx"
        ? prefix.replace(/\/$/, "")
        : `${prefix}${entry.name.replace(/\.mdx$/, "")}`;
      results.push({
        path: slug ? `/docs/${slug}` : "/docs",
        title: titleMatch?.[1] ?? slug,
        description: descMatch?.[1] ?? "",
      });
    }
  }

  return results;
}

export async function GET() {
  const contentDir = join(process.cwd(), "content");
  const pages = await getMdxFiles(contentDir);
  const sections = pages.map((page) => {
    return `# ${page.title}\n\nURL: https://www.aigon.build${page.path}\n${page.description ? `\n${page.description}\n` : ""}`;
  });

  const content = [
    "# Aigon — Full Documentation",
    "",
    "Aigon is a spec-driven multi-agent harness — orchestrate Claude Code, Gemini CLI, and Codex CLI from one Kanban board, one CLI, or one slash command.",
    "",
    ...sections,
  ].join("\n");

  return new Response(content, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
