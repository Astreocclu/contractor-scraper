import { cn } from "@/lib/utils"

/**
 * Circular trust score badge with color coding
 * Green >= 80, Yellow 50-79, Red < 50
 */
export function TrustScoreBadge({ score, size = "md", showLabel = false }) {
  const getColor = () => {
    if (score >= 80) return { stroke: "#22c55e", bg: "bg-green-500/10" }
    if (score >= 50) return { stroke: "#eab308", bg: "bg-yellow-500/10" }
    return { stroke: "#ef4444", bg: "bg-red-500/10" }
  }

  const sizes = {
    sm: { width: 40, strokeWidth: 3, fontSize: "text-xs" },
    md: { width: 56, strokeWidth: 4, fontSize: "text-sm" },
    lg: { width: 80, strokeWidth: 5, fontSize: "text-xl" },
    xl: { width: 120, strokeWidth: 6, fontSize: "text-3xl" },
  }

  const { width, strokeWidth, fontSize } = sizes[size]
  const { stroke, bg } = getColor()
  const radius = (width - strokeWidth) / 2
  const circumference = radius * 2 * Math.PI
  const offset = circumference - (score / 100) * circumference

  return (
    <div className={cn("relative inline-flex items-center justify-center", bg, "rounded-full p-1")}>
      <svg width={width} height={width} className="transform -rotate-90">
        {/* Background circle */}
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          className="text-muted/20"
        />
        {/* Progress circle */}
        <circle
          cx={width / 2}
          cy={width / 2}
          r={radius}
          fill="none"
          stroke={stroke}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          strokeLinecap="round"
          className="score-ring"
        />
      </svg>
      <div className={cn("absolute inset-0 flex items-center justify-center", fontSize, "font-bold")} style={{ color: stroke }}>
        {score}
      </div>
      {showLabel && (
        <span className="sr-only">Trust Score: {score}</span>
      )}
    </div>
  )
}

/**
 * Simple inline score with color
 */
export function TrustScoreInline({ score, className }) {
  const color = score >= 80 ? "text-green-500" : score >= 50 ? "text-yellow-500" : "text-red-500"

  return (
    <span className={cn("font-semibold", color, className)}>
      {score}
    </span>
  )
}
