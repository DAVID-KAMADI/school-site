import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsObject,
  IsOptional,
  IsString,
  Length,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { PageTemplate, PageVisibility } from '../entities/page.entity.js';

export class CreatePageDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @MaxLength(150) slug?: string;
  @IsOptional() @IsInt() parentId?: number | null;
  @IsOptional() @IsEnum(PageTemplate) template?: PageTemplate;
  @IsOptional() @IsEnum(PageVisibility) visibility?: PageVisibility;
}

export class BlockDto {
  @IsString() @MaxLength(50) type: string;
  @IsOptional() @IsBoolean() isHidden?: boolean;
  /** Validated per block type by the block schemas. */
  @IsObject() content: Record<string, unknown>;
}

export class SaveContentDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsEnum(PageTemplate) template?: PageTemplate;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(300) metaDescription?: string | null;
  @IsOptional() @IsInt() socialImageId?: number | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks: BlockDto[];
  @IsOptional() @IsString() @MaxLength(255) note?: string;
}

export class SaveTranslationDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @MaxLength(200) seoTitle?: string | null;
  @IsOptional() @IsString() @MaxLength(300) metaDescription?: string | null;
  @IsArray()
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => BlockDto)
  blocks: BlockDto[];
}

export class PageSettingsDto {
  @IsOptional() @IsString() @MaxLength(150) slug?: string;
  @IsOptional() @IsInt() parentId?: number | null;
  @IsOptional() @IsEnum(PageVisibility) visibility?: PageVisibility;
  @IsOptional() @Type(() => Date) @IsDate() publishAt?: Date | null;
  @IsOptional() @Type(() => Date) @IsDate() unpublishAt?: Date | null;
}

export class PreviewLinkDto {
  @IsOptional() @IsInt() @Min(1) @Max(24 * 14) hours?: number;
}
