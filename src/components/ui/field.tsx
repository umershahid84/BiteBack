import { cn } from '@/lib/utils';

const control =
  'w-full rounded-field border border-line bg-bg-2 px-3.5 py-2.5 text-ink placeholder:text-muted/70 outline-none transition focus:border-primary focus:ring-3 focus:ring-primary/20 disabled:opacity-60';

export function Input({ className, ...props }: React.ComponentProps<'input'>) {
  return <input className={cn(control, 'h-11', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.ComponentProps<'textarea'>) {
  return <textarea className={cn(control, 'min-h-24 resize-y', className)} {...props} />;
}

export function Select({ className, ...props }: React.ComponentProps<'select'>) {
  return <select className={cn(control, 'h-11 pr-8', className)} {...props} />;
}

export function Label({ className, ...props }: React.ComponentProps<'label'>) {
  return <label className={cn('mb-1.5 block text-sm font-semibold text-ink-2', className)} {...props} />;
}

// Label + control + optional hint.
export function Field({ label, htmlFor, hint, className, children }: {
  label: React.ReactNode;
  htmlFor?: string;
  hint?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div className={cn('mb-4', className)}>
      <Label htmlFor={htmlFor}>{label}</Label>
      {children}
      {hint && <div className="mt-1.5 text-xs text-muted">{hint}</div>}
    </div>
  );
}

export function Checkbox({ className, label, ...props }: React.ComponentProps<'input'> & { label: React.ReactNode }) {
  return (
    <label className={cn('flex cursor-pointer items-start gap-2.5 text-sm text-ink-2', className)}>
      <input type="checkbox" className="mt-0.5 size-4 accent-[var(--color-primary)]" {...props} />
      <span>{label}</span>
    </label>
  );
}
