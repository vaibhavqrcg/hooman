import type { Express, Request, Response } from "express";
import createDebug from "debug";
import type { AppContext } from "./helpers.js";
import { getConfig, updateConfig } from "../config.js";
import {
  getKillSwitchEnabled,
  setKillSwitchEnabled,
} from "../agents/kill-switch.js";

const debug = createDebug("hooman:routes:settings");

export function registerSettingsRoutes(app: Express, _ctx: AppContext): void {
  app.get("/api/config", (_req: Request, res: Response) => {
    const c = getConfig();
    res.json({
      OPENAI_API_KEY: c.OPENAI_API_KEY,
      OPENAI_MODEL: c.OPENAI_MODEL,
      OPENAI_EMBEDDING_MODEL: c.OPENAI_EMBEDDING_MODEL,
      OPENAI_WEB_SEARCH: c.OPENAI_WEB_SEARCH,
      MCP_USE_SERVER_MANAGER: c.MCP_USE_SERVER_MANAGER,
      OPENAI_TRANSCRIPTION_MODEL: c.OPENAI_TRANSCRIPTION_MODEL,
    });
  });

  app.patch("/api/config", (req: Request, res: Response): void => {
    const patch = req.body as Record<string, unknown>;
    if (!patch || typeof patch !== "object") {
      res.status(400).json({ error: "Invalid body." });
      return;
    }
    const updated = updateConfig({
      OPENAI_API_KEY: patch.OPENAI_API_KEY as string | undefined,
      OPENAI_MODEL: patch.OPENAI_MODEL as string | undefined,
      OPENAI_EMBEDDING_MODEL: patch.OPENAI_EMBEDDING_MODEL as
        | string
        | undefined,
      OPENAI_WEB_SEARCH: patch.OPENAI_WEB_SEARCH as boolean | undefined,
      MCP_USE_SERVER_MANAGER: patch.MCP_USE_SERVER_MANAGER as
        | boolean
        | undefined,
      OPENAI_TRANSCRIPTION_MODEL: patch.OPENAI_TRANSCRIPTION_MODEL as
        | string
        | undefined,
    });
    res.json(updated);
  });

  app.post(
    "/api/realtime/client-secret",
    async (req: Request, res: Response) => {
      const config = getConfig();
      const apiKey = config.OPENAI_API_KEY?.trim();
      if (!apiKey) {
        res.status(400).json({
          error: "OPENAI_API_KEY not configured. Set it in Settings.",
        });
        return;
      }
      const model =
        (req.body as { model?: string })?.model ??
        config.OPENAI_TRANSCRIPTION_MODEL;
      try {
        const response = await fetch(
          "https://api.openai.com/v1/realtime/client_secrets",
          {
            method: "POST",
            headers: {
              Authorization: `Bearer ${apiKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              expires_after: { anchor: "created_at", seconds: 300 },
              session: {
                type: "transcription",
                audio: {
                  input: {
                    format: { type: "audio/pcm", rate: 24000 },
                    noise_reduction: { type: "near_field" },
                    transcription: {
                      model: model || "gpt-4o-transcribe",
                      prompt: "",
                      language: "en",
                    },
                    turn_detection: {
                      type: "server_vad",
                      threshold: 0.5,
                      prefix_padding_ms: 300,
                      silence_duration_ms: 500,
                    },
                  },
                },
              },
            }),
          },
        );
        if (!response.ok) {
          const err = await response.text();
          debug("realtime client_secrets error: %s", err);
          res
            .status(response.status)
            .json({ error: err || "Failed to create client secret." });
          return;
        }
        const data = (await response.json()) as { value: string };
        res.json({ value: data.value });
      } catch (err) {
        debug("realtime client-secret error: %o", err);
        res
          .status(500)
          .json({ error: "Failed to create transcription session." });
      }
    },
  );

  app.get("/api/safety/kill-switch", (_req: Request, res: Response) => {
    res.json({ enabled: getKillSwitchEnabled() });
  });

  app.post("/api/safety/kill-switch", (req: Request, res: Response) => {
    setKillSwitchEnabled(Boolean(req.body?.enabled));
    res.json({ enabled: getKillSwitchEnabled() });
  });
}
