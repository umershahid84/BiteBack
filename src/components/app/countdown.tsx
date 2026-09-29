'use client';

import { useEffect, useRef } from 'react';
import { useNow } from '@/hooks/use-now';
import { timeLeft } from '@/lib/format';
import { cn } from '@/lib/utils';

// Live discard-timer countdown. Amber in the last 15 minutes; calls onExpire once when it runs out.
export function Countdown({ until, prefix = '⏳', suffix = ' left', className, onExpire }: {
  until: string;
  prefix?: string;
  suffix?: string;
  className?: string;
  onExpire?: () => void;
}) {
  const now = useNow();
  const ms = Date.parse(until) - now;
  const expired = now > 0 && ms <= 0;
  const fired = useRef(false);
  useEffect(() => {
    if (expired && !fired.current) {
      fired.current = true;
      onExpire?.();
    }
  }, [expired, onExpire]);
  if (!now) return <span className={className}>&nbsp;</span>;
  return (
    <span className={cn('font-semibold tabular-nums', !expired && ms < 15 * 60000 && 'text-accent-ink', expired && 'text-danger', className)}>
      {expired ? '⌛ Expired' : `${prefix} ${timeLeft(until, now)}${suffix}`}
    </span>
  );
}
