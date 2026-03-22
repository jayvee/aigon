import { readFileSync } from "fs";
import { join } from "path";

export default function HomePage() {
  const html = readFileSync(
    join(process.cwd(), "public", "index.html"),
    "utf-8"
  );

  // Extract just the body content (between <body> and </body>)
  const bodyMatch = html.match(/<body[^>]*>([\s\S]*)<\/body>/i);
  const bodyContent = bodyMatch ? bodyMatch[1] : html;

  // Extract the CSS link and inline styles
  const cssLink = '<link rel="stylesheet" href="/css/style.css">';
  const scriptTag =
    '<script src="https://cdn.jsdelivr.net/gh/atteggiani/animated-terminal@3.1/animated-terminal.min.js" defer></script>';

  return (
    <>
      <div
        dangerouslySetInnerHTML={{
          __html: cssLink + bodyContent + scriptTag,
        }}
      />
    </>
  );
}
