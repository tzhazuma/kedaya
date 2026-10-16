/**
 * 隐私与合规提示面板（规格 §9 / §8.1 E10 / §4.3，**硬要求**）。
 *
 * 这里集中展示四条必须出现、且**不能只说"我们很安全"**的说明：
 * 1. 位置**已模糊化**，并且诚实说明强度（能定位到片区，不能定位到房间，**不声称完全匿名**）；
 * 2. 敏感区**不公开任何坐标**；
 * 3. 热点是**历史聚合**（延迟 ≥24h），不是实时位置；
 * 4. 照片**服务端强制剥离 EXIF**（否则位置模糊化会被 GPS 元数据完全绕过）。
 *
 * 另外单独标注：底图是**占位自绘**（学校授权状态未知）、自动分类**不做准确率承诺**。
 */
import {
  NO_ACCURACY_CLAIM_NOTICE,
  PLATFORM_POSITION_NOTICE,
  PRIVACY_EXIF_NOTICE,
  PRIVACY_FUZZ_NOTICE,
  PRIVACY_SENSITIVE_ZONE_NOTICE,
  PRIVACY_TIME_NOTICE,
  SPOT_REALTIME_NOTICE,
} from '@/domain/models/wildlife/ethics';

import { KdyAlert } from '../KdyAlert';

export interface PrivacyNoticePanelProps {
  /** 底图占位声明（来自底图配置；非占位时为空串） */
  basemapNotice?: string;
  className?: string;
}

export function PrivacyNoticePanel({ basemapNotice = '', className }: PrivacyNoticePanelProps) {
  return (
    <div className={`flex flex-col gap-3 ${className ?? ''}`} data-testid="wildlife-privacy-panel">
      <KdyAlert tone="info" title="位置已模糊化（片区级，不是完全匿名）">
        <ul className="flex flex-col gap-1">
          <li>{PRIVACY_FUZZ_NOTICE}</li>
          <li>{PRIVACY_SENSITIVE_ZONE_NOTICE}</li>
          <li>{PRIVACY_TIME_NOTICE}</li>
        </ul>
      </KdyAlert>

      <KdyAlert tone="warning" title="热点是历史聚合，不是实时位置">
        <p>{SPOT_REALTIME_NOTICE}</p>
      </KdyAlert>

      <KdyAlert tone="info" title="照片的 GPS 元数据会被强制剥离">
        <p>{PRIVACY_EXIF_NOTICE}</p>
      </KdyAlert>

      <KdyAlert tone="info" title="自动分类只是建议">
        <p>{NO_ACCURACY_CLAIM_NOTICE}</p>
      </KdyAlert>

      {basemapNotice ? (
        <KdyAlert tone="warning" title="底图是占位示意图（待学校授权）">
          <p>{basemapNotice}</p>
        </KdyAlert>
      ) : null}

      <p className="text-xs text-muted">{PLATFORM_POSITION_NOTICE}</p>
    </div>
  );
}
