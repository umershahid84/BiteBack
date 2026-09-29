'use client';

import { Dialog as D } from 'radix-ui';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';

export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({ title, description, className, children, hideTitle, ...props }: React.ComponentProps<typeof D.Content> & {
  title: React.ReactNode;
  description?: React.ReactNode;
  hideTitle?: boolean;
}) {
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-[1000] bg-black/70 backdrop-blur-sm data-[state=open]:animate-in" />
      <D.Content
        className={cn(
          'fixed top-1/2 left-1/2 z-[1001] max-h-[92vh] w-[min(560px,calc(100%-24px))] -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-card border border-line bg-surface p-6 shadow-pop outline-none',
          className,
        )}
        {...props}
      >
        <div className={cn('mb-4 flex items-start gap-3', hideTitle && 'sr-only')}>
          <D.Title className="m-0 flex-1 text-xl font-extrabold">{title}</D.Title>
        </div>
        {description ? <D.Description className="-mt-2 mb-4 text-sm text-muted">{description}</D.Description> : <D.Description className="sr-only">{String(title)}</D.Description>}
        {children}
        <D.Close className="absolute top-4 right-4 rounded-full p-1.5 text-muted hover:bg-surface-2 hover:text-ink" aria-label="Close">
          <X className="size-5" />
        </D.Close>
      </D.Content>
    </D.Portal>
  );
}
