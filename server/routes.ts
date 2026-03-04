import type { Express } from "express";
import type { Server } from "http";
import { storage } from "./storage";
import { api, errorSchemas } from "@shared/routes";
import { z } from "zod";

export async function registerRoutes(
  httpServer: Server,
  app: Express
): Promise<Server> {

  app.get(api.gameResults.list.path, async (req, res) => {
    const results = await storage.getGameResults();
    res.json(results);
  });

  app.get(api.marketBook.get.path, async (req, res) => {
    const numTiers = parseInt(req.query.tiers as string) || 10;
    const numPads = parseInt(req.query.pads as string) || 3;
    const book = await storage.getMarketBook(numTiers, numPads);
    res.json(book);
  });

  app.post(api.gameResults.create.path, async (req, res) => {
    try {
      const input = api.gameResults.create.input.parse(req.body);
      const result = await storage.createGameResult(input);
      res.status(201).json(result);
    } catch (err) {
      if (err instanceof z.ZodError) {
        return res.status(400).json({
          message: err.errors[0].message,
          field: err.errors[0].path.join('.'),
        });
      }
      throw err;
    }
  });

  return httpServer;
}
