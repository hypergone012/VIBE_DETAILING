import { createContext, useContext } from 'react';
import type { OwnerApi } from '@/api/ownerApi';
import type { OwnerSession } from '@/api/ownerSchemas';

export interface OwnerContextValue {
  slug: string;
  base: string;
  api: OwnerApi;
  session: OwnerSession;
  accessToken: string;
  signOut: () => Promise<void>;
}

export const OwnerContext = createContext<OwnerContextValue | null>(null);

export function useOwner(): OwnerContextValue {
  const ctx = useContext(OwnerContext);
  if (!ctx) throw new Error('useOwner must be used inside the owner cabinet');
  return ctx;
}

/** Query keys of private owner data: all start with ['owner', slug] and are dropped on logout. */
export const ownerKeys = {
  all: (slug: string) => ['owner', slug] as const,
  session: (slug: string) => ['owner', slug, 'session'] as const,
  schedule: (slug: string, from: string, to: string) => ['owner', slug, 'schedule', from, to] as const,
  booking: (slug: string, id: string) => ['owner', slug, 'booking', id] as const,
  slots: (slug: string, serviceId: string, from: string) => ['owner', slug, 'slots', serviceId, from] as const,
  stats: (slug: string, period: string) => ['owner', slug, 'stats', period] as const,
  settings: (slug: string) => ['owner', slug, 'settings'] as const,
};
