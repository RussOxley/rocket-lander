import { useCallback } from "react";
import { useSubmitGameResult } from "@/hooks/use-game-results";
import { useToast } from "@/hooks/use-toast";
// @ts-ignore - JSX game component
import RocketLander from "./RocketLander";

export function GameWrapper() {
  const { mutate: submitResult } = useSubmitGameResult();
  const { toast } = useToast();

  const handleRoundComplete = useCallback((gameData: any) => {
    submitResult(gameData, {
      onSuccess: () => {
        toast({
          title: "Telemetry Logged",
          description: `Round saved. Wealth: $${gameData.wealth.toLocaleString()}`,
          className: "bg-emerald-950 border-emerald-800 text-emerald-100",
        });
      },
      onError: (error: Error) => {
        toast({
          title: "Telemetry Sync Failed",
          description: error.message,
          variant: "destructive",
        });
      }
    });
  }, [submitResult, toast]);

  return (
    <div className="w-full h-full" data-testid="game-container">
      <RocketLander onRoundComplete={handleRoundComplete} />
    </div>
  );
}
