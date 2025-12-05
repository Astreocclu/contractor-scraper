import * as React from "react"
import { cva } from "class-variance-authority"
import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-primary-foreground hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-secondary-foreground hover:bg-secondary/80",
        destructive:
          "border-transparent bg-destructive text-destructive-foreground hover:bg-destructive/80",
        outline: "text-foreground",
        success:
          "border-transparent bg-green-500/10 text-green-500 border-green-500/20",
        warning:
          "border-transparent bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
        danger:
          "border-transparent bg-red-500/10 text-red-500 border-red-500/20",
        gold:
          "border-transparent bg-yellow-500/20 text-yellow-500 border-yellow-500/30",
        silver:
          "border-transparent bg-slate-400/20 text-slate-400 border-slate-400/30",
        bronze:
          "border-transparent bg-amber-700/20 text-amber-600 border-amber-700/30",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({ className, variant, ...props }) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
