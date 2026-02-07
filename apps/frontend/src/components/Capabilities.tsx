import { useState } from "react";
import { McpConnections } from "./McpConnections";
import { Skills } from "./Skills";

type CapabilityTab = "mcp" | "skills";

export function Capabilities() {
  const [activeTab, setActiveTab] = useState<CapabilityTab>("mcp");

  return (
    <div className="flex flex-col h-full min-h-0">
      <header className="px-4 md:px-6 py-3 md:py-4 flex flex-col gap-3 shrink-0">
        <div className="min-w-0">
          <h2 className="text-base md:text-lg font-semibold text-white">
            Capabilities
          </h2>
          <p className="text-xs md:text-sm text-hooman-muted truncate">
            Connect tools and services so Hooman can act on your behalf.
          </p>
        </div>
        <div className="flex gap-1 border-b border-hooman-border -mb-px mt-1">
          <button
            type="button"
            onClick={() => setActiveTab("mcp")}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === "mcp"
                ? "border-hooman-accent text-white bg-hooman-surface"
                : "border-transparent text-hooman-muted hover:text-white"
            }`}
          >
            MCP servers
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("skills")}
            className={`px-3 py-2 text-sm font-medium rounded-t-lg border-b-2 transition-colors ${
              activeTab === "skills"
                ? "border-hooman-accent text-white bg-hooman-surface"
                : "border-transparent text-hooman-muted hover:text-white"
            }`}
          >
            Skills
          </button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4 md:p-6 min-h-0">
        {activeTab === "mcp" && <McpConnections />}
        {activeTab === "skills" && <Skills />}
      </div>
    </div>
  );
}
