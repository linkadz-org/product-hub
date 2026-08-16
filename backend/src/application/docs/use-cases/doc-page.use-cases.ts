import { Inject, Injectable } from '@nestjs/common';
import { IUsecaseExecute } from '@core/interfaces';
import { Result } from '@shared/logic/result';
import { ICommentRepository } from '@application/activity/repositories/comment.repository';
import { RecordActivityUseCase } from '@application/audit-log/use-cases';
import { AuditActor, AuditEntity } from '@application/audit-log/domain/enums/audit.enums';
import { CreateDocPageDto, ReorderDocPagesDto, UpdateDocPageDto } from '../dtos/doc.dtos';
import { DocPageEntity } from '../domain/entities/doc-page.entity';
import { IDocRepository } from '../repositories/doc.repository';
import { IDocPageRepository } from '../repositories/doc-page.repository';
import { IDocPageVersionRepository } from '../repositories/doc-page-version.repository';
import { diffDocPage, snapshotDocPage } from '../domain/doc-page-diff';

/**
 * A page plus the doc it lives in — the linked-docs list needs the doc's title
 * to label the row and its ref to build the link, since a doc's URL is addressed
 * by ref rather than id.
 */
export interface LinkedDocPage {
  page: DocPageEntity;
  docTitle: string;
  docRef: string;
}

interface Author {
  userId: string;
  name: string;
}

/** Ids of `pageId` and everything nested under it, at any depth. */
function withDescendants(pages: DocPageEntity[], pageId: string): string[] {
  const byParent = new Map<string, DocPageEntity[]>();
  for (const p of pages) {
    const siblings = byParent.get(p.parentId) ?? [];
    siblings.push(p);
    byParent.set(p.parentId, siblings);
  }
  const ids: string[] = [];
  const walk = (id: string) => {
    ids.push(id);
    for (const child of byParent.get(id) ?? []) walk(child.id.toString());
  };
  walk(pageId);
  return ids;
}

@Injectable()
export class CreateDocPageUseCase
  implements
    IUsecaseExecute<
      {
        docId: string;
        tenantId: string;
        author: Author;
        /** Defaults to USER. MCP passes API so a bot is distinguishable from a person. */
        actorType?: AuditActor;
        dto: CreateDocPageDto;
      },
      Result<DocPageEntity>
    >
{
  constructor(
    @Inject(IDocRepository) private readonly docs: IDocRepository,
    @Inject(IDocPageRepository) private readonly pages: IDocPageRepository,
    private readonly activity: RecordActivityUseCase,
  ) {}

  async execute({
    docId,
    tenantId,
    author,
    actorType,
    dto,
  }: {
    docId: string;
    tenantId: string;
    author: Author;
    actorType?: AuditActor;
    dto: CreateDocPageDto;
  }): Promise<Result<DocPageEntity>> {
    const doc = await this.docs.findById(docId);
    if (!doc || doc.tenantId !== tenantId) return Result.fail('Doc not found');

    const existing = await this.pages.findByDoc(docId);
    const parentId = dto.parentId || '';
    // Nesting under a page from another doc would strand the new page.
    if (parentId && !existing.some((p) => p.id.toString() === parentId)) {
      return Result.fail('Parent page not found');
    }
    // Land last among its siblings, which is where the click happened.
    const lastOrder = existing
      .filter((p) => p.parentId === parentId)
      .reduce((max, p) => Math.max(max, p.order), -1);

    const created = DocPageEntity.create({
      tenantId,
      docId,
      parentId,
      title: dto.title?.trim() || 'Untitled',
      content: dto.content ?? '',
      order: lastOrder + 1,
      createdBy: author.userId,
      updatedBy: author.userId,
      updatedByName: author.name,
    });
    if (created.isFailure) return Result.fail(created.error as string);
    const page = created.getValue();
    await this.pages.save(page);
    // The hub sorts by activity, so adding a page counts as touching the doc.
    doc.touch();
    await this.docs.update(doc);

    await this.activity.execute({
      tenantId,
      entity: AuditEntity.DOC_PAGE,
      entityId: page.id.toString(),
      entityRef: page.title,
      actor: { type: actorType ?? AuditActor.USER, id: author.userId, name: author.name },
      changes: [{ field: 'created', oldValue: '', newValue: '' }],
    });

    return Result.ok(page);
  }
}

@Injectable()
export class GetDocPageUseCase
  implements
    IUsecaseExecute<{ docId: string; pageId: string; tenantId: string }, Result<DocPageEntity>>
{
  constructor(@Inject(IDocPageRepository) private readonly pages: IDocPageRepository) {}

  async execute({
    docId,
    pageId,
    tenantId,
  }: {
    docId: string;
    pageId: string;
    tenantId: string;
  }): Promise<Result<DocPageEntity>> {
    const page = await this.pages.findById(pageId);
    if (!page || page.tenantId !== tenantId || page.docId !== docId) {
      return Result.fail('Page not found');
    }
    return Result.ok(page);
  }
}

