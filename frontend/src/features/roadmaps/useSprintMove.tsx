import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { ArrowLeft, ArrowRight, Check, CircleSlash, Minus } from 'lucide-react';
import { Button, Dialog } from '@/components/ui';
import { apiPatch } from '@/lib/api';
import { t } from '@/i18n';
import { invalidateAllIssueCaches } from '@/features/issues/bulk.api';
import { doneKeyOf } from '@/features/my-team/workload';
import { useTeamStatusesLookup } from '@/features/teams/api';
import { CycleStatus, TeamIssueType } from '@/types/enums';
import type { MenuItem } from '@/components/ui';
import type { TaskDto } from '@/types/dto';
import type { RoadmapSprint } from './useRoadmapSprints';

/**
 * Moving a backlog item to another sprint — the write behind the board card's
 * right-click menu.
 *
 * `useRoadmapSprints` derives sprints and deliberately never writes; this is the
 * other half. Three facts from the data and the API shape all of it:
 *
 * 1. **An item has no `cycleId`.** Its sprints are the union of its *tasks'*, so
 *    the move is a fan-out over those tasks. Nothing on `roadmaps.items` changes.
 * 2. **A cycle is team-scoped.** `update-issue.use-case.ts` refuses a cycle that
 *    isn't the issue's own team's, and one item's tasks routinely span Design /
 *    Frontend / Backend. So there is no single `cycleId` to write: each task gets
 *    its own team's cycle for the target window, via `sprint.cycleIdByTeam`. A
 *    task whose team runs nothing in that window simply cannot follow.
 * 3. **History is immutable.** The same use case refuses a *completed* cycle
 *    ("Completed cycles cannot take new issues"), so only current and upcoming
 *    windows are offered — never a row that is certain to fail.
 * 4. **Finished work is history too.** That guard only protects the *destination*.
 *    Nothing stops a task being pulled *out* of a closed cycle — and a cycle that
 *    closed already reported its completed count and velocity (`closeCycle`), so
 *    doing that quietly rewrites a number a retro was run on. The server's own
 *    rollover carries only what is unfinished (`moveUnfinishedIssues` —
 *    `status: { $nin: completedStatusKeys }` — which is what "Carried over ×N"
 *    counts). A manual move may still take finished work along, because
 *    re-committing a delivered item is a real thing to want, but it **asks first**
 *    rather than deciding for you: see {@link useSprintMove}.
 *
 * The semantics are **target, not shift**: every task lands in the one window you
 * picked. That matters for an item spanning two sprints (started in 3, finishing
 * in 4) — moving it collapses that span onto a single window, because "move this
 * item to Cycle 5" has no other honest reading. Next/prev anchor on the ends of
 * the span: next from its newest sprint, prev from its oldest.
 */

/** Only these can take new work — see fact 3. */
const JOINABLE = [CycleStatus.ACTIVE, CycleStatus.UPCOMING];
const joinable = (s: RoadmapSprint) => JOINABLE.includes(s.status);

interface SprintMovePlan {
  /** The writes to make: a task, and the cycle it should join (`''` leaves its
   *  cycle). Tasks already in the right cycle are left out — a no-op PATCH would
   *  only inflate the count the toast reports. */
  writes: { taskId: string; cycleId: string }[];
  /** Tasks that can't follow the move: their team runs no cycle in the target
   *  window, or they're personal tasks (no team, so they can never join one).
   *  Reported to the user, never written. */
  stuck: TaskDto[];
}

/**
 * What moving `tasks` into `target` would actually do. Pure, so the menu can
 * price the move before offering it (a target that changes nothing is disabled)
 * and the toast can describe it afterwards. `target: null` = take the item out of
 * its sprint altogether.
 *
 * Module-private, like the write it feeds: planning and applying outside this file
 * is exactly how a caller would end up moving finished work with no prompt.
 */
