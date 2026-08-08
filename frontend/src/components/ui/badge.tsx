import { forwardRef, type HTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2 whitespace-nowrap',
  {
    variants: {
      variant: {
        default:
          'border-transparent bg-primary text-primary-foreground shadow',
        secondary: 'border-transparent bg-secondary text-secondary-foreground',
        destructive:
          'border-transparent bg-destructive text-destructive-foreground shadow',
        outline: 'text-foreground',
        success:
          'border-transparent bg-success/15 text-success dark:bg-success/20',
        warning:
          'border-transparent bg-warning/15 text-warning dark:bg-warning/20',
        info: 'border-transparent bg-info/15 text-info dark:bg-info/20',
        muted: 'border-border bg-muted text-muted-foreground',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

/** Forwards its ref so a badge can be a Radix `asChild` trigger. Without this a
 *  `<TooltipTrigger asChild><Badge/></TooltipTrigger>` silently never opens: the
 *  Slot's props land (Badge spreads them) but the anchor ref is dropped, so the
 *  tooltip has nothing to position against. Both cycle chips — `SprintChip` and
 *  `CarryOverBadge` — are exactly that shape. */
const Badge = forwardRef<HTMLSpanElement, BadgeProps>(({ className, variant, ...props }, ref) => (
  <span ref={ref} className={cn(badgeVariants({ variant }), className)} {...props} />
));
Badge.displayName = 'Badge';

export { Badge, badgeVariants };
