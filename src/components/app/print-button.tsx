'use client';

import { Printer } from 'lucide-react';
import { Button } from '@/components/ui/button';

export function PrintButton({ label = 'Print' }: { label?: string }) {
  return (
    <Button variant="ghost" size="sm" type="button" onClick={() => window.print()}>
      <Printer /> {label}
    </Button>
  );
}
