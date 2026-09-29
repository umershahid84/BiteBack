'use client';

import { useState } from 'react';
import dynamic from 'next/dynamic';
import { useRouter } from 'next/navigation';
import { LocateFixed } from 'lucide-react';
import { toast } from 'sonner';
import { saveRestaurantProfile } from '@/app/actions/restaurant';
import { ErrorText } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Field, Input, Textarea } from '@/components/ui/field';
import { SectionLabel } from '@/components/ui/misc';
import type { Ctx } from './types';

const PinMap = dynamic(() => import('./pin-map'), { ssr: false, loading: () => <div className="mb-4 h-72 rounded-xl border border-line" /> });

export function ProfilePanel({ ctx }: { ctx: Ctx }) {
  const r = ctx.restaurant;
  const router = useRouter();
  const [f, setF] = useState({
    name: r.name, cuisine: r.cuisine, description: r.description, address: r.address, city: r.city, zip: r.zip, phone: r.phone,
    lat: r.lat != null ? r.lat.toFixed(5) : '', lng: r.lng != null ? r.lng.toFixed(5) : '', taxRatePct: (r.tax_rate_bps / 100).toFixed(2),
  });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const setPin = (lat: number, lng: number) => setF((x) => ({ ...x, lat: lat.toFixed(5), lng: lng.toFixed(5) }));

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const res = await saveRestaurantProfile(f);
    setBusy(false);
    if (!res.ok) return setError(res.error);
    setError(null);
    toast.success('Profile saved');
    router.refresh();
  };

  return (
    <Card className="max-w-[760px]">
      <form onSubmit={save} noValidate>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Restaurant name" htmlFor="p-name"><Input id="p-name" value={f.name} onChange={set('name')} /></Field>
          <Field label="Cuisine" htmlFor="p-cuisine"><Input id="p-cuisine" value={f.cuisine} onChange={set('cuisine')} /></Field>
        </div>
        <Field label="About" htmlFor="p-desc"><Textarea id="p-desc" maxLength={400} value={f.description} onChange={set('description')} /></Field>
        <Field label="Street address" htmlFor="p-address"><Input id="p-address" value={f.address} onChange={set('address')} /></Field>
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="City" htmlFor="p-city"><Input id="p-city" value={f.city} onChange={set('city')} /></Field>
          <Field label="ZIP" htmlFor="p-zip"><Input id="p-zip" value={f.zip} onChange={set('zip')} /></Field>
          <Field label="Phone" htmlFor="p-phone"><Input id="p-phone" value={f.phone} onChange={set('phone')} /></Field>
        </div>
        <SectionLabel>Map location</SectionLabel>
        <p className="mb-3 text-sm text-muted">This is where your pin appears on the customer map. Drag the pin (or click the map) to your front door, or use your current location.</p>
        <PinMap lat={f.lat ? Number(f.lat) : null} lng={f.lng ? Number(f.lng) : null} config={ctx.map} onChange={setPin} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Latitude" htmlFor="p-lat"><Input id="p-lat" value={f.lat} onChange={set('lat')} /></Field>
          <Field label="Longitude" htmlFor="p-lng"><Input id="p-lng" value={f.lng} onChange={set('lng')} /></Field>
          <Field label=" ">
            <Button type="button" variant="ghost" block onClick={() => navigator.geolocation?.getCurrentPosition((p) => setPin(p.coords.latitude, p.coords.longitude), () => toast.error('Could not get your location.'))}>
              <LocateFixed /> Use my location
            </Button>
          </Field>
        </div>
        <SectionLabel>Sales tax</SectionLabel>
        <Field label="Sales tax rate (%)" htmlFor="p-tax" className="max-w-60"
          hint={<>Your combined WA state + local rate. <a href="https://dor.wa.gov/taxes-rates/sales-use-tax-rates/lookup-tax-rate" target="_blank" rel="noopener">Look up your rate</a>.</>}>
          <Input id="p-tax" inputMode="decimal" value={f.taxRatePct} onChange={set('taxRatePct')} />
        </Field>
        <ErrorText error={error} />
        <Button variant="green" type="submit" disabled={busy}>{busy ? 'Saving…' : 'Save profile'}</Button>
      </form>
    </Card>
  );
}
