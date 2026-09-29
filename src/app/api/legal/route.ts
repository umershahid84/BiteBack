import { NextResponse, type NextRequest } from 'next/server';
import { company } from '@/lib/legal/company';
import { REQUIRED, renderDocument } from '@/lib/legal/documents';

// Documents a role must accept, with their full text (for the accept/decline dialog).
export async function GET(req: NextRequest) {
  const role = req.nextUrl.searchParams.get('role') === 'restaurant' ? 'restaurant' : 'customer';
  const c = await company();
  return NextResponse.json({ documents: REQUIRED[role].map((id) => renderDocument(id, c)) });
}
