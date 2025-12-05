import { useState, useMemo } from "react"
import {
  useReactTable,
  getCoreRowModel,
  getFilteredRowModel,
  getSortedRowModel,
  flexRender,
} from "@tanstack/react-table"
import { Search, ExternalLink, AlertTriangle, ChevronUp, ChevronDown, Filter } from "lucide-react"
import { useContractors, useVerticals } from "@/hooks/useContractors"
import { TrustScoreBadge } from "@/components/TrustScoreBadge"
import { TierIcon } from "@/components/TierIcon"
import { StatusBadge, RatingDisplay, RedFlagIndicator } from "@/components/StatusBadge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectOption } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Skeleton } from "@/components/ui/skeleton"
import { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"

export function LeadTable({ onSelectContractor }) {
  const [globalFilter, setGlobalFilter] = useState("")
  const [cityFilter, setCityFilter] = useState("")
  const [verticalFilter, setVerticalFilter] = useState("")
  const [showAll, setShowAll] = useState(false)
  const [sorting, setSorting] = useState([{ id: 'trust_score', desc: true }])

  const { data: contractors, isLoading, error } = useContractors({
    all: showAll ? true : undefined,
    search: globalFilter || undefined,
    city: cityFilter || undefined,
    vertical: verticalFilter || undefined,
  })

  const { data: verticals } = useVerticals()

  // Extract results array from paginated response
  const contractorList = contractors?.results || []

  // Get unique cities for filter
  const cities = useMemo(() => {
    if (!contractorList.length) return []
    const uniqueCities = [...new Set(contractorList.map(c => c.city).filter(Boolean))]
    return uniqueCities.sort()
  }, [contractorList])

  const columns = useMemo(
    () => [
      {
        id: "tier",
        header: "Tier",
        accessorKey: "tier",
        size: 80,
        cell: ({ row }) => <TierIcon tier={row.original.tier} showLabel={false} />,
      },
      {
        id: "trust_score",
        header: "Score",
        accessorKey: "trust_score",
        size: 100,
        cell: ({ row }) => (
          <TrustScoreBadge score={row.original.trust_score} size="sm" />
        ),
      },
      {
        id: "business_name",
        header: "Business",
        accessorKey: "business_name",
        cell: ({ row }) => (
          <div className="flex flex-col">
            <span className="font-medium">{row.original.business_name}</span>
            {row.original.website && (
              <a
                href={row.original.website}
                target="_blank"
                rel="noopener noreferrer"
                className="text-xs text-muted-foreground hover:text-primary flex items-center gap-1"
                onClick={(e) => e.stopPropagation()}
              >
                <ExternalLink className="h-3 w-3" />
                Website
              </a>
            )}
          </div>
        ),
      },
      {
        id: "city",
        header: "Location",
        accessorKey: "city",
        size: 120,
        cell: ({ row }) => (
          <Badge variant="outline" className="font-normal">
            {row.original.city}
          </Badge>
        ),
      },
      {
        id: "reputation",
        header: "Reputation",
        accessorFn: (row) => row.google_rating,
        size: 140,
        cell: ({ row }) => (
          <RatingDisplay
            rating={row.original.google_rating}
            reviewCount={row.original.google_review_count}
          />
        ),
      },
      {
        id: "status",
        header: "Status",
        accessorKey: "passes_threshold",
        size: 120,
        cell: ({ row }) => (
          <StatusBadge passes={row.original.passes_threshold} />
        ),
      },
      {
        id: "red_flags",
        header: "Flags",
        accessorFn: (row) => row.ai_red_flags?.length || 0,
        size: 80,
        cell: ({ row }) => {
          const flags = row.original.ai_red_flags || []
          if (flags.length === 0) return <span className="text-muted-foreground">-</span>

          return (
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <div className="cursor-pointer">
                    <RedFlagIndicator flags={flags} />
                  </div>
                </TooltipTrigger>
                <TooltipContent className="max-w-xs">
                  <ul className="text-xs space-y-1">
                    {flags.slice(0, 3).map((flag, i) => (
                      <li key={i} className="flex items-start gap-1">
                        <AlertTriangle className="h-3 w-3 text-red-500 mt-0.5 flex-shrink-0" />
                        <span>{typeof flag === 'string' ? flag : flag.description || 'Unknown flag'}</span>
                      </li>
                    ))}
                    {flags.length > 3 && (
                      <li className="text-muted-foreground">+{flags.length - 3} more</li>
                    )}
                  </ul>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          )
        },
      },
      {
        id: "actions",
        header: "",
        size: 100,
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="sm"
            onClick={() => onSelectContractor?.(row.original)}
          >
            View Report
          </Button>
        ),
      },
    ],
    [onSelectContractor]
  )

  const table = useReactTable({
    data: contractorList,
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
          <AlertTriangle className="h-12 w-12 text-yellow-500 mx-auto mb-4" />
          <p className="text-muted-foreground">Failed to load contractors</p>
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filters */}
      <div className="flex flex-col sm:flex-row gap-4">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Search contractors..."
            value={globalFilter}
            onChange={(e) => setGlobalFilter(e.target.value)}
            className="pl-9"
          />
        </div>
        <Select
          value={verticalFilter}
          onChange={(e) => setVerticalFilter(e.target.value)}
          className="w-full sm:w-48"
        >
          <SelectOption value="">All Verticals</SelectOption>
          {verticals?.results?.map((v) => (
            <SelectOption key={v.slug} value={v.slug}>
              {v.name}
            </SelectOption>
          ))}
        </Select>
        <Select
          value={cityFilter}
          onChange={(e) => setCityFilter(e.target.value)}
          className="w-full sm:w-48"
        >
          <SelectOption value="">All Cities</SelectOption>
          {cities.map((city) => (
            <SelectOption key={city} value={city}>
              {city}
            </SelectOption>
          ))}
        </Select>
        <Button
          variant={showAll ? "secondary" : "outline"}
          onClick={() => setShowAll(!showAll)}
          className="gap-2"
        >
          <Filter className="h-4 w-4" />
          {showAll ? "Show Passing Only" : "Show All"}
        </Button>
      </div>

      {/* Results count */}
      <div className="text-sm text-muted-foreground">
        Showing {contractorList.length} contractors
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
                // Skeleton loading rows
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
                    className={cn(
                      "table-row-hover cursor-pointer transition-colors",
                      !row.original.passes_threshold && "opacity-60"
                    )}
                    onClick={() => onSelectContractor?.(row.original)}
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
      {!isLoading && contractorList.length === 0 && (
        <div className="text-center py-12">
          <p className="text-muted-foreground">No contractors found</p>
        </div>
      )}
    </div>
  )
}
