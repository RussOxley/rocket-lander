import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, buildUrl } from "@shared/routes";
import type { InsertGameResult, GameResult } from "@shared/schema";

// Custom helper to parse and log Zod errors nicely
function parseResponse<T>(schema: any, data: unknown, label: string): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    console.error(`[Zod Error] ${label} validation failed:`, result.error.format());
    throw new Error(`Data validation failed for ${label}`);
  }
  return result.data;
}

export function useGameResults() {
  return useQuery({
    queryKey: [api.gameResults.list.path],
    queryFn: async () => {
      const res = await fetch(api.gameResults.list.path, { credentials: "include" });
      if (!res.ok) throw new Error("Failed to fetch game results");
      const data = await res.json();
      return parseResponse<GameResult[]>(api.gameResults.list.responses[200], data, "gameResults.list");
    },
  });
}

export function useSubmitGameResult() {
  const queryClient = useQueryClient();
  
  return useMutation({
    mutationFn: async (data: InsertGameResult) => {
      // Coerce numeric fields to ensure they match schema requirements when coming from forms
      const coercedData = {
        ...data,
        tierIdx: Number(data.tierIdx),
        padIdx: Number(data.padIdx),
        betFrac: Number(data.betFrac),
        wealth: Number(data.wealth),
        fuelUsed: Number(data.fuelUsed),
        score: Number(data.score),
      };

      const validated = api.gameResults.create.input.parse(coercedData);
      
      const res = await fetch(api.gameResults.create.path, {
        method: api.gameResults.create.method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(validated),
        credentials: "include",
      });
      
      if (!res.ok) {
        if (res.status === 400) {
          const errorData = await res.json();
          throw new Error(errorData.message || "Validation failed");
        }
        throw new Error("Failed to submit game result");
      }
      
      const responseData = await res.json();
      return parseResponse<GameResult>(api.gameResults.create.responses[201], responseData, "gameResults.create");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [api.gameResults.list.path] });
    },
  });
}
