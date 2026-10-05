import { useId } from 'react';
import { cn } from '@/lib/utils';

/**
 * The product mark: a board column and a card beside it, which together draw a
 * "P". Same drawing as `public/favicon.svg` — change one, change both.
 *
 * Decorative by default (`aria-hidden`): every place it appears sits next to
 * the product's name, in text or a tooltip. Size it with `className`.
 *
 * The gradient id is per-instance: a shared id breaks the fill in any copy that
 * renders after a hidden one (e.g. the classic sidebar's `md:hidden` link).
 */
export function BrandMark({ className }: { className?: string }) {
  const gradient = useId();
  return (
    <svg viewBox="0 0 32 32" aria-hidden className={cn('size-6 shrink-0', className)}>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor="#7b65e4" />
          <stop offset="1" stopColor="#5f49cc" />
        </linearGradient>
      </defs>
      <rect width="32" height="32" rx="7.5" fill={`url(#${gradient})`} />
      <rect x="8.5" y="7" width="5.5" height="18" rx="2.5" fill="#fff" />
      <rect x="16" y="7" width="7.5" height="10.5" rx="2.5" fill="#fff" fillOpacity={0.72} />
    </svg>
  );
}
