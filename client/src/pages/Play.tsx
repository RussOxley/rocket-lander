import { motion } from "framer-motion";
import { GameWrapper } from "@/components/GameWrapper";

export default function Play() {
  return (
    <div className="p-8 max-w-[1600px] mx-auto w-full h-full flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="flex items-end justify-between mb-6 shrink-0"
      >
        <div>
          <h1 className="text-4xl font-display font-bold text-white mb-2">Mission Control</h1>
          <p className="text-muted-foreground">Execute landings, manage fuel, and maximize returns.</p>
        </div>
        
        <div className="flex items-center gap-4 text-sm font-mono text-muted-foreground bg-white/5 px-4 py-2 rounded-lg border border-white/5">
          <div className="flex items-center gap-2">
            <span className="w-2 h-2 rounded-full bg-emerald-500 block"></span>
            Telemetry Linked
          </div>
        </div>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, scale: 0.98 }}
        animate={{ opacity: 1, scale: 1 }}
        transition={{ delay: 0.2, duration: 0.5 }}
        className="flex-1 min-h-[500px]"
      >
        <GameWrapper />
      </motion.div>
    </div>
  );
}
