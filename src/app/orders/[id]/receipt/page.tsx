import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { ArrowLeft, Download } from 'lucide-react';
import { PrintButton } from '@/components/app/print-button';
import { PosReceipt } from '@/components/receipts/pos-receipt';
import { buttonVariants } from '@/components/ui/button';
import { requirePageViewer } from '@/lib/auth';
import { receiptData } from '@/lib/receipts/data';
import { supabaseServer } from '@/lib/supabase/server';

export const metadata: Metadata = { title: 'Receipt' };

export default async function ReceiptPage({ params }: PageProps<'/orders/[id]/receipt'>) {
  const { id } = await params;
  const viewer = await requirePageViewer('customer');
  // Read as the customer: RLS only returns their own orders.
  const supabase = await supabaseServer();
  const { data: order } = await supabase.from('orders').select('*').eq('id', Number(id)).eq('user_id', viewer.id).maybeSingle();
  if (!order) notFound();
  const receipt = await receiptData(order);
  return (
    <main className="container-page max-w-[520px] py-8">
      <div className="no-print mb-5 flex flex-wrap items-center gap-2">
        <Link href="/orders" className={buttonVariants({ variant: 'ghost', size: 'sm' })}><ArrowLeft /> My orders</Link>
        <span className="flex-1" />
        <PrintButton />
        <a href={`/api/orders/${order.id}/receipt`} className={buttonVariants({ size: 'sm' })}><Download /> Download PDF</a>
      </div>
      <PosReceipt r={receipt} />
    </main>
  );
}
