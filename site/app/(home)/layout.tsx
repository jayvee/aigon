import type { ReactNode } from "react";
import { HomeLayout } from "fumadocs-ui/layouts/home";

export default function Layout({ children }: { children: ReactNode }) {
  return (
    <HomeLayout
      nav={{
        title: (
          <span className="flex items-center gap-2 font-semibold">
            <img
              src="/img/aigon-icon.svg"
              alt=""
              width={20}
              height={20}
              aria-hidden
            />
            Aigon
          </span>
        ),
        url: "/",
      }}
      links={[
        { text: "Docs", url: "/docs" },
        {
          text: "GitHub",
          url: "https://github.com/jayvee/aigon",
          external: true,
        },
      ]}
    >
      {children}
    </HomeLayout>
  );
}