function planSprintMove(tasks: TaskDto[], target: RoadmapSprint | null): SprintMovePlan {
  const writes: SprintMovePlan['writes'] = [];
  const stuck: TaskDto[] = [];
  for (const task of tasks) {
    if (!target) {
      // Un-planning: only a task actually in a cycle has anything to leave.
      if (task.cycleId) writes.push({ taskId: task.id, cycleId: '' });
      continue;
    }
    const cycleId = task.teamId ? target.cycleIdByTeam[task.teamId] : undefined;
    if (!cycleId) {
      stuck.push(task);
      continue;
    }
    if (cycleId !== task.cycleId) writes.push({ taskId: task.id, cycleId });
  }
  return { writes, stuck };
}

interface MoveVars {
  plan: SprintMovePlan;
  target: RoadmapSprint | null;
  /** Finished tasks the caller chose to leave where they were — reported in the
   *  toast, never written. Without this the move would look like it skipped them
   *  by accident. */
  keptDone: number;
}

/**
 * Apply a {@link SprintMovePlan}. One PATCH per task down the same validated
 * single-issue endpoint the detail view uses, so every server guard is reused
 * per task — deliberately no bulk endpoint, matching `bulk.api.ts`.
 *
 * Unpooled on purpose: that file caps concurrency because a select-all can be
 * 100 rows, but one backlog item's task list is a handful. `allSettled` so one
 * rejection can't strand the rest — a partial move still reports honestly rather
 * than looking like a total failure.
 *
 * Private: {@link useSprintMove} is the way in, so the finished-work check in
 * front of this can't be skipped by a new caller who doesn't know about it.
 */
function useMoveItemToSprint() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ plan }: MoveVars) => {
      const results = await Promise.allSettled(
        plan.writes.map((w) => apiPatch(`/issues/${w.taskId}`, { cycleId: w.cycleId })),
      );
      const rejected = results.filter(
        (r): r is PromiseRejectedResult => r.status === 'rejected',
      );
      const reason = rejected[0]?.reason;
      return {
        ok: results.length - rejected.length,
        failed: rejected.length,
        firstError: reason instanceof Error ? reason.message : reason ? String(reason) : undefined,
      };
    },
    onSuccess: ({ ok, failed, firstError }, { plan, target, keptDone }) => {
      // A cycle move shifts cycle membership and every board's stats, so refresh
      // the lot — including `cycles`, which is what the roadmap derives from.
      invalidateAllIssueCaches(qc);

      // Tasks left behind are not errors, but staying silent about them would be
      // the one genuinely misleading outcome: the item would still show its old
      // sprint chip with no explanation.
      const notes: string[] = [];
      // The user's own choice, so it leads: confirming it back is what makes a
      // count smaller than the item's task list read as intended rather than lost.
      if (keptDone > 0) {
        notes.push(t('sprints.moveKeptDone').replace('{n}', String(keptDone)));
      }
      if (plan.stuck.length > 0) {
        notes.push(t('sprints.moveStuck').replace('{n}', String(plan.stuck.length)));
      }
      if (failed > 0) {
        notes.push(firstError ?? t('sprints.moveFailed'));
        toast.warning(t('sprints.moveFailed'), { description: notes.join(' · ') });
        return;
      }
      const done = target
        ? t('sprints.moved').replace('{name}', target.name)
        : t('sprints.movedOut');
      toast.success(`${done} · ${t('sprints.moveTasks').replace('{n}', String(ok))}`, {
        description: notes.join(' · ') || undefined,
      });
    },
    onError: (err) => toast.error(t('sprints.moveFailed'), { description: err.message }),
  });
}

type MoveWrite = SprintMovePlan['writes'][number];

/** One move waiting on the user, held while the confirmation is open. */
interface PendingMove {
  target: RoadmapSprint | null;
  stuck: TaskDto[];
  /** Writes for work still in flight — what a cycle rollover would carry. */
  open: MoveWrite[];
  /** Writes for work already finished — the reason we're asking at all. */
  finished: MoveWrite[];
  /**
   * How many of `finished` would actually be pulled *out of* a cycle. A task
   * finished without ever being planned leaves nothing behind, so it isn't part
   * of the warning — and on its own would never have raised one.
   */
  leaving: number;
  /** The windows that work would leave, named for the prompt. */
  sources: string[];
  /** At least one of them has closed, so it has already reported its numbers. */
  fromClosed: boolean;
}

