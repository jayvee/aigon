import type { MDXComponents } from "mdx/types";
import { TerminalWindow } from "@/components/terminal-window";

export function getMDXComponents(components?: MDXComponents) {
  return {
    TerminalWindow,
    ...components,
  } satisfies MDXComponents;
}

export const useMDXComponents = getMDXComponents;
