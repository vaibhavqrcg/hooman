import type { Express, Request, Response } from "express";
import type { AppContext } from "./helpers.js";
import { getParam } from "./helpers.js";
import type { ColleagueConfig } from "../types.js";

export function registerColleagueRoutes(app: Express, ctx: AppContext): void {
  const { colleagueEngine } = ctx;

  app.get("/api/colleagues", (_req: Request, res: Response) => {
    res.json({ colleagues: colleagueEngine.getAll() });
  });

  app.post(
    "/api/colleagues",
    async (req: Request, res: Response): Promise<void> => {
      const body = req.body as ColleagueConfig;
      if (!body?.id) {
        res.status(400).json({ error: "Missing colleague id." });
        return;
      }
      await colleagueEngine.addOrUpdate(body);
      res.status(201).json({ colleague: colleagueEngine.getById(body.id) });
    },
  );

  app.patch(
    "/api/colleagues/:id",
    async (req: Request, res: Response): Promise<void> => {
      const id = getParam(req, "id");
      const existing = colleagueEngine.getById(id);
      if (!existing) {
        res.status(404).json({ error: "Colleague not found." });
        return;
      }
      await colleagueEngine.addOrUpdate({
        ...existing,
        ...req.body,
        id,
      });
      res.json({ colleague: colleagueEngine.getById(id) });
    },
  );

  app.delete(
    "/api/colleagues/:id",
    async (req: Request, res: Response): Promise<void> => {
      const ok = await colleagueEngine.remove(getParam(req, "id"));
      if (!ok) {
        res.status(404).json({ error: "Colleague not found." });
        return;
      }
      res.status(204).send();
    },
  );
}
