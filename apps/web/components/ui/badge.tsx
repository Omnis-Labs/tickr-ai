import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-label-sm transition-colors focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-surface focus:ring-offset-2",
  {
    variants: {
      variant: {
        default:
          "border-transparent bg-primary text-on-primary shadow-sm hover:bg-primary/80",
        secondary:
          "border-transparent bg-secondary text-on-secondary hover:bg-secondary/80",
        destructive:
          "border-transparent bg-negative text-on-negative shadow-sm hover:bg-negative/80",
        negative:
          "border-transparent bg-negative text-on-negative shadow-sm hover:bg-negative/80",
        outline: "text-on-surface border-outline-variant",
        positive: "border-transparent bg-positive text-on-positive hover:bg-positive/80",
        accent: "border-transparent bg-accent text-on-accent hover:bg-accent/80",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return (
    <div className={cn(badgeVariants({ variant }), className)} {...props} />
  )
}

export { Badge, badgeVariants }
