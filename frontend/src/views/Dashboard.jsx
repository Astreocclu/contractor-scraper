import { Users, UserCheck, TrendingUp, AlertTriangle, RefreshCw } from "lucide-react"
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts"
import { useStats, useContractors } from "@/hooks/useContractors"
import { MetricCard } from "@/components/MetricCard"
import { CommandPanel } from "@/components/CommandPanel"
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Skeleton } from "@/components/ui/skeleton"

export function Dashboard() {
  const { data: stats, isLoading: statsLoading, error: statsError } = useStats()
  const { data: contractors, isLoading: contractorsLoading } = useContractors({ all: true })

  // Extract results array from paginated response
  const contractorList = contractors?.results || []

  // Use score distribution from stats API (accurate) instead of calculating from paginated results
  // Exclude unranked to keep the scale reasonable for qualified leads
  const tierData = stats?.score_distribution ? [
    { name: 'Gold (80+)', count: stats.score_distribution.gold, color: '#eab308' },
    { name: 'Silver (65-79)', count: stats.score_distribution.silver, color: '#94a3b8' },
    { name: 'Bronze (50-64)', count: stats.score_distribution.bronze, color: '#a16207' },
  ] : []

  // Calculate total qualified (non-unranked)
  const qualifiedCount = stats?.score_distribution
    ? stats.score_distribution.gold + stats.score_distribution.silver + stats.score_distribution.bronze
    : 0

  // Calculate red flags count from loaded contractors
  const redFlagsCount = contractorList.reduce((acc, c) => {
    const flags = c.ai_red_flags || []
    return acc + (Array.isArray(flags) ? flags.length : 0)
  }, 0)

  if (statsError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 text-center">
        <AlertTriangle className="h-12 w-12 text-yellow-500 mb-4" />
        <h3 className="text-lg font-semibold">System Offline</h3>
        <p className="text-muted-foreground mt-2">
          Unable to connect to the backend. Please ensure the Django server is running on port 8002.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => window.location.reload()}>
          <RefreshCw className="h-4 w-4 mr-2" />
          Retry Connection
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Command Center</h1>
          <p className="text-muted-foreground">
            Monitor contractor trust scores and manage sales leads
          </p>
        </div>
      </div>

      {/* Metrics Row */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <MetricCard
          title="Total Leads"
          value={stats?.total ?? 0}
          subtitle="Contractors in database"
          icon={Users}
          loading={statsLoading}
        />
        <MetricCard
          title="Qualified Leads"
          value={stats?.passing ?? 0}
          subtitle={`Passing threshold (${stats?.pass_threshold ?? 50}+)`}
          icon={UserCheck}
          loading={statsLoading}
          valueClassName="text-green-500"
        />
        <MetricCard
          title="Average Score"
          value={stats?.avg_score?.toFixed(1) ?? "0"}
          subtitle="Trust score average"
          icon={TrendingUp}
          loading={statsLoading}
        />
        <MetricCard
          title="Red Flags"
          value={redFlagsCount}
          subtitle="Issues in loaded data"
          icon={AlertTriangle}
          loading={contractorsLoading}
          valueClassName={redFlagsCount > 0 ? "text-red-500" : ""}
        />
      </div>

      {/* Charts and Command Panel */}
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-7">
        {/* Tier Distribution Chart */}
        <Card className="col-span-4">
          <CardHeader>
            <CardTitle>Qualified Leads by Tier</CardTitle>
            <CardDescription>
              {qualifiedCount} qualified of {stats?.total ?? 0} total ({stats?.score_distribution?.unranked ?? 0} unranked)
            </CardDescription>
          </CardHeader>
          <CardContent className="pl-2">
            {statsLoading ? (
              <Skeleton className="h-[300px] w-full" />
            ) : (
              <ResponsiveContainer width="100%" height={300}>
                <BarChart data={tierData}>
                  <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                  <XAxis
                    dataKey="name"
                    tick={{ fill: 'hsl(var(--muted-foreground))', fontSize: 12 }}
                  />
                  <YAxis tick={{ fill: 'hsl(var(--muted-foreground))' }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--popover))',
                      border: '1px solid hsl(var(--border))',
                      borderRadius: '8px',
                    }}
                    labelStyle={{ color: 'hsl(var(--foreground))' }}
                    formatter={(value) => [value, 'Contractors']}
                  />
                  <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                    {tierData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>

        {/* Command Panel */}
        <div className="col-span-3">
          <CommandPanel />
        </div>
      </div>
    </div>
  )
}
