import type { ReactNode } from "react";

export function ProBadge() {
  return (
    <sup
      style={{
        marginLeft: 4,
        padding: "1px 5px",
        fontSize: "0.55em",
        fontWeight: 600,
        letterSpacing: "0.08em",
        color: "#d55f2a",
        backgroundColor: "rgba(213, 95, 42, 0.12)",
        border: "1px solid rgba(213, 95, 42, 0.35)",
        borderRadius: 3,
        textTransform: "uppercase",
        lineHeight: 1,
        verticalAlign: "super",
        whiteSpace: "nowrap",
      }}
    >
      Pro
    </sup>
  );
}

export function withPro(label: ReactNode): ReactNode {
  return (
    <span>
      {label}
      <ProBadge />
    </span>
  );
}
