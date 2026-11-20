import { paths, type RoleSummary } from '@app/shared';
import type { FastifyInstance } from 'fastify';
import type { Hub } from '../hub/load.ts';

// The product context each role view is built on. Read-only: changes to
// decisions and docs go through tasks like everything else.
export const workspaceRoutes = (app: FastifyInstance, hub: Hub) => {
  app.get(paths.roles, async (): Promise<RoleSummary[]> =>
    [...hub.roles.values()].map(
      ({ policy: { systemPrompt: _p, ...summary } }) => summary
    )
  );
  app.get(paths.docs, async () => hub.docs);
  // Newest first.
  app.get(paths.incidents, async () =>
    [...hub.incidents].sort((a, b) => b.at.localeCompare(a.at))
  );
};
