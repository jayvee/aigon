"use client";

import { useEffect, useRef, useState } from "react";

interface TerminalLine {
  type: "input" | "output";
  text: string;
  delay?: number;
}

interface TerminalWindowProps {
  lines: TerminalLine[];
  ps1?: string;
  title?: string;
  startDelay?: number;
  className?: string;
}

export function TerminalWindow({
  lines,
  ps1 = "> ",
  title = "Terminal",
  startDelay = 400,
  className = "",
}: TerminalWindowProps) {
  const [visibleLines, setVisibleLines] = useState<number>(0);
  const [typingIndex, setTypingIndex] = useState<number>(0);
  const [currentTyped, setCurrentTyped] = useState("");
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (visibleLines >= lines.length) return;

    const line = lines[visibleLines];
    const delay =
      visibleLines === 0 ? startDelay : (line.delay ?? (line.type === "input" ? 400 : 80));

    if (line.type === "input" && typingIndex < line.text.length) {
      const charDelay = 30 + Math.random() * 40;
      const timer = setTimeout(() => {
        setCurrentTyped(line.text.slice(0, typingIndex + 1));
        setTypingIndex(typingIndex + 1);
      }, typingIndex === 0 ? delay : charDelay);
      return () => clearTimeout(timer);
    }

    const timer = setTimeout(() => {
      setVisibleLines(visibleLines + 1);
      setTypingIndex(0);
      setCurrentTyped("");
    }, line.type === "input" ? 200 : delay);

    return () => clearTimeout(timer);
  }, [visibleLines, typingIndex, lines, startDelay]);

  useEffect(() => {
    if (containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight;
    }
  }, [visibleLines, currentTyped]);

  return (
    <div
      className={`rounded-xl terminal-window overflow-hidden ${className}`}
    >
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-white/[0.06] bg-aigon-terminal">
        <span className="size-3 rounded-full bg-[#ff5f57]" />
        <span className="size-3 rounded-full bg-[#febc2e]" />
        <span className="size-3 rounded-full bg-[#28c840]" />
        <span className="ml-2 text-xs text-gray-400 font-mono">
          {title}
        </span>
      </div>
      <div
        ref={containerRef}
        className="p-4 font-mono text-sm leading-relaxed h-[320px] overflow-y-auto text-aigon-terminal-text"
      >
        {lines.slice(0, visibleLines).map((line, i) => (
          <div key={i} className="whitespace-pre-wrap">
            {line.type === "input" ? (
              <span>
                <span className="text-aigon-teal">{ps1}</span>
                {line.text}
              </span>
            ) : (
              <span className="text-gray-400">{line.text}</span>
            )}
          </div>
        ))}
        {visibleLines < lines.length && lines[visibleLines].type === "input" && (
          <div className="whitespace-pre-wrap">
            <span className="text-aigon-teal">{ps1}</span>
            {currentTyped}
            <span className="animate-pulse">_</span>
          </div>
        )}
      </div>
    </div>
  );
}