export type MoveScope = 'all' | 'unfinished';

/**
 * Move a backlog item's work to another cycle — the whole interaction, not just
 * the write.
 *
 * A move takes **every** linked task, which is what "move this item to Cycle 5"
 * plainly means. But when some of those tasks are already finished, that quietly
 * edits history (fact 4 above), so this stops once and asks: cancel, carry only
 * the unfinished work (the server's own rollover rule), or move the lot anyway.
 * It asks only when history is genuinely at stake — finished work sitting in a
 * cycle it would leave — so the common move goes straight through with no dialog.
 *
 * The finished test is the owning team's terminal column, the same
 * `doneKeyOf(statusesFor(...))` the sprint rollup counts with, so the banner's
 * "12 of 20 done" and this can't disagree about what shipped. It lives here and
 * nowhere else: {@link planSprintMove} stays pure and knows nothing about it, and
 * the write is private behind this hook, so no future caller can move finished
 * work without passing this gate.
 *
 * Both surfaces that offer the move share this: the board card's right-click menu
 * and the item detail's cycle row.
 */
export function useSprintMove(sprintForTask: (task: TaskDto) => RoadmapSprint | undefined) {
  const statusesFor = useTeamStatusesLookup();
  const move = useMoveItemToSprint();
  const [pending, setPending] = useState<PendingMove | null>(null);
  // Which choice is in flight, so the dialog can stay open under a spinner and
  // can't be answered twice. Not `move.isPending`: that's also true for a move
  // started from another card, which would spin this dialog over nothing.
  const [applying, setApplying] = useState<MoveScope | null>(null);

  const isFinished = (tk: TaskDto) =>
    tk.status === doneKeyOf(statusesFor(tk.teamId, TeamIssueType.TASK));

  function requestMove(tasks: TaskDto[], target: RoadmapSprint | null) {
    const plan = planSprintMove(tasks, target);
    const byId = new Map(tasks.map((tk) => [tk.id, tk]));

    const open: MoveWrite[] = [];
    const finished: MoveWrite[] = [];
    const sources = new Map<string, RoadmapSprint>();
    let leaving = 0;
    for (const w of plan.writes) {
      const tk = byId.get(w.taskId);
      if (!tk || !isFinished(tk)) {
        open.push(w);
        continue;
      }
      finished.push(w);
      const from = sprintForTask(tk);
      if (from) {
        leaving += 1;
        sources.set(from.key, from);
      }
    }

    // Nothing finished would leave a cycle, so there is nothing to weigh.
    if (leaving === 0) {
      move.mutate({ plan, target, keptDone: 0 });
      return;
    }
    const from = [...sources.values()];
    setPending({
      target,
      stuck: plan.stuck,
      open,
      finished,
      leaving,
      sources: from.map((s) => s.name),
      fromClosed: from.some((s) => s.status === CycleStatus.COMPLETED),
    });
  }

  function apply(scope: MoveScope) {
    if (!pending || applying) return;
    const writes = scope === 'all' ? [...pending.open, ...pending.finished] : pending.open;
    setApplying(scope);
    move.mutate(
      {
        plan: { writes, stuck: pending.stuck },
        target: pending.target,
        keptDone: scope === 'all' ? 0 : pending.finished.length,
      },
      // Closes on settle rather than on click, so a slow fan-out shows a spinner
      // where the decision was made instead of a dialog that vanishes into
      // nothing while several PATCHes are still in the air.
      { onSettled: () => { setApplying(null); setPending(null); } },
    );
  }

  return {
    /** Ask to move `tasks` into `target` (`null` = out of any cycle). Confirms
     *  first if finished work would leave a cycle, otherwise writes straight away. */
    requestMove,
    /** The confirmation. Render it in your tree (it portals to `<body>`). */
    dialog: (
      <MoveConfirm
        pending={pending}
        applying={applying}
        onCancel={() => setPending(null)}
        onApply={apply}
      />
    ),
  };
}

