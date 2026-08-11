import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UniqueEntityID } from '@core/domain';
import { BaseRepository } from '@core/infrastructure/database/mongoose/base';
import {
  IRoadmapRepository,
  RoadmapItemLocation,
} from '@application/roadmaps/repositories/roadmap.repository';
import { RoadmapEntity } from '@application/roadmaps/domain/entities/roadmap.entity';
import { buildSearchText } from '@module-shared/utils/search-text.util';
import { RoadmapDoc } from '../entities/roadmap.schema';

@Injectable()
export class RoadmapRepository
  extends BaseRepository<RoadmapEntity, RoadmapDoc>
  implements IRoadmapRepository
{
  constructor(@InjectModel('Roadmap') model: Model<RoadmapDoc>) {
    super(model);
  }

  toDomain(doc: RoadmapDoc): RoadmapEntity {
    const result = RoadmapEntity.create(
      {
        tenantId: doc.tenantId,
        projectId: doc.projectId,
        title: doc.title,
        description: doc.description,
        items: doc.items ?? [],
        columns: doc.columns ?? [],
        publicEnabled: doc.publicEnabled ?? false,
        publicToken: doc.publicToken ?? null,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
      new UniqueEntityID(doc._id),
    );
    if (result.isFailure) throw new Error(result.error as string);
    return result.getValue();
  }

  toDocument(roadmap: RoadmapEntity): Partial<RoadmapDoc> {
    return {
      _id: roadmap.id.toString(),
      tenantId: roadmap.tenantId,
      projectId: roadmap.projectId,
      title: roadmap.title,
      description: roadmap.description,
      items: roadmap.items,
      columns: roadmap.columns,
      publicEnabled: roadmap.publicEnabled,
      publicToken: roadmap.publicToken,
      createdAt: roadmap.createdAt,
      updatedAt: roadmap.updatedAt,
      searchText: buildSearchText(roadmap.title, roadmap.description),
      itemsSearchText: roadmap.items.map((i) => buildSearchText(i.title, i.shortId)),
    };
  }

  async findById(id: string): Promise<RoadmapEntity | null> {
    const doc = await this.model.findById(id).lean<RoadmapDoc>().exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findByPublicToken(token: string): Promise<RoadmapEntity | null> {
    const doc = await this.model
      .findOne({ publicToken: token, publicEnabled: true })
      .lean<RoadmapDoc>()
      .exec();
    return doc ? this.toDomain(doc) : null;
  }

  async findItemByRef(tenantId: string, ref: string): Promise<RoadmapItemLocation | null> {
    if (!ref) return null;
    // Only the items array comes back — a roadmap can hold hundreds of items with
    // long descriptions, and this read wants two ids from one of them.
    const doc = await this.model
      .findOne({ tenantId, 'items.shortId': ref })
      .select('items.id items.shortId')
      .lean<{ _id: string; items?: { id: string; shortId?: string }[] }>()
      .exec();
    const item = doc?.items?.find((i) => i.shortId === ref);
    return item ? { roadmapId: doc!._id, itemId: item.id } : null;
  }

  async findByTenant(tenantId: string): Promise<RoadmapEntity[]> {
    const docs = await this.model
      .find({ tenantId })
      .sort({ updatedAt: -1 })
      .lean<RoadmapDoc[]>()
      .exec();
    return docs.map((d) => this.toDomain(d));
  }

  async save(roadmap: RoadmapEntity): Promise<void> {
    const doc = this.toDocument(roadmap);
    await this.model
      .findByIdAndUpdate(doc._id, doc, { upsert: true, setDefaultsOnInsert: true, new: true })
      .exec();
  }

  async update(roadmap: RoadmapEntity): Promise<void> {
    await this.save(roadmap);
  }

  async delete(id: string): Promise<void> {
    await this.model.findByIdAndDelete(id).exec();
  }
}
