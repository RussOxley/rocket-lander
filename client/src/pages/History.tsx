import { motion } from "framer-motion";
import { format } from "date-fns";
import { CheckCircle2, XCircle, Clock, Zap, Target, DollarSign } from "lucide-react";
import { useGameResults } from "@/hooks/use-game-results";
import { clsx } from "clsx";

export default function History() {
  const { data: results, isLoading } = useGameResults();

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const safeResults = results || [];
  const sortedResults = [...safeResults].sort((a, b) => 
    new Date(b.createdAt!).getTime() - new Date(a.createdAt!).getTime()
  );

  return (
    <div className="p-8 max-w-7xl mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-display font-bold text-white mb-2">Flight Logs</h1>
        <p className="text-muted-foreground">Detailed historical records of all landing attempts.</p>
      </motion.div>

      <motion.div 
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ delay: 0.2 }}
        className="glass-panel rounded-2xl overflow-hidden border border-white/10"
      >
        <div className="overflow-x-auto">
          <table className="w-full text-sm text-left">
            <thead className="text-xs text-muted-foreground uppercase bg-white/5 border-b border-white/10">
              <tr>
                <th className="px-6 py-4 font-semibold">Status</th>
                <th className="px-6 py-4 font-semibold">Date & Time</th>
                <th className="px-6 py-4 font-semibold">Score</th>
                <th className="px-6 py-4 font-semibold">Wealth Impact</th>
                <th className="px-6 py-4 font-semibold">Fuel Used</th>
                <th className="px-6 py-4 font-semibold">Tier / Pad</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {sortedResults.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">
                    No flight records found.
                  </td>
                </tr>
              )}
              {sortedResults.map((result, idx) => (
                <motion.tr 
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: idx * 0.05 + 0.3 }}
                  key={result.id} 
                  className="hover:bg-white/[0.02] transition-colors group"
                >
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className={clsx(
                      "flex items-center gap-2 px-3 py-1 rounded-full w-max",
                      result.success ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"
                    )}>
                      {result.success ? <CheckCircle2 className="w-4 h-4" /> : <XCircle className="w-4 h-4" />}
                      <span className="font-medium">{result.success ? "Success" : "Crash"}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap text-white/80">
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-muted-foreground" />
                      {format(new Date(result.createdAt!), "MMM d, yyyy HH:mm")}
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2 font-display font-bold text-lg">
                      <Target className="w-4 h-4 text-primary" />
                      <span className="text-white">{result.score.toLocaleString()}</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-1">
                      <DollarSign className="w-4 h-4 text-secondary" />
                      <span className="font-mono text-white/90">${result.wealth.toLocaleString()}</span>
                      <span className="text-xs text-muted-foreground ml-2">(Bet: {(result.betFrac * 100).toFixed(0)}%)</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-amber-500" />
                      <span className="text-white/80">{result.fuelUsed.toFixed(1)} units</span>
                    </div>
                  </td>
                  <td className="px-6 py-4 whitespace-nowrap">
                    <div className="text-xs text-muted-foreground font-mono bg-black/30 px-2 py-1 rounded">
                      T{result.tierIdx} / P{result.padIdx}
                    </div>
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </div>
  );
}
