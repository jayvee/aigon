# Research Findings: new docs site

**Agent:** Gemini (gg)
**Research ID:** 17
**Date:** 2026-03-21

---

## Key Findings

### Spec-Kitty.ai Framework
Based on source code analysis, `spec-kitty.ai` uses **Fumadocs**. This is evidenced by its Next.js foundation, characteristic UI structure (like its Cmd+K search), and specific utility classes common to Fumadocs implementations. 

### Leading Documentation Frameworks in 2026
*   **Fumadocs & Nextra (Next.js):** Highly popular for modern developer tools, especially in the Vercel ecosystem. They provide seamless integration with Next.js, making it easy to blend landing pages and documentation.
*   **Docusaurus:** The gold standard for complex, highly versioned open-source projects. Extremely robust but can be heavy.
*   **Starlight (Astro):** Rapidly growing due to its extreme performance (zero JS by default) and excellent developer experience.
*   **Mintlify:** The top hosted/AI-native choice. Great for minimal setup, but less customizable since it's closed-source/hosted.

### Framework Features Support
*   **MDX, Dark Mode, Search:** Supported out-of-the-box by Docusaurus, Nextra, Fumadocs, Starlight, and Mintlify.
*   **Versioning:** Docusaurus is best-in-class for versioning. Fumadocs also handles this well.
*   **API/CLI Auto-generation:** Mintlify and Fumadocs excel at auto-generation. For CLI tools specifically, generating MDX files via a pre-build script from the CLI's source code works beautifully across all these frameworks.
*   **Vercel Deployment:** Nextra and Fumadocs are first-class citizens on Vercel. Starlight and Docusaurus also deploy to Vercel easily.

### Comparable CLI Tools Analysis
*   **Turborepo:** Nextra
*   **Railway CLI:** Nextra
*   **pnpm:** Docusaurus
*   **Wrangler:** Hugo
*   **Cursor:** Mintlify

### Current Site & Migration Strategy
*   **Current aigon-site (`~/src/aigon-site`):** The current site is built with vanilla static HTML and CSS. There is no existing complex build system to preserve.
*   **Migration:** Rebuilding from scratch is recommended. You can migrate the static assets (images, fonts) and port the existing HTML structure into the new framework's landing page components. 
*   **Structure:** The docs should replace the entire site. Frameworks like Fumadocs and Nextra easily support a custom marketing landing page alongside `/docs` routes within the same Next.js application, reducing maintenance overhead.

### Content Strategy
*   **Reusing Markdown:** `README.md` and `GUIDE.md` provide a fantastic starting point. `GUIDE.md` is already effectively a dense documentation site in a single file. This content can be directly split into MDX pages.
*   **CLI Auto-generation:** It is strongly recommended to auto-generate the CLI command reference. The `lib/commands/` directory is well-structured, so a simple Node script can output an MDX file with all commands, flags, and descriptions, ensuring the docs never fall out of sync with the CLI.
*   **Minimum Viable Structure:**
    1. Getting Started (Installation, Quick Start)
    2. Core Concepts (Drive, Fleet, Lifecycles)
    3. User Guides (Features, Research, Feedback workflows)
    4. CLI Reference (Auto-generated)
    5. Configuration (Project profiles, hooks, settings)
    6. Architecture (Dev Proxy, Dashboard)

## Sources
*   Spec-Kitty docs inspection (https://spec-kitty.ai/)
*   Framework analysis: Nextra (turbo.build), Docusaurus (pnpm.io), Mintlify (docs.cursor.com).
*   Aigon repository `GUIDE.md` and `~/src/aigon-site` local inspection.

## Recommendation

**Use Fumadocs to completely replace `aigon.build`.** 
Given the user's affinity for `spec-kitty.ai` (which uses Fumadocs) and Aigon's Vercel-adjacent tooling nature, a Next.js-based framework is ideal. Fumadocs offers a beautiful, modern aesthetic out of the box, excellent MDX support, and allows you to build a custom landing page in standard React alongside your documentation. It avoids the lock-in of Mintlify and the heaviness of Docusaurus. 

The content from `GUIDE.md` should be split into individual MDX pages, and a pre-build script should be added to the Aigon repo to export the CLI reference to MDX automatically.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| docs-framework-setup | Initialize Fumadocs/Next.js project to replace the existing static site | high | none |
| docs-content-migration | Split `GUIDE.md` and `README.md` into structured MDX pages | high | docs-framework-setup |
| cli-reference-generator | Script in Aigon CLI to auto-generate markdown documentation for all commands | medium | none |
| landing-page-rebuild | Rebuild the current aigon.build landing page using React/Tailwind within the new framework | high | docs-framework-setup |
| search-integration | Configure Cmd+K search (Algolia or local) across the documentation | medium | docs-framework-setup |