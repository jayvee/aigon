"use client";

import { useState } from "react";

const views = [
  {
    id: "kanban",
    label: "Pipeline",
    src: "/img/aigon-dashboard-kanban.png",
    alt: "Aigon Dashboard Kanban board showing feature cards in inbox, backlog, in-progress, evaluation, and done columns",
  },
  {
    id: "monitor",
    label: "Monitor",
    src: "/img/aigon-dashboard-monitor.png",
    alt: "Aigon Dashboard Monitor view showing active agent sessions",
  },
  {
    id: "statistics",
    label: "Statistics",
    src: "/img/aigon-dashboard-statistics.png",
    alt: "Aigon Dashboard Statistics tab showing features completed over time and cycle time chart",
  },
  {
    id: "logs",
    label: "Logs",
    src: "/img/aigon-dashboard-logs.png",
    alt: "Aigon Dashboard Logs view showing agent session output",
  },
  {
    id: "console",
    label: "Console",
    src: "/img/aigon-dashboard-console.png",
    alt: "Aigon Dashboard Console view showing live terminal output",
  },
];

export function DashboardGallery() {
  const [active, setActive] = useState("kanban");
  const view = views.find((v) => v.id === active) ?? views[0];

  return (
    <div>
      <div className="flex gap-1 mb-4" role="tablist" aria-label="Dashboard views">
        {views.map((v) => (
          <button
            key={v.id}
            onClick={() => setActive(v.id)}
            role="tab"
            aria-selected={active === v.id}
            className={`px-4 py-2 text-sm rounded-lg transition-all ${
              active === v.id
                ? "bg-aigon-orange text-white"
                : "landing-tab text-muted"
            }`}
          >
            {v.label}
          </button>
        ))}
      </div>
      <div className="rounded-xl landing-image overflow-hidden">
        <img
          src={view.src}
          alt={view.alt}
          className="w-full"
          loading="lazy"
        />
      </div>
    </div>
  );
}
