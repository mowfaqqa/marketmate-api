import { IsIn, IsUUID } from 'class-validator';

export class GraphicInput {
  @IsUUID() draftId!: string;
  @IsIn(['spotlight', 'offer', 'service']) layout!: 'spotlight' | 'offer' | 'service';
  @IsIn(['square', 'story']) format!: 'square' | 'story';
}
