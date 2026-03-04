import { Link, useLocation } from "wouter";
import { Rocket, BarChart2, History, Settings, ExternalLink } from "lucide-react";
import { clsx } from "clsx";
import { motion } from "framer-motion";

const navItems = [
  { path: "/play", icon: Rocket, label: "Mission Control" },
  { path: "/dashboard", icon: BarChart2, label: "Analytics" },
  { path: "/history", icon: History, label: "Flight Logs" },
];

export function Sidebar() {
  const [location] = useLocation();

  return (
    <div className="w-64 h-screen flex-shrink-0 glass-panel border-y-0 border-l-0 border-r flex flex-col z-10 relative">
      <div className="p-8 flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-primary to-secondary flex items-center justify-center shadow-lg shadow-primary/20">
          <Rocket className="text-white w-6 h-6" strokeWidth={1.5} />
        </div>
        <div>
          <h1 className="font-display font-bold text-xl leading-none text-white tracking-wide">
            Rocket<span className="text-primary">Lander</span>
          </h1>
          <p className="text-[10px] text-muted-foreground uppercase tracking-widest mt-1">Telemetry System</p>
        </div>
      </div>

      <div className="px-4 py-6 flex-1 flex flex-col gap-2">
        <div className="text-xs font-semibold text-muted-foreground/50 uppercase tracking-wider mb-2 px-4">
          Navigation
        </div>
        
        {navItems.map((item) => {
          const isActive = location === item.path || (location === "/" && item.path === "/play");
          return (
            <Link key={item.path} href={item.path} className="relative group block">
              {isActive && (
                <motion.div
                  layoutId="sidebar-active"
                  className="absolute inset-0 bg-primary/10 rounded-xl border border-primary/20"
                  initial={false}
                  transition={{ type: "spring", stiffness: 400, damping: 30 }}
                />
              )}
              <div className={clsx(
                "relative flex items-center gap-3 px-4 py-3 rounded-xl transition-colors duration-200",
                isActive ? "text-primary font-medium" : "text-muted-foreground hover:text-white hover:bg-white/5"
              )}>
                <item.icon className={clsx("w-5 h-5", isActive ? "text-primary" : "text-muted-foreground group-hover:text-white")} />
                {item.label}
              </div>
            </Link>
          );
        })}
      </div>

      <div className="p-6 border-t border-white/5">
        <div className="flex items-center gap-3 px-4 py-3 rounded-xl text-muted-foreground hover:text-white hover:bg-white/5 cursor-pointer transition-colors duration-200">
          <Settings className="w-5 h-5" />
          <span>Settings</span>
        </div>
      </div>
    </div>
  );
}
