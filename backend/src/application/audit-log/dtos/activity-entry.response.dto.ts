import { ApiProperty } from '@nestjs/swagger';

/** One history row as returned to the client (flat). */
export class ActivityEntryDto {
  @ApiProperty() id: string;
  @ApiProperty() entity: string;
  @ApiProperty() entityId: string;
  @ApiProperty() entityRef: string;
  @ApiProperty() field: string;
  @ApiProperty() oldValue: string;
  @ApiProperty() newValue: string;
  @ApiProperty() actorType: string;
  @ApiProperty() actorId: string;
  @ApiProperty() actorName: string;
  @ApiProperty() automated: boolean;
  @ApiProperty() createdAt: Date;
  /** '' when the row belongs to the object being viewed. */
  @ApiProperty() relationLabel: string;
}
