import { pgTable, serial, integer, boolean, real, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const gameResults = pgTable("game_results", {
  id: serial("id").primaryKey(),
  tierIdx: integer("tier_idx").notNull(),
  padIdx: integer("pad_idx").notNull(),
  betFrac: real("bet_frac").notNull(),
  wealth: real("wealth").notNull(),
  success: boolean("success").notNull(),
  fuelUsed: real("fuel_used").notNull(),
  score: real("score").notNull(),
  createdAt: timestamp("created_at").defaultNow(),
});

export const insertGameResultSchema = createInsertSchema(gameResults).omit({ id: true, createdAt: true });

export type InsertGameResult = z.infer<typeof insertGameResultSchema>;
export type GameResult = typeof gameResults.$inferSelect;
