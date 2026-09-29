import type { Metadata } from 'next';
import { ReportView } from '@/components/restaurant/report-view';
import { requirePageViewer } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { restaurantReport } from '@/lib/receipts/report-access';
import { todayIn } from '@/lib/receipts/time';

export const metadata: Metadata = { title: 'Daily report' };

export default async function ReportPage({ searchParams }: PageProps<'/restaurant/report'>) {
  await requirePageViewer('restaurant');
  const { date } = await searchParams;
  const today = todayIn(serverEnv.timeZone);
  const valid = typeof date === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(date) && !Number.isNaN(Date.parse(date)) ? date : today;
  const report = await restaurantReport(valid);
  return <ReportView report={report} today={today} />;
}
