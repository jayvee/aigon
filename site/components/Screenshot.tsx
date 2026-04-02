import fs from "fs";
import path from "path";

interface ScreenshotProps {
  src: string;
  alt: string;
  caption?: string;
}

export function Screenshot({ src, alt, caption }: ScreenshotProps) {
  const filePath = path.join(process.cwd(), "public", src);
  const exists = fs.existsSync(filePath);

  if (!exists) {
    return (
      <div
        style={{
          border: "2px dashed var(--fd-border, #d1d5db)",
          borderRadius: "0.5rem",
          padding: "2rem 1.5rem",
          textAlign: "center",
          background: "var(--fd-muted, #f9fafb)",
          margin: "1.5rem 0",
        }}
      >
        <p
          style={{
            fontSize: "0.75rem",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
            color: "var(--fd-muted-foreground, #9ca3af)",
            margin: "0 0 0.5rem",
          }}
        >
          Screenshot coming soon
        </p>
        <p
          style={{
            fontSize: "0.875rem",
            color: "var(--fd-foreground, #6b7280)",
            margin: 0,
          }}
        >
          {alt}
        </p>
      </div>
    );
  }

  return (
    <figure style={{ margin: "1.5rem 0" }}>
      <img
        src={src}
        alt={alt}
        style={{
          width: "100%",
          borderRadius: "0.5rem",
          border: "1px solid var(--fd-border, #e5e7eb)",
        }}
      />
      {caption && (
        <figcaption
          style={{
            textAlign: "center",
            fontSize: "0.875rem",
            color: "var(--fd-muted-foreground, #6b7280)",
            marginTop: "0.5rem",
          }}
        >
          {caption}
        </figcaption>
      )}
    </figure>
  );
}
