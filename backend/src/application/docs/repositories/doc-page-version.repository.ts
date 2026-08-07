import { DocPageVersionEntity } from '../domain/entities/doc-page-version.entity';

/** Port for a page's saved versions. Append-only — there is no `update`. */
export abstract class IDocPageVersionRepository {
  findById: (id: string) => Promise<DocPageVersionEntity | null>;
  /** One page's history, newest first. */
  findByPage: (pageId: string) => Promise<DocPageVersionEntity[]>;
  save: (version: DocPageVersionEntity) => Promise<void>;
  /** Cascade for a deleted page — history without its page is unreachable. */
  deleteByPages: (pageIds: string[]) => Promise<void>;
  /** Cascade for a deleted doc. */
  deleteByDoc: (docId: string) => Promise<void>;
  /**
   * Keep only the newest `keep` versions of this page that carry `label`, and
   * drop the rest.
   *
   * Label-scoped on purpose: it exists for machine-made snapshots, which arrive
   * once per write and would otherwise pile up a full copy of the body each
   * time. Anything a person saved by hand carries a different label (usually
   * none) and is neither counted nor deleted.
   */
  pruneByPageAndLabel: (pageId: string, label: string, keep: number) => Promise<void>;
}
