import { useMDXComponents as getDocsComponents } from "nextra-theme-docs";
import { TerminalWindow } from "@/components/terminal-window";

export function useMDXComponents(components?: Record<string, unknown>) {
  return getDocsComponents({
    ...components,
    TerminalWindow,
  } as any);
}
