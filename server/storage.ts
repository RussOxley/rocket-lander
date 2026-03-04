import { db } from "./db";
import { sql } from "drizzle-orm";
import {
  gameResults,
  type InsertGameResult,
  type GameResult
} from "@shared/schema";

export type MarketBookCell = { s: number; f: number };
export type MarketBook = MarketBookCell[][];

export interface IStorage {
  getGameResults(): Promise<GameResult[]>;
  createGameResult(result: InsertGameResult): Promise<GameResult>;
  getMarketBook(numTiers: number, numPads: number): Promise<MarketBook>;
}

export class DatabaseStorage implements IStorage {
  async getGameResults(): Promise<GameResult[]> {
    return await db.select().from(gameResults);
  }

  async createGameResult(result: InsertGameResult): Promise<GameResult> {
    const [inserted] = await db.insert(gameResults)
      .values(result)
      .returning();
    return inserted;
  }

  async getMarketBook(numTiers: number, numPads: number): Promise<MarketBook> {
    const rows = await db
      .select({
        tierIdx: gameResults.tierIdx,
        padIdx: gameResults.padIdx,
        s: sql<number>`count(*) filter (where ${gameResults.success} = true)`.as("s"),
        f: sql<number>`count(*) filter (where ${gameResults.success} = false)`.as("f"),
      })
      .from(gameResults)
      .groupBy(gameResults.tierIdx, gameResults.padIdx);

    const book: MarketBook = Array.from({ length: numTiers }, () =>
      Array.from({ length: numPads }, () => ({ s: 0, f: 0 }))
    );

    for (const row of rows) {
      if (row.tierIdx >= 0 && row.tierIdx < numTiers && row.padIdx >= 0 && row.padIdx < numPads) {
        book[row.tierIdx][row.padIdx] = { s: Number(row.s), f: Number(row.f) };
      }
    }

    return book;
  }
}

export const storage = new DatabaseStorage();
