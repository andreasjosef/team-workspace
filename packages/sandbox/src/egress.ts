import { z } from 'zod';

// The egress proxy's log of refused requests (apps/egress-proxy). The
// hub reads it after each networked phase and turns entries into
// `blocked` events.
export const DeniedRequest = z.object({
  at: z.number(),
  method: z.string(),
  target: z.string(),
  source: z.string(),
});
export type DeniedRequest = z.infer<typeof DeniedRequest>;

export const fetchDenied = async (
  adminUrl: string,
  sinceMs: number
): Promise<DeniedRequest[]> => {
  const res = await fetch(`${adminUrl}/denied?since=${sinceMs}`);
  if (!res.ok) throw new Error(`egress proxy answered ${res.status}`);
  return z.array(DeniedRequest).parse(await res.json());
};
