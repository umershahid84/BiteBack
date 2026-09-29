import 'server-only';
import { getViewer } from '@/lib/auth';
import { serverEnv } from '@/lib/env';
import { AppError } from '@/lib/errors';
import { reportData } from './data';
import { todayIn } from './time';

// Daily report for the signed-in restaurant (date: YYYY-MM-DD in Pacific Time, default today).
export async function restaurantReport(dateParam: string | null | undefined) {
  const viewer = await getViewer();
  if (!viewer || viewer.role !== 'restaurant' || !viewer.restaurant) throw new AppError(401, 'Please log in as a restaurant.');
  const date = dateParam || todayIn(serverEnv.timeZone);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) throw new AppError(400, 'Please choose a valid date.');
  return reportData(viewer.restaurant.id, date);
}
