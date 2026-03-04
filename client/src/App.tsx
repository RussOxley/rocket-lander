import { Switch, Route, Redirect } from "wouter";
import { queryClient } from "./lib/queryClient";
import { QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";

// Layout & Components
import { Sidebar } from "@/components/Sidebar";

// Pages
import Play from "@/pages/Play";
import Dashboard from "@/pages/Dashboard";
import History from "@/pages/History";
import NotFound from "@/pages/not-found";

function Router() {
  return (
    <div className="flex h-screen w-full overflow-hidden bg-background">
      <Sidebar />
      <main className="flex-1 overflow-y-auto relative">
        <Switch>
          <Route path="/">
            <Redirect to="/play" />
          </Route>
          <Route path="/play" component={Play} />
          <Route path="/dashboard" component={Dashboard} />
          <Route path="/history" component={History} />
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
