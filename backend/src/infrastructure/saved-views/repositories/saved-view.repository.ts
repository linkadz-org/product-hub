import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { UniqueEntityID } from '@core/domain';
import { BaseRepository } from '@core/infrastructure/database/mongoose/base';
import { ISavedViewRepository } from '@application/saved-views/repositories/saved-view.repository';
import { SavedViewEntity } from '@application/saved-views/domain/entities/saved-view.entity';
import { SavedViewDoc } from '../entities/saved-view.schema';

@Injectable()
export class SavedViewRepository
  extends BaseRepository<SavedViewEntity, SavedViewDoc>
  implements ISavedViewRepository
{
  constructor(@InjectModel('SavedView') model: Model<SavedViewDoc>) {
    super(model);
  }

  toDomain(doc: SavedViewDoc): SavedViewEntity {
    const result = SavedViewEntity.create(
      {
        tenantId: doc.tenantId,
        ownerId: doc.ownerId,
        name: doc.name,
        icon: doc.icon,
        color: doc.color,
        scope: doc.scope,
        shared: doc.shared,
        schemaVersion: doc.schemaVersion,
        query: doc.query,
        order: doc.order,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
      new UniqueEntityID(doc._id),
    );
    if (result.isFailure) throw new Error(result.error as string);
    return result.getValue();
  }

  toDocument(view: SavedViewEntity): Partial<SavedViewDoc> {
    return {
      _id: view.id.toString(),
      tenantId: view.tenantId,
      ownerId: view.ownerId,
      name: view.name,
      icon: view.icon,
      color: view.color,
      scope: view.scope,
      shared: view.shared,
      schemaVersion: view.schemaVersion,
      query: view.query,
      order: view.order,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    };
  }

  async findVisible(tenantId: string, userId: string): Promise<SavedViewEntity[]> {
    const docs = await this.model
      .find({ tenantId, $or: [{ ownerId: userId }, { shared: true }] })
      .sort({ order: 1, createdAt: 1 })
      .lean<SavedViewDoc[]>()
      .exec();
    return docs.map((d) => this.toDomain(d));
  }

  async findById(tenantId: string, id: string): Promise<SavedViewEntity | null> {
    const doc = await this.model.findOne({ _id: id, tenantId }).lean<SavedViewDoc>().exec();
    return doc ? this.toDomain(doc) : null;
  }

  async countByOwner(tenantId: string, ownerId: string): Promise<number> {
    return this.model.countDocuments({ tenantId, ownerId }).exec();
  }

  async save(view: SavedViewEntity): Promise<void> {
    const doc = this.toDocument(view);
    await this.model
      .findOneAndUpdate({ _id: doc._id, tenantId: doc.tenantId }, doc, {
        upsert: true,
        setDefaultsOnInsert: true,
        new: true,
      })
      .exec();
  }

  async delete(tenantId: string, id: string): Promise<void> {
    await this.model.deleteOne({ _id: id, tenantId }).exec();
  }
}
