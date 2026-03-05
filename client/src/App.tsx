import { useState, useEffect, useRef } from "react";
import { Switch, Route, Redirect, Link, useLocation } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Menu, X, Rocket, BarChart2, History } from "lucide-react";

import Play from "@/pages/Play";
import Dashboard from "@/pages/Dashboard";
import HistoryPage from "@/pages/History";
import NotFound from "@/pages/not-found";

const navItems = [
  { path: "/play", icon: Rocket, label: "Play" },
  { path: "/dashboard", icon: BarChart2, label: "Analytics" },
  { path: "/history", icon: History, label: "Flight Logs" },
];

function NavMenu() {
  const [open, setOpen] = useState(false);
  const [location] = useLocation();
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", handleKey);
    document.addEventListener("mousedown", handleClickOutside);
    return () => {
      document.removeEventListener("keydown", handleKey);
      document.removeEventListener("mousedown", handleClickOutside);
    };
  }, [open]);

  return (
    <div ref={menuRef} className="fixed top-3 left-3 z-50" data-testid="nav-menu">
      <button
        onClick={() => setOpen(!open)}
        data-testid="nav-toggle"
        aria-label="Navigation menu"
        aria-expanded={open}
        aria-controls="nav-dropdown"
        className="w-9 h-9 rounded-lg bg-white/5 border border-white/10 backdrop-blur-sm flex items-center justify-center text-slate-400 hover:text-white hover:bg-white/10 transition-colors"
      >
        {open ? <X className="w-4 h-4" /> : <Menu className="w-4 h-4" />}
      </button>
      {open && (
        <div id="nav-dropdown" role="menu" className="absolute top-11 left-0 bg-slate-900/95 backdrop-blur-md border border-white/10 rounded-xl p-2 min-w-[160px] shadow-2xl">
          {navItems.map((item) => {
            const isActive = location === item.path || (location === "/" && item.path === "/play");
            return (
              <Link
                key={item.path}
                href={item.path}
                onClick={() => setOpen(false)}
                className={`flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm transition-colors ${
                  isActive
                    ? "text-sky-400 bg-sky-400/10 font-medium"
                    : "text-slate-400 hover:text-white hover:bg-white/5"
                }`}
              >
                <item.icon className="w-4 h-4" />
                {item.label}
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}

function Router() {
  return (
    <div className="h-screen w-full overflow-hidden bg-background">
      <NavMenu />
      <main className="w-full h-full">
        <Switch>
          <Route path="/">
            <Redirect to="/play" />
          </Route>
          <Route path="/play" component={Play} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/history" component={HistoryPage} />
          <Route component={NotFound} />
        </Switch>
      </main>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <Toaster />
        <Router />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
