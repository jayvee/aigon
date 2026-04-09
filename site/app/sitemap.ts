import type { MetadataRoute } from "next";
import { glob } from "fast-glob";
import { resolve } from "node:path";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const contentDir = resolve(process.cwd(), "content");
  const files = await glob("**/*.mdx", { cwd: contentDir });

  const pages = files.map((file) => {
    // content/index.mdx → /docs, content/getting-started.mdx → /docs/getting-started
    const slug = file
      .replace(/\/index\.mdx$/, "")
      .replace(/\.mdx$/, "");

    const url = slug === "index"
      ? "https://www.aigon.build/docs"
      : `https://www.aigon.build/docs/${slug}`;

    return { url, lastModified: new Date() };
  });

  // Add the landing page and top-level marketing routes
  pages.unshift(
    { url: "https://www.aigon.build", lastModified: new Date() },
    { url: "https://www.aigon.build/pro", lastModified: new Date() },
  );

  return pages;
}
