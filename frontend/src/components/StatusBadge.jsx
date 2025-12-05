import { CheckCircle, XCircle, AlertTriangle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Pass/Fail status badge
 */
export function StatusBadge({ passes, className }) {
  if (passes) {
    return (
      <Badge variant="success" className={cn("gap-1", className)}>
        <CheckCircle className="h-3 w-3" />
        <span>Qualified</span>
      </Badge>
    )
  }

  return (
    <Badge variant="danger" className={cn("gap-1", className)}>
      <XCircle className="h-3 w-3" />
      <span>Unqualified</span>
    </Badge>
  )
}

/**
 * Red flag indicator
 */
export function RedFlagIndicator({ flags = [], className }) {
  if (!flags || flags.length === 0) return null

  return (
    <div className={cn("flex items-center gap-1 text-red-500", className)}>
      <AlertTriangle className="h-4 w-4" />
      <span className="text-xs font-medium">{flags.length}</span>
    </div>
  )
}

/**
 * Rating stars display
 */
export function RatingDisplay({ rating, reviewCount, className }) {
  if (!rating) return <span className="text-muted-foreground text-sm">N/A</span>

  return (
    <div className={cn("flex items-center gap-1", className)}>
      <span className="text-yellow-500">★</span>
      <span className="font-medium">{rating.toFixed(1)}</span>
      {reviewCount !== undefined && (
        <span className="text-muted-foreground text-sm">({reviewCount})</span>
      )}
    </div>
  )
}
