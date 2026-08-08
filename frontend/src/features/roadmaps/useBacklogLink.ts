import { useMemo } from 'react';
import { t } from '@/i18n';
import type { ComboboxOption } from '@/components/ui';
import { useRoadmaps } from './api';

/** The four fields an issue stores to say which backlog item it delivers. Always
 *  written together — a `roadmapItemId` without its `roadmapId` can't be linked
 *  back to, and a stale `roadmapItemLabel` is what the boards actually show. */
export interface BacklogLink {
  roadmapId: string;
  roadmapItemId: string;
  roadmapItemLabel: string;
  projectId: string;
}

/**
 * The link, blanked — what "this issue delivers no backlog item" is written as.
 * Exported because unlinking happens from both ends: the issue's own Properties
 * (`BacklogItemPropField`, via `linkFor('')`) and the backlog item's linked-issues
 * panel (`TaskPanel`). All four go together on the way out for the same reason
 * they do on the way in — a leftover `roadmapId` or stale label is a link the
 * boards still draw.
 */
export const BACKLOG_UNLINKED: BacklogLink = {
  roadmapId: '',
  roadmapItemId: '',
  roadmapItemLabel: '',
  projectId: '',
};

/**
 * Every backlog item across every roadmap, as one pickable list plus the flat
 * link to write when one is chosen.
 *
 * A backlog item is **not** an issue — it lives inside `roadmaps.items`, not the
 * `issues` collection — so it can never be an issue's `parentId`, and searching
 * the parent picker for `RM-…` will never find one. This is the relation that
 * does hold it, and it's a plain foreign key rather than hierarchy: an issue has
 * a parent issue *and* a backlog item, independently.
 *
 * One source for the option list and the link because three screens write it
 * (new-task form, a task's Properties, a bug's) and a fourth reads it back
 * (`SubtaskSection` under a roadmap item) — a label built differently in any of
 * them shows up as two names for the same item.
 */
export function useBacklogLink(enabled = true): {
  options: ComboboxOption[];
  linkFor: (itemId: string) => BacklogLink;
  /** The item's own title and ref, or `undefined` while the roadmaps aren't
   *  loaded. An issue denormalizes only `"<phase> · <title>"`, so anything that
   *  needs either half on its own — the breadcrumb wants the bare title —
   *  resolves it here. `shortId` is `''` on items that predate refs. */
  itemFor: (itemId: string) => { shortId: string; title: string } | undefined;
} {
  const { data: roadmaps } = useRoadmaps(enabled);

  return useMemo(() => {
    const links = new Map<string, BacklogLink>();
    const items = new Map<string, { shortId: string; title: string }>();
    const options: ComboboxOption[] = [{ value: '', label: t('tasks.noBacklogItem') }];

    for (const roadmap of roadmaps ?? []) {
      for (const item of roadmap.items ?? []) {
        const phase = roadmap.columns?.find((c) => c.key === item.phase)?.label ?? item.phase;
        items.set(item.id, { shortId: item.shortId ?? '', title: item.title });
        links.set(item.id, {
          roadmapId: roadmap.id,
          roadmapItemId: item.id,
          // Byte-for-byte what the roadmap item's own side writes
          // (`RoadmapItemDetail`), so linking from either end reads the same.
          roadmapItemLabel: `${phase} · ${item.title}`,
          projectId: roadmap.projectId,
        });
        options.push({
          value: item.id,
          // The ref leads because that's the string people paste. The picker
          // filters on this label, so `RM-7VBD8CR` has to be *in* it to be
          // findable at all; legacy items with no ref yet simply start at the
          // roadmap name. The roadmap + column qualify same-named items.
          label: [item.shortId, roadmap.title, phase, item.title].filter(Boolean).join(' · '),
        });
      }
    }

    return {
      options,
      linkFor: (id: string) => links.get(id) ?? BACKLOG_UNLINKED,
      itemFor: (id: string) => items.get(id),
    };
  }, [roadmaps]);
}
