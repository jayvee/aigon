import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";

export const revalidate = false;

const MAX_BYTES = 1024 * 1024;

async function getMdxFiles(dir: string, prefix = ""): Promise<{ path: string; title: string; description: string; body: string }[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const results: { path: string; title: string; description: string; body: string }[] = [];

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
        body: content.replace(/^---[\s\S]*?---\s*/, "").trim(),
      });
    }
  }

  return results;
}

export async function GET() {
  const contentDir = join(process.cwd(), "content");
  const pages = await getMdxFiles(contentDir);
  const sections = pages.map((page) => {
    return `# ${page.title}\n\nURL: https://www.aigon.build${page.path}\n${page.description ? `\n${page.description}\n` : ""}\n${page.body}\n`;
  });

  const content = [
    "# Aigon — Full Documentation",
    "",
    "Aigon is a spec-driven multi-agent harness — orchestrate local agent CLIs such as Claude Code, Antigravity CLI, Codex CLI, Cursor, OpenCode, and Kimi from one Kanban board, one CLI, or one agent command.",
    "",
    ...sections,
  ].join("\n");

  const bytes = Buffer.byteLength(content, "utf8");
  if (bytes > MAX_BYTES) {
    const largest = pages.map(page => ({ path: page.path, bytes: Buffer.byteLength(page.body, "utf8") }))
      .sort((a, b) => b.bytes - a.bytes).slice(0, 10).map(page => `${page.path}: ${page.bytes} bytes`).join("; ");
    return new Response(`llms-full.txt exceeds the 1 MiB release cap (${bytes} bytes). Largest pages: ${largest}`, { status: 500 });
  }
  return new Response(content, {
    headers: { "Content-Type": "text/plain; charset=utf-8" },
  });
}
