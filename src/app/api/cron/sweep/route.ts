import { NextResponse, type NextRequest } from 'next/server';
import { serverEnv } from '@/lib/env';
import { sweep } from '@/lib/orders';

// Cleanup job: releases stale checkouts and missed pickups, ends expired offers, and voids the
// matching card holds. pg_cron runs the database part every minute; call this route regularly
// (vercel.json schedules it) with "Authorization: Bearer <CRON_SECRET>" so card holds are voided too.
export async function GET(req: NextRequest) {
  if (!serverEnv.cronSecret || req.headers.get('authorization') !== `Bearer ${serverEnv.cronSecret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 });
  }
  return NextResponse.json(await sweep());
}
