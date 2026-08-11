import { SavedViewEntity } from '../domain/entities/saved-view.entity';
import { SavedViewResponseDto } from '../dtos/saved-view.response.dto';

export class SavedViewMapper {
  static toDto(view: SavedViewEntity): SavedViewResponseDto {
    return {
      id: view.id.toString(),
      ownerId: view.ownerId,
      name: view.name,
      icon: view.icon,
      color: view.color,
      scope: view.scope,
      shared: view.shared,
      kind: view.query.kind,
      view: view.query.view,
      filters: view.query.filters,
      sort: view.query.sort,
      search: view.query.search,
      order: view.order,
      createdAt: view.createdAt,
      updatedAt: view.updatedAt,
    };
  }

  static toDtoArray(views: SavedViewEntity[]): SavedViewResponseDto[] {
    return views.map((v) => this.toDto(v));
  }
}
