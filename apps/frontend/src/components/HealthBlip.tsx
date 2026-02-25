import { useEffect, useState } from "react";
import { getHealth } from "../api";

type HealthStatus = "ok" | "degraded" | "error" | "loading";

export function HealthBlip() {
  const [status, setStatus] = useState<HealthStatus>("loading");
  const [latency, setLatency] = useState<number | null>(null);

  const checkHealth = async () => {
    try {
      const start = Date.now();
      const data = await getHealth();
      setLatency(Date.now() - start);

      if (data.status === "ok") {
        setStatus("ok");
      } else {
        setStatus("degraded");
      }
    } catch (err) {
      console.error("Health check failed", err);
      setStatus("error");
      setLatency(null);
    }
  };

  useEffect(() => {
    checkHealth();
    const interval = setInterval(checkHealth, 60000); // Poll every minute
    return () => clearInterval(interval);
  }, []);

  const getStatusColor = () => {
    switch (status) {
      case "ok":
        return "bg-emerald-500";
      case "degraded":
        return "bg-amber-500";
      case "error":
        return "bg-rose-500";
      default:
        return "bg-zinc-500";
    }
  };

  const getStatusLabel = () => {
    switch (status) {
      case "ok":
        return "API Healthy";
      case "degraded":
        return "API Degraded";
      case "error":
        return "API Unreachable";
      default:
        return "Checking status...";
    }
  };

  return (
    <div className="relative group flex items-center">
      <div
        className={`w-2 h-2 rounded-full ${getStatusColor()} transition-colors duration-500 relative`}
        aria-hidden="true"
      >
        {status === "ok" && (
          <div className="absolute inset-0 rounded-full bg-emerald-500 animate-ping opacity-75"></div>
        )}
      </div>

      {/* Tooltip */}
      <div className="invisible group-hover:visible absolute left-full ml-2 px-2 py-1 bg-hooman-surface border border-hooman-border rounded text-[10px] text-white whitespace-nowrap z-50 shadow-xl">
        <div className="font-medium">{getStatusLabel()}</div>
        {latency !== null && (
          <div className="text-zinc-400">Latency: {latency}ms</div>
        )}
      </div>
    </div>
  );
}
