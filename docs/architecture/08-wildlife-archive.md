# 野生居民档案（P0 / P1）

名称替换原「猫鸟黑天鹅」，技术模块 ID 保持 `wildlife`。产品文案：记录每一次偶遇，认识校园里的每一位野生居民。

## 实现范围

- 小程序：地图、偶遇发布/编辑、明信片、档案馆、身份卡创建/编辑、居民足迹五个页面。位置拒绝授权后仍能看公开数据和手动确认坐标；前台监听只在用户主动定位后开启，离开地图停止。
- 网页：`/wildlife` 提供相同共享服务的地图、观察列表、明信片、发布表单及身份档案。浏览器定位仅存在页面内存，离开页面停止监听。
- 后端：NestJS + Prisma + PostgreSQL，所有公开观察和身份卡从数据库查询。图片文件落盘，数据库只存文件索引和关系，不使用 LocalStorage 模拟共享数据。
- Flutter：此次仅同步模块名称，尚未实现原生动物地图页面。

## 地图方案

两端使用同一份上科大校园专用详细底图，校外部分按官方校园多边形遮盖，不加载城市地图瓦片。底图包含学校原有的 2.5D 建筑、道路、河道和桥梁；叠加 65 处官方建筑/场所、物质塔和描述性桥梁标签。支持地标搜索、主要/全部建筑标签、缩放、回到校园，以及蓝色用户定位点、动物标记和选点。

- 官方底图与建筑来源：<https://map.shanghaitech.edu.cn/>，公开校园 GIS；[官方使用说明](https://openinfo.shanghaitech.edu.cn/2019/0710/c147a43581/page.psp)。`scripts/sync-campus-map.cjs` 可重新生成仅含校园的底图与去除人员元数据的建筑快照。
- 物质塔位置参考 OpenStreetMap way 833243658；桥梁位置依据官方底图，“生活区北侧步行桥”等是说明位置的标签，不冒充学校正式桥名。
- `packages/contracts/src/campus-map.ts` 统一 BD-09 / 校园局部墨卡托像素与 GCJ-02 的换算、真实校园边界判断和约百米模糊网格。浏览器定位先由 WGS-84 转成 GCJ-02，再叠加到校园图。
- 网页使用 Leaflet `CRS.Simple` 加载本地校园图片，不使用经纬度 CRS 直接叠加图片。随视野更新查询范围；动物昵称在提示框中以纯文本显示。
- 小程序使用可双向滚动的 `CampusView` 加载相同图片、缩放及标记；不再依赖原生 Map 的范围接口。仍需按微信平台要求申请真实位置能力。
- 底图压缩后约 954 KiB，小程序完整构建约 1.43 MiB。构建检查会校验校园图片、标记资源与主包体积。

初始中心仅用于浏览，不能自动当作偶遇坐标。发布必须确认发现位置，并由服务端再次检查校园多边形。约 30 米网格将邻近观察聚合，每次观察仍是独立记录。

模糊位置从真实校园多边形内部选择约百米网格点，不再仅将经纬度夹回矩形包围盒。旧版落到边界外的模糊记录，原作者不重新选点仍可编辑；保存后迁到校内粗网格，保持模糊状态。取消勾选不会恢复已丢弃的精确坐标。

## 主要文件

| 范围 | 路径 |
| --- | --- |
| 共享类型/类别 | `packages/contracts/src/wildlife.ts` |
| 新模型 | `services/api/prisma/schema.prisma` 中 WildlifeAnimal / WildlifeSighting / WildlifeImage / WildlifeSightingPhoto |
| 增量迁移 | `services/api/prisma/migrations/20261017_wildlife_archive/migration.sql` |
| 接口与校验 | `services/api/src/modules/wildlife/archive.controller.ts`、`domain/archive.schemas.ts` |
| 共享业务/图片 | `services/api/src/modules/wildlife/archive.service.ts` |
| 小程序用例与适配 | `apps/miniapp/src/application/wildlife/archive.ts`、`src/platform/wildlife.ts` |
| 小程序页面 | `apps/miniapp/src/presentation/pages/wildlife/` |
| 网页 | `apps/web/src/app/(portal)/wildlife/` |
| 网页同源代理 | `apps/web/src/app/api/wildlife/[...path]/route.ts` |
| 真实验收脚本 | `services/api/scripts/verify-wildlife.mjs` |

