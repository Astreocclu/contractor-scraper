import { useState, useMemo } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table"
import {
  Search, MapPin, Home, DollarSign, Flame,
  ChevronUp, ChevronDown, Filter, Download, Phone
} from "lucide-react"
import { useLeads, useLeadStats, useMarkExported, useMarkContacted } from "@/hooks/useLeads"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectOption } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { cn } from "@/lib/utils"

// Tier badge component
function TierBadge({ tier }) {
  const colors = {
    A: "bg-yellow-500/20 text-yellow-500 border-yellow-500/50",
    B: "bg-slate-400/20 text-slate-300 border-slate-400/50",
    C: "bg-amber-700/20 text-amber-500 border-amber-700/50",
    D: "bg-zinc-600/20 text-zinc-400 border-zinc-600/50",
  }

  return (
    <Badge variant="outline" className={cn("font-bold", colors[tier] || colors.D)}>
      {tier}
    </Badge>
  )
}

// Freshness badge component
function FreshnessBadge({ tier, days }) {
  const colors = {
    hot: "bg-red-500/20 text-red-400",
    warm: "bg-orange-500/20 text-orange-400",
    moderate: "bg-yellow-500/20 text-yellow-400",
    cool: "bg-blue-500/20 text-blue-400",
    cold: "bg-slate-500/20 text-slate-400",
    stale: "bg-zinc-600/20 text-zinc-500",
  }

  return (
    <div className="flex items-center gap-1">
      {tier === 'hot' && <Flame className="h-3 w-3 text-red-400" />}
      <Badge variant="outline" className={cn("text-xs", colors[tier] || colors.stale)}>
        {days}d
      </Badge>
    </div>
  )
}

// Score display
function ScoreDisplay({ score }) {
  const color = score >= 80 ? "text-yellow-500" :
                score >= 60 ? "text-slate-300" :
                score >= 40 ? "text-amber-500" : "text-zinc-400"

  return (
    <span className={cn("font-mono font-bold", color)}>
      {score?.toFixed(0) || "-"}
    </span>
  )
}

