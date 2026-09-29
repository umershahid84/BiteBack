'use client';

import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { setRestaurantStatus } from '@/app/actions/admin';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input, Select } from '@/components/ui/field';
import { Spinner, Table } from '@/components/ui/misc';
import { money, pct } from '@/lib/format';
import { day, run, useAdmin } from './shared';

type Row = {
  id: number; name: string; cuisine: string; address: string; city: string; zip: string; phone: string; status: 'pending' | 'approved' | 'suspended';
  adminNote: string; taxRateBps: number; createdAt: string; ownerEmail: string; ownerUsername: string; activeOffers: number; orders: number;
  foodCents: number; stripeReady: boolean; stripeAccount: string | null;
};

export function RestaurantsPanel() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');
  const { data, isLoading } = useAdmin<Row[]>(['restaurants', status, q], 'restaurants', { status, q });
  const change = async (r: Row, next: Row['status']) => {
    const note = next === 'suspended' ? prompt(`Why are you suspending ${r.name}? (shown to the restaurant)`) : '';
    if (note === null) return;
    if (await run(() => setRestaurantStatus({ id: r.id, status: next, note }), `${r.name}: ${next}`)) queryClient.invalidateQueries({ queryKey: ['admin'] });
  };
  return (
    <>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input className="max-w-sm" placeholder="Search name, city, ZIP or owner email" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select className="max-w-52" value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="">All statuses</option><option value="pending">Pending approval</option><option value="approved">Approved</option><option value="suspended">Suspended</option>
        </Select>
      </div>
      <Card className="p-2">
        {isLoading ? <div className="grid place-items-center py-10"><Spinner /></div> : (
          <Table>
            <thead><tr><th>Restaurant</th><th>Owner</th><th>Activity</th><th>Payouts</th><th>Status</th><th /></tr></thead>
            <tbody>
              {(data ?? []).map((r) => (
                <tr key={r.id}>
                  <td><b>{r.name}</b><div className="text-xs text-muted">{r.cuisine} · {r.address}, {r.city} {r.zip} · tax {pct(r.taxRateBps)}</div>{r.adminNote && <div className="text-xs text-accent-ink">Note: {r.adminNote}</div>}</td>
                  <td className="text-sm">{r.ownerUsername}<div className="text-xs text-muted">{r.ownerEmail} · joined {day(r.createdAt)}</div></td>
                  <td className="text-sm">{r.activeOffers} live offers<div className="text-xs text-muted">{r.orders} orders · {money(r.foodCents)}</div></td>
                  <td>{r.stripeReady ? <Badge tone="green">Stripe ready</Badge> : <Badge tone="amber">Not connected</Badge>}</td>
                  <td><StatusBadge status={r.status} label={r.status === 'pending' ? 'Pending approval' : undefined} /></td>
                  <td className="whitespace-nowrap">
                    <div className="flex gap-1.5">
                      {r.status !== 'approved' && <Button size="sm" variant="green" onClick={() => change(r, 'approved')}>{r.status === 'pending' ? 'Approve' : 'Reinstate'}</Button>}
                      {r.status !== 'suspended' && <Button size="sm" variant="danger" onClick={() => change(r, 'suspended')}>Suspend</Button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}