## 数据、权限和安全

动物身份卡与偶遇是不同实体。一只动物能有多条不同作者的观察；昵称允许重复；身份卡保留 `mergedIntoId`，记录保留 `moderationStatus` 供后续治理扩展。原 `WildlifeSpot` 表保留，旧骨架控制器不再注册，避免匿名写入入口；`/items` 系列以同样权限规则作为新 sightings 的兼容入口，不再接受旧的客户端作者字段。

读接口公开。写操作复用已有自有 JWT，服务端从 token 获取作者、检查访问令牌类型及所有权，拒绝用 refreshToken 当作访问令牌。照片关联只接受自己的上传，更新时允许保留原照片。创建者和环境变量中配置的管理员可以编辑；其他用户只读，但可以为同一动物增加自己的观察。已有观察的身份卡不能随意换类别，避免破坏历史关联。

图片限制 8MB，最多 6 张，支持 JPEG/PNG/WebP；Sharp 解码真实内容、限制像素数、拒绝 SVG/动图、重新编码 JPEG 并移除 EXIF 拍摄定位。上传目录应放在持久化磁盘，图片通过 API 的固定 URL 提供。未关联的草稿图片目前不会自动清理，后续可增加定时清理策略。

每个用户每分钟最多创建 12 条身份/观察，最多上传 20 张照片（MVP 数据库计数限制；多实例高并发环境建议改为集中式限流）。`clientRequestId` 与作者联合唯一，相同请求可安全重试，不同内容不能复用该编号。失败请求不会显示为发布成功。

实时用户位置不写入后端。选择“模糊位置”后，后端只保存约百米精度的坐标与模糊地点文案，不保留精确原点。类别元数据预留 `sensitive`，日后可强制模糊敏感动物记录。用户自行填写的正文可能包含敏感地点，首版无自动文本脱敏；需要用户注意描述内容。当前提供基础长度/类型校验和前端文本转义，没有接微信内容安全审核或完整举报工作流。

## 本地运行

在仓库根目录执行依赖安装后：

1. API 复制 `services/api/.env.example` 为 `.env`（已存在时不覆盖）。
2. 推荐在 `services/api` 执行 `docker compose up -d postgres`。如果 Windows Docker/WSL 不可用，可在同一目录执行 `npm run dev:db`，使用独立、本地、持久化的真实 PostgreSQL（仅监听 127.0.0.1:5432，数据在被 Git 忽略的 `.local-postgres/`）。它是可选开发工具，不改变生产数据库技术。
3. 在 `services/api` 执行 `npm run prisma:migrate:deploy`、`npm run build`、`npm start`，API 默认 3001。
4. 小程序复制 `apps/miniapp/.env.example` 为 `.env.local`，在根目录执行 `npm run build:weapp -w @kedaya/miniapp`，微信开发者工具打开 `apps/miniapp`。保留关闭的 `compileHotReLoad` 设置，完整编译加载多文件产物。
5. 网页在根目录执行 `npm run dev -w @kedaya/web`，打开 <http://localhost:3000/wildlife>。服务端代理默认连接 127.0.0.1:3001，可用 `KEDAYA_API_URL` 覆盖。

### 开发者工具混用旧页面的问题

若出现 `runtime.js: n[e] is not a function`，可能是旧页面引用了新公共包里已改变的 Webpack 模块编号。本次通过运行时诊断确认：模拟器页面仍引用 2288，而磁盘页面已引用 2495。构建现通过 `CoherentBuildPlugin` 给所有 JS 产物写入同一份内容指纹，公共依赖改变时连同页面一起更新，避免旧页面被继续缓存。构建完成后再执行开发者工具完整编译。

