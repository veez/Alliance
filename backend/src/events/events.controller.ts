import { Body, Controller, Get, HttpCode, Injectable, Logger, OnModuleDestroy, OnModuleInit, Param, ParseUUIDPipe, Patch, Post, Put, Query, StreamableFile } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { P } from '../access/permissions';
import { AuthUser, RequestMeta } from '../common/auth-user';
import { CurrentUser, ReqMeta, RequirePermissions } from '../common/decorators';
import { env } from '../config/env';
import { AttendanceDto, CreateEventDto, EventListQuery, RegistrationDto, StatsQuery, UpdateEventDto } from './events.dto';
import { EventsService } from './events.service';

@ApiTags('Мероприятия')
@ApiBearerAuth()
@Controller('events')
export class EventsController {
  constructor(private readonly events: EventsService) {}

  @Get()
  @ApiOperation({ summary: 'Календарь мероприятий' })
  list(@Query() q: EventListQuery, @CurrentUser() u: AuthUser) {
    return this.events.list(q, u);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Посещаемость и рейтинг активности членов Альянса за год' })
  stats(@Query() q: StatsQuery, @CurrentUser() u: AuthUser) {
    return this.events.stats(q.year, u);
  }

  @Get(':id')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    return this.events.get(id, u);
  }

  @Post()
  @RequirePermissions(P.EVENTS_MANAGE)
  create(@Body() dto: CreateEventDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.events.create(dto, u, meta);
  }

  @Patch(':id')
  @RequirePermissions(P.EVENTS_MANAGE)
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateEventDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.events.update(id, dto, u, meta);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  @RequirePermissions(P.EVENTS_MANAGE)
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.events.cancel(id, u, meta);
  }

  @Post(':id/registration')
  @HttpCode(200)
  @ApiOperation({ summary: 'Подтвердить участие (очно/онлайн) или отказаться' })
  register(@Param('id', ParseUUIDPipe) id: string, @Body() dto: RegistrationDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.events.register(id, dto.registration, u, meta);
  }

  @Put(':id/attendance')
  @RequirePermissions(P.EVENTS_MANAGE)
  @ApiOperation({ summary: 'Отметить фактическое присутствие (мероприятие становится «состоялось»)' })
  attendance(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AttendanceDto, @CurrentUser() u: AuthUser, @ReqMeta() meta: RequestMeta) {
    return this.events.markAttendance(id, dto, u, meta);
  }

  @Get(':id/ics')
  @ApiOperation({ summary: 'Файл для календаря (iCalendar)' })
  async ics(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const { name, content } = await this.events.ics(id, u);
    return new StreamableFile(Buffer.from(content, 'utf8'), { type: 'text/calendar; charset=utf-8', disposition: `attachment; filename="${name}"` });
  }
}

/** Каждые 15 минут: напоминания о мероприятиях, начинающихся в ближайшие сутки. */
@Injectable()
export class EventsScheduler implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger('EventsScheduler');
  private timer: NodeJS.Timeout | null = null;

  constructor(private readonly events: EventsService) {}

  onModuleInit() {
    if (env.isTest) return;
    this.timer = setInterval(() => void this.tick(), 15 * 60_000);
    setTimeout(() => void this.tick(), 20_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  async tick() {
    try {
      const sent = await this.events.sendReminders();
      if (sent) this.logger.log(`Напоминаний о мероприятиях: ${sent}`);
    } catch (e) {
      this.logger.error(String(e));
    }
  }
}