@Injectable()
export class UpdateDocPageUseCase
  implements
    IUsecaseExecute<
      {
        docId: string;
        pageId: string;
        tenantId: string;
        author: Author;
        /** Defaults to USER. MCP passes API so a bot is distinguishable from a person. */
        actorType?: AuditActor;
        dto: UpdateDocPageDto;
      },
      Result<DocPageEntity>
    >
{
  constructor(
    @Inject(IDocRepository) private readonly docs: IDocRepository,
    @Inject(IDocPageRepository) private readonly pages: IDocPageRepository,
    private readonly activity: RecordActivityUseCase,
  ) {}

  async execute({
    docId,
    pageId,
    tenantId,
    author,
    actorType,
    dto,
  }: {
    docId: string;
    pageId: string;
    tenantId: string;
    author: Author;
    actorType?: AuditActor;
    dto: UpdateDocPageDto;
  }): Promise<Result<DocPageEntity>> {
    const page = await this.pages.findById(pageId);
    if (!page || page.tenantId !== tenantId || page.docId !== docId) {
      return Result.fail('Page not found');
    }

    // Before ANY mutation — applyEdit below mutates the entity in place, so a
    // snapshot taken afterwards would diff the entity against itself.
    const before = snapshotDocPage(page);

    page.applyEdit(
      {
        title: dto.title,
        icon: dto.icon,
        color: dto.color,
        coverUrl: dto.coverUrl,
        content: dto.content,
        links: dto.links,
        attachments: dto.attachments,
        style: {
          fontStyle: dto.fontStyle,
          fontSize: dto.fontSize,
          pageWidth: dto.pageWidth,
          showCover: dto.showCover,
          showTitle: dto.showTitle,
          showUpdated: dto.showUpdated,
          showLinks: dto.showLinks,
          showAttachments: dto.showAttachments,
        },
      },
      author,
    );
    await this.pages.update(page);

    const doc = await this.docs.findById(docId);
    if (doc) {
      doc.touch();
      await this.docs.update(doc);
    }

    // `content` is deliberately not a tracked field — see doc-page-diff.ts. Only
    // structural fields (title today) ever reach the log from this route.
    await this.activity.execute({
      tenantId,
      entity: AuditEntity.DOC_PAGE,
      entityId: page.id.toString(),
      entityRef: page.title,
      actor: { type: actorType ?? AuditActor.USER, id: author.userId, name: author.name },
      changes: diffDocPage(before, page),
    });

    return Result.ok(page);
  }
}

@Injectable()
export class DeleteDocPageUseCase
  implements
    IUsecaseExecute<
      {
        docId: string;
        pageId: string;
        tenantId: string;
        author: Author;
        /** Defaults to USER. MCP passes API so a bot is distinguishable from a person. */
        actorType?: AuditActor;
      },
      Result<string[]>
    >
{
  constructor(
    @Inject(IDocRepository) private readonly docs: IDocRepository,
    @Inject(IDocPageRepository) private readonly pages: IDocPageRepository,
    @Inject(IDocPageVersionRepository) private readonly versions: IDocPageVersionRepository,
    @Inject(ICommentRepository) private readonly comments: ICommentRepository,
    private readonly activity: RecordActivityUseCase,
  ) {}

  /** Resolves to the ids that were removed — the page and everything under it. */
  async execute({
    docId,
    pageId,
    tenantId,
    author,
    actorType,
  }: {
    docId: string;
    pageId: string;
    tenantId: string;
    author: Author;
    actorType?: AuditActor;
  }): Promise<Result<string[]>> {
    const doc = await this.docs.findById(docId);
    if (!doc || doc.tenantId !== tenantId) return Result.fail('Doc not found');
    const all = await this.pages.findByDoc(docId);
    const target = all.find((p) => p.id.toString() === pageId);
    if (!target) return Result.fail('Page not found');
    // Captured before the delete — the entity is gone afterwards, but the row
    // has to outlive it.
    const deletedRef = target.title;

    // A sub-page has no meaning without its parent, so the branch goes together.
    const ids = withDescendants(all, pageId);
    await this.pages.deleteMany(ids);
    // History follows its page — a version of a page that no longer exists is
    // unreachable by any route, so it would just accumulate.
    await this.versions.deleteByPages(ids);
    // So do its comment threads: they're anchored to text that no longer exists.
    await this.comments.deleteByDocPages(tenantId, ids);
    doc.touch();
    await this.docs.update(doc);

    // One row for the page the caller acted on — deleted descendants are a
    // consequence of that action, not a thing anybody chose separately, and
    // they no longer have a readable history stream to append to anyway.
    await this.activity.execute({
      tenantId,
      entity: AuditEntity.DOC_PAGE,
      entityId: pageId,
      entityRef: deletedRef,
      actor: { type: actorType ?? AuditActor.USER, id: author.userId, name: author.name },
      changes: [{ field: 'deleted', oldValue: '', newValue: '' }],
    });

    return Result.ok(ids);
  }
}

