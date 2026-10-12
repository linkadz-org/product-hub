/** Roadmap horizon columns (Now / Next / Later / Done). */
export enum RoadmapPhase {
  NOW = 'now',
  NEXT = 'next',
  LATER = 'later',
  DONE = 'done',
}
export const ROADMAP_PHASES: RoadmapPhase[] = [
  RoadmapPhase.NOW,
  RoadmapPhase.NEXT,
  RoadmapPhase.LATER,
  RoadmapPhase.DONE,
];

export enum RoadmapItemStatus {
  IDEA = 'idea',
  PLANNED = 'planned',
  IN_PROGRESS = 'in-progress',
  /** Paused — still wanted, deliberately not being worked on right now. Timelines
   *  grey it out and sink it to the bottom instead of charting it as live work. */
  ON_HOLD = 'on-hold',
  DONE = 'done',
}

export enum RoadmapDifficulty {
  EASY = 'easy',
  MEDIUM = 'medium',
  HARD = 'hard',
}
