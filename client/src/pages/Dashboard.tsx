import { motion } from "framer-motion";
import { Target, Trophy, TrendingUp, AlertTriangle, Activity } from "lucide-react";
import { useGameResults } from "@/hooks/use-game-results";
import { StatsCard } from "@/components/StatsCard";
import { 
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  BarChart, Bar
} from "recharts";
import { format } from "date-fns";

export default function Dashboard() {
  const { data: results, isLoading } = useGameResults();

  if (isLoading) {
    return (
      <div className="p-8 flex items-center justify-center h-full">
        <div className="w-10 h-10 border-4 border-primary/30 border-t-primary rounded-full animate-spin" />
      </div>
    );
  }

  const safeResults = results || [];
  
  // Calculations for stats
  const totalGames = safeResults.length;
  const successes = safeResults.filter(r => r.success).length;
  const winRate = totalGames > 0 ? Math.round((successes / totalGames) * 100) : 0;
  const avgScore = totalGames > 0 ? Math.round(safeResults.reduce((acc, r) => acc + r.score, 0) / totalGames) : 0;
  
  const sortedByDate = [...safeResults].sort((a, b) => 
    new Date(a.createdAt!).getTime() - new Date(b.createdAt!).getTime()
  );

  const currentWealth = sortedByDate.length > 0 ? sortedByDate[sortedByDate.length - 1].wealth : 0;
  const initialWealth = sortedByDate.length > 0 ? sortedByDate[0].wealth : 0;
  const wealthTrend = initialWealth > 0 ? Math.round(((currentWealth - initialWealth) / initialWealth) * 100) : 0;

  // Chart Data Prep
  const chartData = sortedByDate.slice(-20).map((r, i) => ({
    name: `Mission ${totalGames - Math.min(20, totalGames) + i + 1}`,
    score: r.score,
    wealth: r.wealth,
    fuel: r.fuelUsed,
    date: format(new Date(r.createdAt!), "MMM d, HH:mm"),
    success: r.success
  }));

  return (
    <div className="p-8 max-w-7xl mx-auto w-full">
      <motion.div
        initial={{ opacity: 0, y: -20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-8"
      >
        <h1 className="text-4xl font-display font-bold text-white mb-2">Command Analytics</h1>
        <p className="text-muted-foreground">Monitor pilot performance and resource utilization.</p>
      </motion.div>

      {totalGames === 0 ? (
        <div className="glass-panel rounded-2xl p-12 text-center border border-dashed border-white/20">
          <Activity className="w-16 h-16 text-muted-foreground/30 mx-auto mb-4" />
          <h3 className="text-xl font-display text-white mb-2">Awaiting Telemetry</h3>
          <p className="text-muted-foreground">Head to Mission Control to log your first flight.</p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mb-8">
            <StatsCard
              title="Total Missions"
              value={totalGames}
              icon={<Target />}
              delay={0.1}
            />
            <StatsCard
              title="Mission Success Rate"
              value={`${winRate}%`}
              icon={winRate > 50 ? <Trophy /> : <AlertTriangle />}
              trend={{ value: winRate, isPositive: winRate > 50 }}
              delay={0.2}
            />
            <StatsCard
              title="Average Score"
              value={avgScore}
              icon={<Activity />}
              delay={0.3}
            />
            <StatsCard
              title="Current Wealth"
              value={`$${currentWealth.toLocaleString()}`}
              icon={<TrendingUp />}
              trend={{ value: Math.abs(wealthTrend), isPositive: wealthTrend >= 0 }}
              delay={0.4}
            />
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Wealth Over Time Chart */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.5 }}
              className="lg:col-span-2 glass-panel rounded-2xl p-6 border border-white/10"
            >
              <div className="mb-6">
                <h3 className="text-lg font-display font-bold text-white">Wealth Progression</h3>
                <p className="text-sm text-muted-foreground">Financial status over last 20 missions</p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorWealth" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="hsl(var(--primary))" stopOpacity={0.3}/>
                        <stop offset="95%" stopColor="hsl(var(--primary))" stopOpacity={0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} tickFormatter={(val) => `$${val}`} />
                    <Tooltip 
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px', color: '#fff' }}
                      itemStyle={{ color: 'hsl(var(--primary))' }}
                    />
                    <Area type="monotone" dataKey="wealth" stroke="hsl(var(--primary))" strokeWidth={3} fillOpacity={1} fill="url(#colorWealth)" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </motion.div>

            {/* Score History Bar Chart */}
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ duration: 0.5, delay: 0.6 }}
              className="glass-panel rounded-2xl p-6 border border-white/10"
            >
              <div className="mb-6">
                <h3 className="text-lg font-display font-bold text-white">Recent Scores</h3>
                <p className="text-sm text-muted-foreground">Performance metrics</p>
              </div>
              <div className="h-72 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={chartData} margin={{ top: 10, right: 0, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.05)" vertical={false} />
                    <XAxis dataKey="name" hide />
                    <YAxis stroke="rgba(255,255,255,0.3)" fontSize={12} />
                    <Tooltip
                      cursor={{fill: 'rgba(255,255,255,0.05)'}}
                      contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'rgba(255,255,255,0.1)', borderRadius: '12px' }}
                    />
                    <Bar 
                      dataKey="score" 
                      radius={[4, 4, 0, 0]} 
                      fill="hsl(var(--secondary))"
                      // Hack to color failed missions differently in Recharts Bar without custom shape component
                      fillOpacity={0.8}
                    />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </div>
  );
}
