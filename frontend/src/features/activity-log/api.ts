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
  /** The backend caps how many *related* objects (subtasks, linked docs, …) it
   *  folds into one timeline (`MAX_RELATED`). True means some were left out, so
   *  the list is honestly partial and must say so rather than look complete. */
  relatedTruncated: boolean;
}

/** The entity kinds `GET /v1/activity` guards and serves — `AuditEntity` in
 *  backend/src/application/audit-log/domain/enums/audit.enums.ts. A closed
 *  union so a call site can't invent a kind the endpoint would 404 on. */
export type ActivityEntityKind = 'issue' | 'doc_page' | 'roadmap_item';

/**
 * One object's change history — an issue, a doc page or a roadmap item, all
 * three of which the backend records and guards. `entityId` empty means
 * "nothing to fetch" (a public read-only view has no token for an authed
 * request), so the query stays disabled rather than firing one that would fail.
 */
export function useActivity(entity: ActivityEntityKind, entityId: string) {
  return useQuery({
    queryKey: activityKeys.entity(entity, entityId),
    queryFn: () => apiGet<ActivityPage>('/activity', { entity, entityId, limit: 100 }),
    enabled: Boolean(entityId),
    select: (page) => ({ items: page.items, relatedTruncated: page.relatedTruncated }),
  });
}
