import { cn } from '@/lib/utils';

export function PinTiles({ pin, className }: { pin: string; className?: string }) {
  return (
    <div role="img" aria-label={`PIN ${pin.split('').join(' ')}`} className={cn('flex justify-center gap-2', className)}>
      {pin.split('').map((d, i) => (
        <span key={i} className="grid h-16 w-12 place-items-center rounded-xl bg-white font-heading text-4xl font-extrabold text-[#04130d] shadow-card">
          {d}
        </span>
      ))}
    </div>
  );
}