此前原生 Map 存在 `getRegion` 返回值 `.catch()` 和空 `includePoints` 的问题；当前已替换为校园图片组件，不再调用这些接口。

本机开发工具使用 `http://127.0.0.1:3001`；手机上的 127.0.0.1 是手机本身，真机调试需将小程序 API 地址改为电脑局域网 IP 并重编译。正式发布必须配置 HTTPS request/uploadFile/downloadFile 合法域名，公开图片域名也必须可达，并挂载、备份图片目录。定位接口与相册/相机隐私能力须按微信平台要求申请，不能靠代码跳过平台审批。

## 身份认证的实际边界

复用项目已有 `/api/v1/auth/login`、`/auth/refresh` 与自有 User 表，没有另建用户系统。现有上游仍是 MockCampusAuthProvider，尚未真实接入校园 CAS / 微信 code 换身份。界面明确将输入 8 位测试学号的登录称为“开发账号”；拿到的是服务器签发的真实开发 JWT，可进行两个账号的权限和共享验收，但不代表真实校园认证。上线前必须替换现有 AuthPort，并接入真实身份流程。

## 验证

- `npm run typecheck -w @kedaya/api`、`npm run typecheck -w @kedaya/miniapp`、`npm run typecheck -w @kedaya/web`。
- `npm run build:weapp -w @kedaya/miniapp`，随后 `node apps/miniapp/scripts/verify-weapp-build.cjs`：检查模块依赖、447 处 JSX 导入、公共包一致性、无临时诊断、资源及主包大小。
- `npm test -w @kedaya/contracts -- src/campus-map.test.ts`：4 项校园边界、地标、投影往返、边缘模糊位置检查。
- API 启动后，在 `services/api` 执行 `node scripts/verify-wildlife.mjs`：两个账号、真实 HTTP、真实 PostgreSQL 与真实图片，验证 41 项，包括公开共享、关联同一身份、照片可读、EXIF 去除、编辑/删除权限、幂等、坐标/未来时间校验、分页/视野过滤与删除同步。脚本只清理本次创建的数据，不留下假居民。
- `apps/web/src/domain/models/wildlife-coordinates.test.ts` 覆盖坐标转换误差和境外坐标，`apps/miniapp/src/domain/models/wildlife.test.ts` 验证聚合保留独立观察。
- 小程序现有全量测试有旧拼单规则断言未更新（超时 closed 与 cancelled、重复参团等）；API 原有拼单测试及 HTTP 探针测试也存在失败。动物模块的真实验收与构建结果单独记录，不将全量测试描述为全部通过。

仍需用户设备最终验收：校园现场定位精度、定位拒绝/再次授权、真机拍照上传、不同手机的公开图片访问。模拟器或桌面浏览器检查不能替代这些验证。

## 未做的后续阶段

P2 的 AI 识别、自动相似匹配、档案合并 UI、足迹轨迹绘制、点赞评论、收藏、成就和排行均未实现。举报工作流、线上内容安全审核、真实校园认证、Flutter 原生页面、持续同步官方校园地图数据、真实位置现场校准也未完成。

## 接续 Workbuddy 修改（2026-10-17）

保留其地图铺满与缩放、动物类别图标、默认全部时间、首次单次定位、发布后显示明信片等改进。接续补充：多边形内部模糊网格、旧模糊记录编辑、重复点击回到校园、缩放不因画布中心处于空白区域失效，以及提示框纯文本渲染。

按用户要求，后续检查均通过命令行进行，不操作桌面、浏览器或开发者工具。类型、构建、静态产物和 HTTP 验收通过不代表微信模拟器或真机交互已经验收；当前运行实例若保留旧模块缓存，仍需用户自行完整编译或重启开发者工具确认。
