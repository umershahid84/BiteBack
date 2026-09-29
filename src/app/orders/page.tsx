import type { Metadata } from 'next';
import { OrdersList } from '@/components/orders/orders-list';
import { requirePageViewer } from '@/lib/auth';

export const metadata: Metadata = { title: 'My orders' };

export default async function OrdersPage() {
  const viewer = await requirePageViewer('customer');
  return (
    <main className="container-page max-w-[900px] py-8">
      <h1 className="text-3xl font-extrabold">My orders</h1>
      <OrdersList userId={viewer.id} />
    </main>
  );
}
