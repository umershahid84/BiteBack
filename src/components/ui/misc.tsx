import { cn } from '@/lib/utils';

export function Kpi({ value, label, className }: { value: React.ReactNode; label: React.ReactNode; className?: string }) {
  return (
    <div className={cn('rounded-card border border-line bg-surface p-4', className)}>
      <b className="block font-heading text-2xl font-extrabold tracking-tight">{value}</b>
      <span className="text-sm text-muted">{label}</span>
    </div>
  );
}

export function EmptyState({ title, children, action }: { title: string; children?: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="rounded-card border border-dashed border-line px-6 py-14 text-center">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/assets/logo-mark.svg" alt="" className="mx-auto mb-4 size-14 opacity-80" />
      <h3 className="text-lg font-bold">{title}</h3>
      {children && <p className="mx-auto mt-1 max-w-md text-muted">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

export function Table({ className, ...props }: React.ComponentProps<'table'>) {
  return (
    <div className="overflow-x-auto">
      <table
        className={cn(
          'w-full border-collapse text-sm [&_td]:border-b [&_td]:border-line [&_td]:px-3 [&_td]:py-2.5 [&_td]:align-middle [&_th]:border-b [&_th]:border-line [&_th]:px-3 [&_th]:py-2 [&_th]:text-left [&_th]:text-xs [&_th]:font-bold [&_th]:tracking-wider [&_th]:text-muted [&_th]:uppercase [&_tbody_tr:hover]:bg-surface-2/40',
          className,
        )}
        {...props}
      />
    </div>
  );
}

export function SectionLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('mt-6 mb-2 text-xs font-bold tracking-widest text-muted uppercase', className)} {...props} />;
}

export function Spinner({ className }: { className?: string }) {
  return <span className={cn('inline-block size-5 animate-spin rounded-full border-2 border-line border-t-primary', className)} aria-label="Loading" />;
}
