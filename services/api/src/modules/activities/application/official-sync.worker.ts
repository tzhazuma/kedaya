import {
  Controller,
  Inject,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { ApiOperation, ApiTags } from "@nestjs/swagger";

import { AdminGuard } from "../../../common/auth/admin.guard";
import { OfficialSyncService } from "./official-sync.service";

@Injectable()
export class OfficialSyncWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(OfficialSyncWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(OfficialSyncService) private readonly service: OfficialSyncService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    if (this.config.get<string>("OFFICIAL_SYNC_ENABLED") !== "true") return;
    const configured = Number(
      this.config.get<string>("OFFICIAL_SYNC_INTERVAL_MS") ?? 900_000,
    );
    this.timer = setInterval(
      () => {
        void this.service.syncAll().catch((error: unknown) => {
          this.logger.warn(
            `公众号定时同步失败：${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
      Math.max(60_000, configured),
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

@ApiTags("activities · 公众号同步运维")
@Controller("activities/official")
@UseGuards(AdminGuard)
export class OfficialSyncAdminController {
  constructor(
    @Inject(OfficialSyncService) private readonly service: OfficialSyncService,
  ) {}

  @Post("sync-all")
  @ApiOperation({ summary: "管理员同步全部公众号订阅" })
  syncAll() {
    return this.service.syncAll();
  }
}