export function PropertyLeads({ onSelectLead }) {
  const [globalFilter, setGlobalFilter] = useState("")
  const [tierFilter, setTierFilter] = useState("")
  const [typeFilter, setTypeFilter] = useState("")
  const [freshnessFilter, setFreshnessFilter] = useState("")
  const [sorting, setSorting] = useState([{ id: 'score', desc: true }])

  const { data: leadsData, isLoading, error } = useLeads({
    search: globalFilter || undefined,
    tier: tierFilter || undefined,
    lead_type: typeFilter || undefined,
    freshness_tier: freshnessFilter || undefined,
  })

  const { data: stats } = useLeadStats()
  const markExported = useMarkExported()
  const markContacted = useMarkContacted()

  // Extract results array from paginated response
  const leadsList = leadsData?.results || []

  // Get unique lead types for filter
  const leadTypes = useMemo(() => {
    if (!leadsList.length) return []
    const uniqueTypes = [...new Set(leadsList.map(l => l.lead_type).filter(Boolean))]
    return uniqueTypes.sort()
  }, [leadsList])

  const columns = useMemo(
    () => [
      {
        id: "tier",
        header: "Tier",
        accessorKey: "tier",
        size: 70,
        cell: ({ row }) => <TierBadge tier={row.original.tier} />,
      },
      {
        id: "score",
        header: "Score",
        accessorKey: "score",
        size: 80,
        cell: ({ row }) => <ScoreDisplay score={row.original.score} />,
      },
      {
        id: "property_address",
        header: "Property",
        accessorKey: "property_address",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <div className="flex items-center gap-1">
              <Home className="h-3 w-3 text-muted-foreground" />
              <span className="font-medium text-sm">{row.original.property_address}</span>
            </div>
            {row.original.owner_name && (
              <span className="text-xs text-muted-foreground">{row.original.owner_name}</span>
            )}
          </div>
        ),
      },
      {
        id: "lead_type",
        header: "Type",
        accessorKey: "lead_type",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline" className="text-xs capitalize">
            {row.original.lead_type?.replace(/_/g, ' ') || 'unknown'}
          </Badge>
        ),
      },
      {
        id: "freshness",
        header: "Fresh",
        accessorFn: (row) => row.days_since_permit,
        size: 80,
        cell: ({ row }) => (
          <FreshnessBadge
            tier={row.original.freshness_tier}
            days={row.original.days_since_permit}
          />
        ),
      },
      {
        id: "signals",
        header: "Signals",
        size: 100,
        cell: ({ row }) => (
          <div className="flex gap-1">
            {row.original.is_high_contrast && (
              <Badge variant="outline" className="text-xs bg-green-500/20 text-green-400">
                <DollarSign className="h-3 w-3 mr-1" />HC
              </Badge>
            )}
            {row.original.is_absentee && (
              <Badge variant="outline" className="text-xs bg-purple-500/20 text-purple-400">
                <MapPin className="h-3 w-3 mr-1" />AB
              </Badge>
            )}
          </div>
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "status",
        size: 100,
        cell: ({ row }) => {
          const status = row.original.status
          const colors = {
            new: "bg-blue-500/20 text-blue-400",
            exported: "bg-yellow-500/20 text-yellow-400",
            contacted: "bg-green-500/20 text-green-400",
            converted: "bg-purple-500/20 text-purple-400",
          }
          return (
            <Badge variant="outline" className={cn("text-xs capitalize", colors[status])}>
              {status}
            </Badge>
          )
        },
      },
      {
        id: "actions",
        header: "",
        size: 150,
        cell: ({ row }) => (
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                markExported.mutate(row.original.lead_id)
              }}
              disabled={row.original.status !== 'new'}
              title="Mark as exported"
            >
              <Download className="h-3 w-3" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={(e) => {
                e.stopPropagation()
                markContacted.mutate(row.original.lead_id)
              }}
              disabled={row.original.status === 'contacted' || row.original.status === 'converted'}
              title="Mark as contacted"
            >
              <Phone className="h-3 w-3" />
            </Button>
          </div>
        ),
      },
    ],
    [markExported, markContacted]
  )

  const table = useReactTable({
    data: leadsList,
    columns,
    state: {
      globalFilter,
      sorting,
    },
    onSortingChange: setSorting,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
  })

  if (error) {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center">
          <p className="text-muted-foreground">Failed to load property leads</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Stats Cards */}
      <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-7 gap-4">
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats?.total_leads || 0}</div>
            <p className="text-xs text-muted-foreground">Total Leads</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-yellow-500">{stats?.tier_a || 0}</div>
            <p className="text-xs text-muted-foreground">Tier A</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-slate-300">{stats?.tier_b || 0}</div>
            <p className="text-xs text-muted-foreground">Tier B</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-red-400">{stats?.hot_leads || 0}</div>
            <p className="text-xs text-muted-foreground">Hot Leads</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-green-400">{stats?.high_contrast || 0}</div>
            <p className="text-xs text-muted-foreground">High Contrast</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold text-purple-400">{stats?.absentee || 0}</div>
            <p className="text-xs text-muted-foreground">Absentee</p>
          </CardContent>
        </Card>
        <Card className="col-span-1">
          <CardContent className="pt-4">
            <div className="text-2xl font-bold">{stats?.avg_score?.toFixed(1) || 0}</div>
            <p className="text-xs text-muted-foreground">Avg Score</p>
          </CardContent>
        </Card>
      </div>

      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search addresses..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={tierFilter}
          onChange={(e) => setTierFilter(e.target.value)}
          className="w-full sm:w-32"
        >
          <SelectOption value="">All Tiers</SelectOption>
          <SelectOption value="A">Tier A</SelectOption>
          <SelectOption value="B">Tier B</SelectOption>
          <SelectOption value="C">Tier C</SelectOption>
          <SelectOption value="D">Tier D</SelectOption>
        </Select>
        <Select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="w-full sm:w-40"
        >
          <SelectOption value="">All Types</SelectOption>
          {leadTypes.map((type) => (
            <SelectOption key={type} value={type}>
              {type?.replace(/_/g, ' ')}
            </SelectOption>
          ))}
        </Select>
        <Select
          value={freshnessFilter}
          onChange={(e) => setFreshnessFilter(e.target.value)}
          className="w-full sm:w-36"
        >
          <SelectOption value="">All Freshness</SelectOption>
          <SelectOption value="hot">Hot</SelectOption>
          <SelectOption value="warm">Warm</SelectOption>
          <SelectOption value="moderate">Moderate</SelectOption>
          <SelectOption value="cool">Cool</SelectOption>
          <SelectOption value="cold">Cold</SelectOption>
        </Select>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {leadsList.length} of {leadsData?.count || 0} property leads
      </div>

      {/* Table */}
      <div className="rounded-md border overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full">
            <thead className="bg-muted/50">
              {table.getHeaderGroups().map((headerGroup) => (
                <tr key={headerGroup.id}>
                  {headerGroup.headers.map((header) => (
                    <th
                      key={header.id}
                      className="px-4 py-3 text-left text-xs font-medium text-muted-foreground uppercase tracking-wider cursor-pointer hover:bg-muted/80"
                      style={{ width: header.column.columnDef.size }}
                      onClick={header.column.getToggleSortingHandler()}
                    >
                      <div className="flex items-center gap-1">
                        {flexRender(
                          header.column.columnDef.header,
                          header.getContext()
                        )}
                        {header.column.getIsSorted() === "asc" && (
                          <ChevronUp className="h-3 w-3" />
                        )}
                        {header.column.getIsSorted() === "desc" && (
                          <ChevronDown className="h-3 w-3" />
                        )}
                      </div>
                    </th>
                  ))}
                </tr>
              ))}
            </thead>
            <tbody className="divide-y divide-border">
              {isLoading ? (
                Array.from({ length: 10 }).map((_, i) => (
                  <tr key={i}>
                    {columns.map((_, j) => (
                      <td key={j} className="px-4 py-3">
                        <Skeleton className="h-6 w-full" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : (
                table.getRowModel().rows.map((row) => (
                  <tr
                    key={row.id}
                    className="table-row-hover cursor-pointer transition-colors"
                    onClick={() => onSelectLead?.(row.original)}
                  >
                    {row.getVisibleCells().map((cell) => (
                      <td key={cell.id} className="px-4 py-3">
                        {flexRender(
                          cell.column.columnDef.cell,
                          cell.getContext()
                        )}
                      </td>
                    ))}
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Empty state */}
      {!isLoading && leadsList.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No property leads found</p>
        </div>
      )}
    </div>
  )
}
