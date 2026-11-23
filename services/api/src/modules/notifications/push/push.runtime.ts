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
import { PushService } from "./push.service";

@Injectable()
export class PushDispatchWorker implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PushDispatchWorker.name);
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @Inject(PushService) private readonly service: PushService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  onModuleInit(): void {
    const enabled =
      this.config.get<string>("PUSH_WORKER_ENABLED") === "true" ||
      (this.config.get<string>("NODE_ENV") === "production" &&
        this.config.get<string>("PUSH_WORKER_ENABLED") !== "false");
    if (!enabled) return;
    const interval = Number(
      this.config.get<string>("PUSH_WORKER_INTERVAL_MS") ?? 15_000,
    );
    this.timer = setInterval(
      () => {
        void this.service.dispatchPending().catch((error: unknown) => {
          this.logger.warn(
            `推送派发失败：${error instanceof Error ? error.message : String(error)}`,
          );
        });
      },
      Math.max(5_000, interval),
    );
    this.timer.unref();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }
}

@ApiTags("notifications · 推送运维")
@Controller("notifications/push")
@UseGuards(AdminGuard)
export class PushAdminController {
  constructor(@Inject(PushService) private readonly service: PushService) {}

  @Post("dispatch")
  @ApiOperation({ summary: "管理员立即派发一批待发推送" })
  dispatch() {
    return this.service.dispatchPending();
  }
}
