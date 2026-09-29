import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('rounded-card border border-line bg-surface p-6 shadow-card', className)} {...props} />;
}

export function CardTitle({ className, ...props }: React.ComponentProps<'h3'>) {
  return <h3 className={cn('mb-3 text-lg font-bold', className)} {...props} />;
}

// White "paper" for printable documents (reports, legal text).
export function Paper({ className, ...props }: React.ComponentProps<'article'>) {
  return (
    <article
      className={cn('rounded-card bg-white p-8 text-[#0b1b14] shadow-pop print:rounded-none print:p-0 print:shadow-none [&_a]:text-[#047857]', className)}
      {...props}
    />
  );
}
