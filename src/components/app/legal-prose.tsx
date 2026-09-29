import { cn } from '@/lib/utils';

// Typography for the legal documents (rendered from trusted, server-generated HTML).
export function LegalProse({ html, className }: { html: string; className?: string }) {
  return (
    <div
      className={cn(
        'leading-relaxed text-[#24332c] [&_a]:text-[#047857] [&_h2]:mt-7 [&_h2]:mb-2 [&_h2]:text-[1.05rem] [&_h2]:font-extrabold [&_h2]:text-[#0b1b14] [&_li]:mb-1.5 [&_li]:text-[0.93rem] [&_p]:mb-3 [&_p]:text-[0.93rem] [&_p.lead]:rounded-xl [&_p.lead]:bg-[#f2f7f4] [&_p.lead]:px-4 [&_p.lead]:py-3.5 [&_p.lead]:text-base [&_p.lead]:text-[#0b1b14] [&_ul]:mb-4 [&_ul]:list-disc [&_ul]:pl-5',
        className,
      )}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
