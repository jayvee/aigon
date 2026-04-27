import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const revalidate = false;

async function getMdxFiles(dir: string, prefix = ""): Promise<{ path: string; title: string }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { path: string; title: string }[] = [];

  for (const entry of entries) {
    if (entry.isDirectory()) {
      results.push(...await getMdxFiles(join(dir, entry.name), `${prefix}${entry.name}/`));
    } else if (entry.name.endsWith(".mdx")) {
      const content = await readFile(join(dir, entry.name), "utf-8");
      const titleMatch = content.match(/^title:\s*["']?(.+?)["']?\s*$/m);
      const slug = entry.name === "index.mdx"
        ? prefix.replace(/\/$/, "")
        : `${prefix}${entry.name.replace(/\.mdx$/, "")}`;
      results.push({
        path: slug ? `/docs/${slug}` : "/docs",
        title: titleMatch?.[1] ?? slug,
      });
    }
  }

  return results;
}

export async function GET() {
  const contentDir = join(process.cwd(), "content");
  const pages = await getMdxFiles(contentDir);
  const lines = [
    "# Aigon",
    "",
    "> Aigon: spec-driven multi-agent harness. Feature lifecycle, git-worktree isolation, slash-command orchestration of Claude Code / Gemini CLI / Codex CLI.",
    "",
    "## Docs",
    "",
    ...pages.map((page) => `- [${page.title}](https://www.aigon.build${page.path})`),
  ];

  return new Response(lines.join("\n"), {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