@Injectable()
export class ReorderDocPagesUseCase
  implements
    IUsecaseExecute<
      {
        docId: string;
        tenantId: string;
        author: Author;
        /** Defaults to USER. MCP passes API so a bot is distinguishable from a person. */
        actorType?: AuditActor;
        dto: ReorderDocPagesDto;
      },
      Result<DocPageEntity[]>
    >
{
  constructor(
    @Inject(IDocRepository) private readonly docs: IDocRepository,
    @Inject(IDocPageRepository) private readonly pages: IDocPageRepository,
    private readonly activity: RecordActivityUseCase,
  ) {}

  async execute({
    docId,
    tenantId,
    author,
    actorType,
    dto,
  }: {
    docId: string;
    tenantId: string;
    author: Author;
    actorType?: AuditActor;
    dto: ReorderDocPagesDto;
  }): Promise<Result<DocPageEntity[]>> {
    const doc = await this.docs.findById(docId);
    if (!doc || doc.tenantId !== tenantId) return Result.fail('Doc not found');

    const all = await this.pages.findByDoc(docId);
    const byId = new Map(all.map((p) => [p.id.toString(), p]));
    for (const pos of dto.pages) {
      if (!byId.has(pos.id)) return Result.fail('Page not found');
      if (pos.parentId && !byId.has(pos.parentId)) return Result.fail('Parent page not found');
    }

    // Walk the *proposed* tree: dropping a page onto its own descendant would
    // detach that whole branch from the doc, and it would never render again.
    const nextParent = new Map<string, string>(
      all.map((p) => [p.id.toString(), p.parentId] as const),
    );
    for (const pos of dto.pages) nextParent.set(pos.id, pos.parentId || '');
    for (const pos of dto.pages) {
      let cursor = pos.parentId || '';
      const seen = new Set<string>();
      while (cursor) {
        if (cursor === pos.id) return Result.fail('A page cannot be nested inside itself');
        if (seen.has(cursor)) break; // pre-existing cycle: don't spin on it
        seen.add(cursor);
        cursor = nextParent.get(cursor) ?? '';
      }
    }

    const moved: DocPageEntity[] = [];
    // Snapshot every page BEFORE moveTo mutates it in place — same trap as
    // UpdateDocPageUseCase above.
    const before = new Map(
      dto.pages.map((pos) => [pos.id, snapshotDocPage(byId.get(pos.id) as DocPageEntity)]),
    );
    for (const pos of dto.pages) {
      const page = byId.get(pos.id) as DocPageEntity;
      page.moveTo(pos.parentId || '', pos.order);
      moved.push(page);
    }
    await this.pages.updateMany(moved);
    doc.touch();
    await this.docs.update(doc);

    for (const page of moved) {
      const snapshot = before.get(page.id.toString());
      if (!snapshot) continue;
      const changes = diffDocPage(snapshot, page);
      if (!changes.length) continue;
      await this.activity.execute({
        tenantId,
        entity: AuditEntity.DOC_PAGE,
        entityId: page.id.toString(),
        entityRef: page.title,
        actor: { type: actorType ?? AuditActor.USER, id: author.userId, name: author.name },
        changes,
      });
    }

    return Result.ok(await this.pages.findByDoc(docId));
  }
}

/** Every doc page attached to one record (an issue or a roadmap item). */
@Injectable()
export class GetLinkedDocPagesUseCase
  implements IUsecaseExecute<{ tenantId: string; refId: string }, Result<LinkedDocPage[]>>
{
  constructor(
    @Inject(IDocRepository) private readonly docs: IDocRepository,
    @Inject(IDocPageRepository) private readonly pages: IDocPageRepository,
  ) {}

  async execute({
    tenantId,
    refId,
  }: {
    tenantId: string;
    refId: string;
  }): Promise<Result<LinkedDocPage[]>> {
    const pages = await this.pages.findByLinkRef(tenantId, refId);
    if (!pages.length) return Result.ok([]);
    // One lookup per doc, not per page — a record usually links pages of the
    // same doc, and a tenant's doc list is small.
    const docs = new Map<string, { title: string; ref: string }>();
    for (const docId of new Set(pages.map((p) => p.docId))) {
      const doc = await this.docs.findById(docId);
      if (doc && doc.tenantId === tenantId) docs.set(docId, { title: doc.title, ref: doc.ref });
    }
    return Result.ok(
      pages
        .filter((p) => docs.has(p.docId))
        .map((page) => {
          const doc = docs.get(page.docId) as { title: string; ref: string };
          return { page, docTitle: doc.title, docRef: doc.ref };
        }),
    );
  }
}