/**
 * "This also moves work that's already done" — the one beat before a move that
 * would change a number a cycle has already reported.
 *
 * Three ways out, because the honest answer depends on why you're moving: cancel,
 * carry only what's unfinished, or move everything anyway. The last one is the
 * primary button — you already asked for it, and this is a heads-up rather than an
 * objection. Each action carries its count, so the choice is arithmetic instead of
 * a guess, and "unfinished only" goes dead at `· 0` on an item that's entirely
 * finished, with a line saying why.
 */
function MoveConfirm({
  pending,
  applying,
  onCancel,
  onApply,
}: {
  pending: PendingMove | null;
  /** The choice currently being written, or `null` while waiting on the user. */
  applying: MoveScope | null;
  onCancel: () => void;
  onApply: (scope: MoveScope) => void;
}) {
  // Unmounts on close rather than animating out: everything below reads the
  // pending move's numbers, and a dialog fading out over stale counts would be
  // showing the user figures that no longer describe anything.
  if (!pending) return null;
  const { open, finished, leaving, sources, fromClosed } = pending;

  return (
    <Dialog
      open
      // Esc and the overlay stop dismissing once a choice is in flight: the write
      // is already going out, so "cancel" would be a lie.
      onClose={() => {
        if (!applying) onCancel();
      }}
      title={t('sprints.moveDoneTitle')}
      footer={
        <>
          <Button variant="ghost" disabled={applying !== null} onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="outline"
            disabled={open.length === 0 || applying === 'all'}
            loading={applying === 'unfinished'}
            onClick={() => onApply('unfinished')}
          >
            {`${t('sprints.moveUnfinishedOnly')} · ${open.length}`}
          </Button>
          <Button
            disabled={applying === 'unfinished'}
            loading={applying === 'all'}
            onClick={() => onApply('all')}
          >
            {`${t('sprints.moveAllAnyway')} · ${open.length + finished.length}`}
          </Button>
        </>
      }
    >
      <p className="text-sm text-muted-foreground">
        {t('sprints.moveDoneBody')
          .replace('{n}', String(leaving))
          .replace('{from}', sources.join(' · '))}
      </p>
      {fromClosed && (
        <p className="mt-2 text-sm text-muted-foreground">{t('sprints.moveDoneClosed')}</p>
      )}
      {open.length === 0 && (
        <p className="mt-2 text-sm text-muted-foreground">{t('sprints.moveDoneAllDone')}</p>
      )}
    </Dialog>
  );
}

export interface SprintMoveMenuArgs {
  /** The sprints this item already has work in, oldest → newest. */
  itemSprints: RoadmapSprint[];
  /** Every sprint on the roadmap, newest first. */
  sprints: RoadmapSprint[];
  /** The item's linked tasks — what actually moves. */
  tasks: TaskDto[];
  onPick: (target: RoadmapSprint | null) => void;
}

/**
 * The move targets for one backlog item: next, previous, then every joinable
 * window, then "No cycle".
 *
 * Rows that cannot succeed are **disabled rather than hidden**, matching the
 * banner's `‹ ›` (which stay put and grey out at the ends of the range): a menu
 * whose shape shifts per card can't be learned. Completed windows are the one
 * exception — they're omitted entirely, since the API would reject every one of
 * them and an endless list of dead history helps nobody.
 *
 * Flat, so the two surfaces that offer this share exactly one list: the board
 * card's right-click menu nests them under "Move to cycle ▸" (see
 * {@link sprintMoveMenu}), while the item detail's sprint row offers them
 * directly as its own dropdown.
 */
