import { Award, Medal, Trophy, Circle } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { cn } from "@/lib/utils"

/**
 * Tier badge/icon component
 */
export function TierIcon({ tier, showLabel = true, size = "default" }) {
  const config = {
    gold: {
      icon: Trophy,
      label: "Gold",
      variant: "gold",
      className: "text-yellow-500",
    },
    silver: {
      icon: Medal,
      label: "Silver",
      variant: "silver",
      className: "text-slate-400",
    },
    bronze: {
      icon: Award,
      label: "Bronze",
      variant: "bronze",
      className: "text-amber-600",
    },
    default: {
      icon: Circle,
      label: "Unranked",
      variant: "outline",
      className: "text-muted-foreground",
    },
  }

  const tierKey = tier?.toLowerCase() || "default"
  const { icon: Icon, label, variant, className } = config[tierKey] || config.default

  const iconSizes = {
    sm: "h-3 w-3",
    default: "h-4 w-4",
    lg: "h-5 w-5",
  }

  if (!showLabel) {
    return <Icon className={cn(iconSizes[size], className)} />
  }

  return (
    <Badge variant={variant} className="gap-1">
      <Icon className={cn(iconSizes[size], className)} />
      <span>{label}</span>
    </Badge>
  )
}

/**
 * Simple tier indicator dot
 */
export function TierDot({ tier }) {
  const colors = {
    gold: "bg-yellow-500",
    silver: "bg-slate-400",
    bronze: "bg-amber-600",
  }

  return (
    <div
      className={cn(
        "w-2 h-2 rounded-full",
        colors[tier?.toLowerCase()] || "bg-muted"
      )}
    />
  )
}
