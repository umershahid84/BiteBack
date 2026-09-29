import type { Database } from '@/lib/database.types';

export type OfferRow = Database['public']['Functions']['search_offers']['Returns'][number];
export type Origin = { lat: number; lng: number; label?: string };
export type MapConfig = { tileUrl: string; attribution: string; darkFilter: boolean };
