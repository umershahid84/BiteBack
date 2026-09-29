'use client';

import { FileSpreadsheet } from 'lucide-react';
import { buttonVariants } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Kpi, Spinner, Table } from '@/components/ui/misc';
import { money, pct } from '@/lib/format';
import { RangePicker, useAdmin, type Range } from './shared';

type Tax = { rows: { city: string; zip: string; rateBps: number; orders: number; taxableCents: number; taxCents: number }[]; totals: { taxableCents: number; taxCents: number } };

export function TaxPanel({ range, setRange }: { range: Range; setRange: (r: Range) => void }) {
  const { data, isLoading } = useAdmin<Tax>(['tax', range], 'tax', range);
  return (
    <>
      <div className="flex flex-wrap items-start"><RangePicker range={range} onChange={setRange} /><span className="flex-1" />
        <a className={buttonVariants({ variant: 'ghost', size: 'sm' })} href={`/api/admin/export/tax?from=${range.from}&to=${range.to}`}><FileSpreadsheet /> Export CSV</a></div>
      <p className="mb-4 text-sm text-muted">Retail sales tax collected on completed orders (less refunds to the original payment), by restaurant location. Use it for your Washington excise tax return as a marketplace facilitator.</p>
      {isLoading || !data ? <Spinner /> : (
        <>
          <div className="mb-4 grid grid-cols-2 gap-3"><Kpi value={money(data.totals.taxableCents)} label="Taxable sales" /><Kpi value={money(data.totals.taxCents)} label="Sales tax collected" /></div>
          <Card className="p-2">
            <Table>
              <thead><tr><th>City</th><th>ZIP</th><th>Rate</th><th>Orders</th><th>Taxable sales</th><th>Sales tax</th></tr></thead>
              <tbody>{data.rows.map((x) => <tr key={`${x.city}${x.zip}${x.rateBps}`}><td>{x.city}</td><td>{x.zip}</td><td>{pct(x.rateBps)}</td><td>{x.orders}</td><td>{money(x.taxableCents)}</td><td>{money(x.taxCents)}</td></tr>)}</tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
