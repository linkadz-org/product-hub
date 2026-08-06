import { Schema } from 'mongoose';
import { v4 as uuid } from 'uuid';
import { TenantStatus } from '@application/tenants/domain/entities/tenant.props';

export interface TenantDoc {
  _id: string;
  name: string;
  slug?: string | null;
  status?: string;
  contactEmail?: string | null;
  notes?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const TenantSchema = new Schema<TenantDoc>(
  {
    _id: { type: String, default: () => uuid() },
    name: { type: String, required: true, maxlength: 120 },
    // Added when the platform console arrived. Every field below is optional so
    // tenants created before it read back unchanged — `status` falls back to
    // active in the entity factory.
    slug: { type: String, default: null, maxlength: 60 },
    status: {
      type: String,
      enum: Object.values(TenantStatus),
      default: TenantStatus.ACTIVE,
    },
    contactEmail: { type: String, default: null, maxlength: 200 },
    notes: { type: String, default: null, maxlength: 2000 },
  },
  { timestamps: true },
);

// PARTIAL, **not sparse** — do not "simplify" this back.
//
// Most tenants have no slug and any number of them must coexist. `sparse` only
// excludes documents where the field is *absent*; a document holding an explicit
// `null` is still indexed. `slug` above declares `default: null`, so every tenant
// written through this schema stores an explicit null, all of them land in the
// unique index, and the second slug-less tenant is rejected with
// `E11000 … index: slug_1 dup key: { slug: null }` — observed in production, on
// both `RegisterUseCase` (never sends a slug) and the platform console (slug
// optional). `partialFilterExpression` indexes only real string slugs, so
// slug-less tenants never enter the index at all while real slugs stay unique.
// Same pattern as `{tenantId, refPrefix}` in team.schema.ts.
//
// Mongoose will NOT redefine an index that already exists: a database that still
// carries the old `slug_1` keeps the broken definition until it is dropped. See
// `scripts/drop-tenant-slug-index.ts` (`npm run migrate:tenant-slug-index`).
TenantSchema.index(
  { slug: 1 },
  { unique: true, partialFilterExpression: { slug: { $type: 'string' } } },
);
TenantSchema.index({ status: 1, createdAt: -1 });
