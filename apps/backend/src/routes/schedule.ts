import type { Express, Request, Response } from "express";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import { getKillSwitchEnabled } from "../agents/kill-switch.js";
import { getConfig } from "../config.js";
import { setReloadFlag } from "../data/reload-flag.js";
import { env } from "../env.js";

export function registerScheduleRoutes(app: Express, ctx: AppContext): void {
  const { scheduler } = ctx;

  app.get("/api/schedule", async (_req: Request, res: Response) => {
    const tasks = await scheduler.list();
    res.json({ tasks });
  });

  app.post(
    "/api/schedule",
    async (req: Request, res: Response): Promise<void> => {
      if (getKillSwitchEnabled()) {
        res.status(503).json({
          error: `${getConfig().AGENT_NAME} is paused (kill switch).`,
        });
        return;
      }
      const { execute_at, intent, context } = req.body ?? {};
      if (!execute_at || !intent) {
        res.status(400).json({ error: "Missing execute_at or intent." });
        return;
      }
      const id = await scheduler.schedule({
        execute_at,
        intent,
        context: typeof context === "object" ? context : {},
      });
      await setReloadFlag(env.REDIS_URL, "schedule");
      res.status(201).json({ id, execute_at, intent, context: context ?? {} });
    },
  );

  app.delete(
    "/api/schedule/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await scheduler.cancel(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "Scheduled task not found." });
        return;
      }
      await setReloadFlag(env.REDIS_URL, "schedule");
      res.status(204).send();
    },
  );
}
