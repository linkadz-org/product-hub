import { Schema } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { CycleMode, TeamIssueType, TeamStatusConfig } from '@application/teams/domain/enums/team.enums';
import { TaskLabelConfig } from '@application/tasks/domain/enums/task.enums';
import { CustomFieldConfig } from '@application/teams/domain/enums/custom-field.enums';
import { TEAM_ICONS } from '@application/teams/domain/enums/team-icons';

export interface TeamDoc {
  _id: string;
  tenantId: string;
  key: string;
  refPrefix?: string;
  name: string;
  issueType: TeamIssueType;
  icon?: string;
  color?: string | null;
  statuses?: TeamStatusConfig[];
  labels?: TaskLabelConfig[];
  customFields?: CustomFieldConfig[];
  cyclesEnabled?: boolean;
  cycleMode?: string;
  cycleLengthWeeks?: number;
  cycleCooldownWeeks?: number;
  cycleStartDay?: number;
  cycleStartDate?: string | null;
  cycleAutoRollover?: boolean;
  archived: boolean;
  order: number;
  publicEnabled: boolean;
  publicToken: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const TeamSchema = new Schema<TeamDoc>(
  {
    _id: { type: String, default: () => uuid() },
    tenantId: { type: String, required: true, index: true },
    key: { type: String, required: true },
    // Optional: teams stored before ticket prefixes existed have none, and mint
    // falls back to the kind's sequence until the backfill assigns one. Unique
    // per tenant *including archived teams* — a prefix is never released, so a
    // ref minted under it can never be minted again.
    refPrefix: { type: String },
    name: { type: String, required: true, maxlength: 60 },
    issueType: { type: String, enum: Object.values(TeamIssueType), required: true },
    // Optional: pre-existing teams resolve their icon from issueType in the entity.
    icon: { type: String, enum: TEAM_ICONS },
    color: { type: String, default: null },
    // Optional: teams stored before per-team statuses resolve defaults in the entity.
    statuses: {
      type: [{ _id: false, key: String, label: String, color: String }],
      default: undefined,
    },
    // Item labels shared by the team's tasks/bugs. No built-ins — empty is valid.
    labels: {
      type: [{ _id: false, key: String, name: String, color: String }],
      default: undefined,
    },
    // Custom fields shared by the team's tasks/bugs. No built-ins — empty is valid.
    // Stored as Mixed rather than a typed subdoc because the fields include the
    // Mongoose-reserved keys `type` and `required`; the domain `setCustomFields`
    // guard is the shape authority, so we persist the validated array as-is.
    customFields: {
      type: [Schema.Types.Mixed],
      default: undefined,
    } as unknown as CustomFieldConfig[],
    // Cycle rhythm (features/cycles.md). Optional: pre-cycles teams resolve the
    // defaults in the entity, exactly like `icon`.
    cyclesEnabled: { type: Boolean, default: false },
    // Absent = 'auto': every team that existed before manual mode ran the rhythm.
    cycleMode: { type: String, default: CycleMode.AUTO },
    cycleLengthWeeks: { type: Number, default: 2 },
    cycleCooldownWeeks: { type: Number, default: 0 },
    cycleStartDay: { type: Number, default: 1 },
    cycleStartDate: { type: String, default: null },
    cycleAutoRollover: { type: Boolean, default: true },
    archived: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
    publicEnabled: { type: Boolean, default: false },
    publicToken: { type: String, default: null },
  },
  { timestamps: true },
);

// A team's key is its stable per-tenant identity.
TeamSchema.index({ tenantId: 1, key: 1 }, { unique: true });

TeamSchema.index(
  { tenantId: 1, refPrefix: 1 },
  { unique: true, partialFilterExpression: { refPrefix: { $type: 'string' } } },
);
