import { Controller, Delete, Get, Inject, Param, Patch, Post, Query, Res, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiTags } from '@nestjs/swagger';
import type { Response } from 'express';
import { AuthGuard } from '../../common/auth/auth.guard';
import { CurrentUser } from '../../common/auth/current-user';
import { ZodBody } from '../../common/pipes/zod-validation.pipe';
import { WildlifeArchiveService } from './archive.service';
import { animalSchema, animalUpdateSchema, listSchema, sightingSchema, sightingUpdateSchema } from './domain/archive.schemas';
import type { AnimalInput, AnimalUpdate, SightingInput, SightingUpdate } from './domain/archive.schemas';

@ApiTags('wildlife · 野生居民档案')
@Controller('wildlife')
export class WildlifeArchiveController {
  constructor(@Inject(WildlifeArchiveService) private readonly service: WildlifeArchiveService) {}
  @Get('categories') categories() { return this.service.categories(); }
  @Get(['sightings', 'items']) sightings(@Query() q: Record<string, unknown>) { return this.service.listSightings(listSchema.parse(q)); }
  @Get(['sightings/:id', 'items/:id']) sighting(@Param('id') id: string) { return this.service.sighting(id); }
  @Post(['sightings', 'items']) @UseGuards(AuthGuard)
  createSighting(@CurrentUser() actor: string, @ZodBody(sightingSchema) body: SightingInput) { return this.service.createSighting(body, actor); }
  @Patch(['sightings/:id', 'items/:id']) @UseGuards(AuthGuard)
  updateSighting(@Param('id') id: string, @CurrentUser() actor: string, @ZodBody(sightingUpdateSchema) body: SightingUpdate) { return this.service.updateSighting(id, body, actor); }
  @Delete(['sightings/:id', 'items/:id']) @UseGuards(AuthGuard)
  removeSighting(@Param('id') id: string, @CurrentUser() actor: string) { return this.service.removeSighting(id, actor); }
  @Get('animals') animals(@Query() q: Record<string, unknown>) { return this.service.listAnimals(listSchema.parse(q)); }
  @Get('animals/:id') animal(@Param('id') id: string) { return this.service.animal(id); }
  @Get('animals/:id/sightings') async footprints(@Param('id') id: string, @Query() q: Record<string, unknown>) {
    await this.service.animal(id); return this.service.listSightings(listSchema.parse({ ...q, animalId: id }));
  }
  @Post('animals') @UseGuards(AuthGuard)
  createAnimal(@CurrentUser() actor: string, @ZodBody(animalSchema) body: AnimalInput) { return this.service.createAnimal(body, actor); }
  @Patch('animals/:id') @UseGuards(AuthGuard)
  updateAnimal(@Param('id') id: string, @CurrentUser() actor: string, @ZodBody(animalUpdateSchema) body: AnimalUpdate) { return this.service.updateAnimal(id, body, actor); }
  @Post('photos') @UseGuards(AuthGuard)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: 8 * 1024 * 1024, files: 1 } }))
  upload(@UploadedFile() file: { buffer: Buffer; mimetype: string; size: number } | undefined, @CurrentUser() actor: string) { return this.service.upload(file, actor); }
  @Get('photos/:id') async image(@Param('id') id: string, @Res() response: Response) {
    const filename = await this.service.photoFile(id);
    response.set({ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'public, max-age=86400' });
    response.type('image/jpeg').sendFile(filename);
  }
}
