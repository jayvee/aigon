import type { MDXComponents } from "mdx/types";
import { TerminalWindow } from "@/components/terminal-window";
import { Screenshot } from "@/components/Screenshot";

export function getMDXComponents(components?: MDXComponents) {
  return {
    TerminalWindow,
    Screenshot,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
