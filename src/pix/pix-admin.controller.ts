import { Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeadLetterDto } from './dto/pix.dto';
import { PixDeadLetterService } from './pix-dead-letter.service';

@ApiTags('admin')
@Controller('admin/pix')
export class PixAdminController {
  constructor(private readonly deadLetters: PixDeadLetterService) {}

  @Get('dead-letters')
  @ApiOperation({ summary: 'Lista os depósitos que esgotaram as tentativas (DLQ)' })
  @ApiOkResponse({ type: [DeadLetterDto] })
  list(): Promise<DeadLetterDto[]> {
    return this.deadLetters.list();
  }

  @Post('events/:eventId/reprocess')
  @HttpCode(202)
  @ApiOperation({ summary: 'Reenfileira um evento FAILED (depois de corrigir a causa)' })
  async reprocess(@Param('eventId', ParseUUIDPipe) eventId: string): Promise<{ eventId: string; status: string }> {
    await this.deadLetters.reprocess(eventId);
    return { eventId, status: 'RECEIVED' };
  }
}
