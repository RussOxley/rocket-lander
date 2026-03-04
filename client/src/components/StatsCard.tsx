import { motion } from "framer-motion";
import { ReactNode } from "react";
import { clsx } from "clsx";

interface StatsCardProps {
  title: string;
  value: string | number;
  subtitle?: string;
  icon: ReactNode;
  trend?: {
    value: number;
    isPositive: boolean;
  };
  delay?: number;
  className?: string;
}

export function StatsCard({ title, value, subtitle, icon, trend, delay = 0, className }: StatsCardProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay, ease: "easeOut" }}
      className={clsx(
        "glass-panel rounded-2xl p-6 relative overflow-hidden group hover-glow",
        className
      )}
    >
      {/* Decorative gradient orb */}
      <div className="absolute -top-12 -right-12 w-32 h-32 bg-primary/10 rounded-full blur-3xl group-hover:bg-primary/20 transition-colors duration-500" />
      
      <div className="flex justify-between items-start relative z-10">
        <div>
          <p className="text-sm font-medium text-muted-foreground mb-1">{title}</p>
          <h3 className="text-3xl font-display font-bold text-white tracking-tight">{value}</h3>
          
          {(subtitle || trend) && (
            <div className="flex items-center gap-2 mt-2">
              {trend && (
                <span className={clsx(
                  "text-xs font-semibold px-2 py-1 rounded-md",
                  trend.isPositive ? "bg-emerald-500/10 text-emerald-400" : "bg-destructive/10 text-destructive"
                )}>
                  {trend.isPositive ? "+" : ""}{trend.value}%
                </span>
              )}
              {subtitle && <span className="text-xs text-muted-foreground">{subtitle}</span>}
            </div>
          )}
        </div>
        
        <div className="w-12 h-12 rounded-xl bg-white/5 border border-white/10 flex items-center justify-center text-primary shadow-inner">
          {icon}
        </div>
      </div>
    </motion.div>
  );
}
