import { useQuery } from '@tanstack/react-query';
import { apiGet } from '@/lib/api';
import type { ActivityEntryDto } from '@/types/dto';

export const activityKeys = {
  entity: (entity: string, entityId: string) => ['activity', entity, entityId] as const,
};

/** The shape `GET /v1/activity` returns once `TransformInterceptor`/`apiGet`
 *  have peeled the `{ statusCode, data }` envelope off — a flat paginated list
 *  (`IServiceListResponse`, see `backend/libs/core/helpers/response.helper.ts`),
 *  same convention as `findByProject`. Only `items` is used here; the endpoint
 *  is capped at 100 rows a page, which is plenty for one issue's history. */
interface ActivityPage {
  items: ActivityEntryDto[];
  total: number;
  page: number;
  limit: number;
  totalPages: number;
}

/**
 * One object's change history. `entityId` empty means "nothing to fetch" —
 * e.g. a public read-only view, or an entity kind the backend doesn't guard
 * yet (v1 only knows `'issue'`) — so the query stays disabled rather than
 * firing a request that would just 404.
 */
export function useActivity(entity: string, entityId: string) {
  return useQuery({
    queryKey: activityKeys.entity(entity, entityId),
    queryFn: () => apiGet<ActivityPage>('/activity', { entity, entityId, limit: 100 }),
    enabled: Boolean(entityId),
    select: (page) => page.items,
  });
}
