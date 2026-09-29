import 'server-only';
import { serverEnv } from '@/lib/env';
import { supabaseAdmin } from '@/lib/supabase/admin';
import { renderDocument, type Company } from './documents';

// Company details and live settings (service fee) used in the legal documents.
export async function company(): Promise<Company> {
  const { data } = await supabaseAdmin().from('settings').select('value').eq('key', 'service_fee_bps').maybeSingle();
  return {
    ...serverEnv.legal,
    serviceFeePct: Number(data?.value ?? 500) / 100,
    graceMinutes: serverEnv.pickupGraceMinutes,
  };
}

export async function legalDocument(id: string) {
  return renderDocument(id, await company());
}
