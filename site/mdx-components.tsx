import { useMDXComponents as getDocsComponents } from "nextra-theme-docs";
import { TerminalWindow } from "@/components/terminal-window";
import { Screenshot } from "@/components/Screenshot";

export function useMDXComponents(components?: Record<string, unknown>) {
  return getDocsComponents({
    ...components,
    TerminalWindow,
    Screenshot,
  } as any);
}
