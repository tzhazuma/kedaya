import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { MailMessage, MailPort } from '../domain/local-account.domain';

/**
 * 开发用邮件实现：把验证码写进服务端日志。
 *
 * 为什么保留它作为默认实现：
 *   本机与 CI 都没有 SMTP，而注册/找回密码必须**可被验证**。
 *   因此在开发模式下验证码走日志；同时由服务层通过
 *   `AUTH_DEV_EXPOSE_CODES=true` 决定是否把验证码直接放进接口响应，
 *   方便真机联调 —— 生产环境该开关必须为 false（见 docs/local-development.md）。
 *
 * 接生产：实现同一个 `MailPort` 换成 SMTP/HTTP 网关即可，业务代码不变。
 */
@Injectable()
export class ConsoleMailAdapter implements MailPort {
  private readonly logger = new Logger('KedaYaMail');

  constructor(@Inject(ConfigService) private readonly config: ConfigService) {}

  async send(message: MailMessage): Promise<void> {
    if (this.config.get<string>('NODE_ENV') === 'test') return;

    // 只打印收件人、主题与正文；正文里已包含验证码，但**不会**进入审计表。
    this.logger.log(
      `[dev-mail] to=${message.to} subject=${message.subject}\n${message.text}`,
    );
  }
}
