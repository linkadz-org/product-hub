import { AggregateRoot, UniqueEntityID } from '@core/domain';
import { Result } from '@shared/logic/result';
import { Guard } from '@shared/logic/guard';
import {
  SAVED_VIEW_NAME_MAX,
  SAVED_VIEW_SCHEMA_VERSION,
  SavedViewQuery,
} from '../saved-view.types';

export interface SavedViewProps {
  id: UniqueEntityID;
  tenantId: string;
  ownerId: string;
  name: string;
  icon: string;
  color: string | null;
  scope: string;
  shared: boolean;
  schemaVersion: number;
  query: SavedViewQuery;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

export interface SavedViewCreateProps {
  tenantId: string;
  ownerId: string;
  name: string;
  icon?: string;
  color?: string | null;
  scope?: string;
  shared?: boolean;
  schemaVersion?: number;
  query: SavedViewQuery;
  order?: number;
  createdAt?: Date;
  updatedAt?: Date;
}

/** A user's saved combination of board kind, view, filters, sort and search. */
export class SavedViewEntity extends AggregateRoot<SavedViewProps> {
  private constructor(props: SavedViewProps, id?: UniqueEntityID) {
    super(props, id);
  }

  static create(props: SavedViewCreateProps, id?: UniqueEntityID): Result<SavedViewEntity> {
    const requiredGuard = Guard.againstNullOrUndefinedBulk([
      { argument: props.tenantId, argumentName: 'tenantId' },
      { argument: props.ownerId, argumentName: 'ownerId' },
      { argument: props.query, argumentName: 'query' },
    ]);
    if (!requiredGuard.succeeded) return Result.fail(requiredGuard.message);

    const nameGuard = Guard.againstEmptyString(props.name, 'name');
    if (!nameGuard.succeeded) return Result.fail(nameGuard.message);

    const trimmedName = props.name.trim();
    if (trimmedName.length > SAVED_VIEW_NAME_MAX) {
      return Result.fail(`name must be at most ${SAVED_VIEW_NAME_MAX} characters`);
    }

    const now = new Date();
    return Result.ok(
      new SavedViewEntity(
        {
          id: id || new UniqueEntityID(),
          tenantId: props.tenantId,
          ownerId: props.ownerId,
          name: trimmedName,
          icon: props.icon ?? '',
          color: props.color ?? null,
          scope: props.scope ?? 'issues',
          shared: props.shared ?? false,
          schemaVersion: props.schemaVersion ?? SAVED_VIEW_SCHEMA_VERSION,
          query: props.query,
          order: props.order ?? 0,
          createdAt: props.createdAt || now,
          updatedAt: props.updatedAt || now,
        },
        id,
      ),
    );
  }

  get id(): UniqueEntityID {
    return this._id;
  }
  get tenantId(): string {
    return this.props.tenantId;
  }
  get ownerId(): string {
    return this.props.ownerId;
  }
  get name(): string {
    return this.props.name;
  }
  get icon(): string {
    return this.props.icon;
  }
  get color(): string | null {
    return this.props.color;
  }
  get scope(): string {
    return this.props.scope;
  }
  get shared(): boolean {
    return this.props.shared;
  }
  get schemaVersion(): number {
    return this.props.schemaVersion;
  }
  get query(): SavedViewQuery {
    return this.props.query;
  }
  get order(): number {
    return this.props.order;
  }
  get createdAt(): Date {
    return this.props.createdAt;
  }
  get updatedAt(): Date {
    return this.props.updatedAt;
  }

  rename(name: string): Result<void> {
    const guard = Guard.againstEmptyString(name, 'name');
    if (!guard.succeeded) return Result.fail(guard.message);

    const trimmed = name.trim();
    if (trimmed.length > SAVED_VIEW_NAME_MAX) {
      return Result.fail(`name must be at most ${SAVED_VIEW_NAME_MAX} characters`);
    }

    this.props.name = trimmed;
    this.touch();
    return Result.ok();
  }

  setShared(shared: boolean): void {
    this.props.shared = shared;
    this.touch();
  }

  setQuery(query: SavedViewQuery): void {
    this.props.query = query;
    this.touch();
  }

  /** Position within the owner's own saved-view list (see `sortSavedViews`).
   *  Meaningless across owners — never compare one user's `order` to another's. */
  setOrder(order: number): void {
    this.props.order = order;
    this.touch();
  }

  private touch(): void {
    this.props.updatedAt = new Date();
  }
}