export function sprintMoveRows({
  itemSprints,
  sprints,
  tasks,
  onPick,
}: SprintMoveMenuArgs): MenuItem[] {
  // Chronological is the order you reason about "next" and "previous" in.
  const byDate = [...sprints].reverse();
  const targets = byDate.filter(joinable);

  const newest = itemSprints[itemSprints.length - 1];
  const oldest = itemSprints[0];
  const active = byDate.find((s) => s.status === CycleStatus.ACTIVE);

  // Anchor for "next": the far end of the item's span, or — for an item nobody
  // has scheduled — today, so "next" means the next one coming up rather than
  // the oldest cycle on record.
  const anchor = newest ?? active;
  const next = anchor
    ? targets.find((s) => s.startDate > anchor.startDate)
    : targets[0];
  // "Previous" only exists relative to a span, and only back as far as the
  // current cycle — earlier windows are closed history the API won't take.
  const prev = oldest
    ? [...targets].reverse().find((s) => s.startDate < oldest.startDate)
    : undefined;

  const has = (s: RoadmapSprint) => itemSprints.some((x) => x.key === s.key);

  /**
   * What picking this target would actually do, straight from the plan — the menu
   * and the write can't disagree because they read the same function.
   *
   * The two ways a row can be dead are **opposite** and must not look alike:
   * nothing to do (the item is already entirely here) versus nothing possible
   * (no team of this item runs a cycle in that window). `writes.length === 0`
   * alone can't tell them apart; `stuck` can.
   */
  const stateOf = (target: RoadmapSprint | null) => {
    const { writes, stuck } = planSprintMove(tasks, target);
    if (writes.length === 0) return stuck.length > 0 ? ('impossible' as const) : ('settled' as const);
    return target && has(target) ? ('partial' as const) : ('open' as const);
  };

  const row = (
    target: RoadmapSprint | null,
    label: string,
    icon: MenuItem['icon'],
    state = stateOf(target),
  ): MenuItem => ({
    label,
    icon,
    closeOnSelect: true,
    disabled: state === 'settled' || state === 'impossible',
    onClick: () => onPick(target),
  });

  const step = (
    target: RoadmapSprint | undefined,
    key: 'cycles.nextCycle' | 'cycles.prevCycle',
    icon: MenuItem['icon'],
  ): MenuItem =>
    target
      // Naming the destination turns a guess into a decision.
      ? row(target, `${t(key)} · ${target.name}`, icon)
      : { label: t(key), icon, disabled: true };

  const items: MenuItem[] = [
    step(next, 'cycles.nextCycle', <ArrowRight className="size-4" />),
    step(prev, 'cycles.prevCycle', <ArrowLeft className="size-4" />),
  ];

  if (targets.length > 0) {
    items.push({ label: '', separator: true });
    for (const s of targets) {
      const suffix =
        s.status === CycleStatus.ACTIVE ? ` · ${t('cycles.current')}` : ` · ${t('cycles.upcoming')}`;
      const state = stateOf(s);
      // Tri-state, and the tick is the strict one: ✓ means "this item is entirely
      // here, picking it changes nothing", so **at most one row can carry it** —
      // an item spanning three cycles has no single sprint and gets no ✓ at all.
      // (Ticking every window it touched read as a bug, and fairly: a ✓ in a menu
      // means "the current one".) `−` is the usual indeterminate glyph: some of
      // the work is here, and picking it consolidates the rest. Every row keeps a
      // glyph slot either way so the labels stay in one column.
      const icon =
        state === 'settled' ? (
          <Check className="size-4" />
        ) : state === 'partial' ? (
          <Minus className="size-4" />
        ) : (
          <span />
        );
      items.push(row(s, `${s.label}${suffix}`, icon, state));
    }
  }

  items.push({ label: '', separator: true });
  items.push(row(null, t('cycles.noCycle'), <CircleSlash className="size-4" />));

  return items;
}

/** {@link sprintMoveRows} folded into one "Move to cycle ▸" parent, for a menu
 *  that also carries unrelated actions (the board card's right-click menu). */
export function sprintMoveMenu(args: SprintMoveMenuArgs): MenuItem {
  return {
    label: t('bulk.moveToCycle'),
    // No linked task means there is no commitment to move — the whole submenu
    // would be dead rows, so say it once on the parent instead.
    disabled: args.tasks.length === 0,
    children: sprintMoveRows(args),
  };
}
