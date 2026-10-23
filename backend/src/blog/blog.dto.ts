import {
  IsInt,
  IsOptional,
  IsString,
  Length,
  MaxLength,
  Min,
} from 'class-validator';

export class CreateBlogPostDto {
  @IsString() @Length(1, 200) title: string;
}

export class UpdateBlogPostDto {
  @IsString() @Length(1, 200) title: string;
  @IsOptional() @IsString() @MaxLength(180) slug?: string;
  @IsOptional() @IsString() @MaxLength(500) excerpt?: string;
  @IsString() @MaxLength(200_000) content: string;
  @IsOptional() @IsInt() @Min(1) coverImageId?: number | null;
}
