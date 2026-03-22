import { useMDXComponents as getNextraComponents } from "nextra/mdx-components";
import { TerminalWindow } from "@/components/terminal-window";

export function useMDXComponents(components?: Record<string, unknown>) {
  return getNextraComponents({
    ...components,
    TerminalWindow,
  } as any);
}
