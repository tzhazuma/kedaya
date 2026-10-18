# 可达鸭后端 · 生产镜像（微信云托管 / 任意 Docker 环境）
#
# 构建（在**仓库根目录**执行，构建上下文必须是整个 monorepo）：
#   docker build -f services/api/Dockerfile -t kedaya-api .
#
# 为什么上下文必须是仓库根：api 的产物里 `require('@kedaya/contracts')` 是**裸模块名**，
# 运行时靠 npm workspaces 的符号链接 `node_modules/@kedaya/contracts → packages/contracts`
# 解析；而 contracts 的入口是 TypeScript 源码（`main: ./src/index.ts`，内部是
# extensionless 相对导入），Node 的类型剥离**无法**加载它（`./envelope` 找不到）。
# 解决办法是启动时预加载 `register-workspace-modules.cjs`，把这两个工作区包改指到
# `tsc` 一起编译出来的 CJS 副本（`dist/packages/**`，见 services/api/tsconfig.json）。
# 所以镜像里必须同时有：
#   · node_modules（含 workspace 符号链接）
#   · services/api/dist（含 dist/packages/**）
#   · register-workspace-modules.cjs（启动脚本，见下面的 CMD）
# 基础镜像仍必须是 Node ≥ 22.18（类型剥离默认开启）。
#
# 关于构建耗时：这里刻意用 `npm ci -w @kedaya/api --include-workspace-root`
# 只装 api 这个 workspace 的依赖，避免把 Taro（小程序）与 Next（Web）的依赖
# 一起装进来 —— 微信云托管的构建时限是 10 分钟，装全量很容易撞上。

# ---------------------------------------------------------------------------
# 1. 构建阶段
# ---------------------------------------------------------------------------
FROM node:22.23-alpine AS builder

WORKDIR /repo

# 国内镜像源：云托管的构建机访问官方源不稳定（官方文档亦如此建议）
RUN npm config set registry https://registry.npmmirror.com \
 && npm config set replace-registry-host registry.npmmirror.com

# 只拷贝 manifest，让「依赖安装」这层能被 Docker 缓存住：
# 改源码不会导致重新 install。
COPY package.json package-lock.json .npmrc ./
COPY packages/contracts/package.json packages/contracts/
COPY packages/shared/package.json packages/shared/
COPY packages/design-tokens/package.json packages/design-tokens/
COPY services/api/package.json services/api/
COPY apps/miniapp/package.json apps/miniapp/
COPY apps/web/package.json apps/web/

RUN npm ci -w @kedaya/api --include-workspace-root

# 源码与共享 tsconfig
COPY tsconfig.base.json ./
COPY packages/contracts packages/contracts
COPY packages/shared packages/shared
COPY services/api services/api

# 顺序不能颠倒：生成 Prisma Client 才能让 `@prisma/client` 导出真实模型类型，
# 否则 tsc 会在一堆 model 上编译失败。
RUN npm run prisma:generate -w @kedaya/api \
 && npm run build -w @kedaya/api

# ---------------------------------------------------------------------------
# 2. 运行阶段
# ---------------------------------------------------------------------------
FROM node:22.23-alpine AS runtime

# tzdata 必须装：容器默认 UTC，而课表/校园卡流水都是中国时区语义，
# 差 8 小时会让「今天的课」「今日流水」全部错位。
RUN apk add --no-cache tzdata \
 && cp /usr/share/zoneinfo/Asia/Shanghai /etc/localtime \
 && echo "Asia/Shanghai" > /etc/timezone

WORKDIR /repo

ENV NODE_ENV=production \
    TZ=Asia/Shanghai \
    PORT=80

# 运行时需要的东西（刻意不含源码里的 spec/test 之外的全部 src：
# 源码里只有 packages/* 的 TS 是运行时真正要加载的）
COPY --from=builder /repo/package.json /repo/package-lock.json ./
COPY --from=builder /repo/node_modules ./node_modules
COPY --from=builder /repo/packages/contracts/package.json ./packages/contracts/package.json
COPY --from=builder /repo/packages/contracts/src ./packages/contracts/src
COPY --from=builder /repo/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /repo/packages/shared/src ./packages/shared/src
COPY --from=builder /repo/services/api/package.json ./services/api/package.json
COPY --from=builder /repo/services/api/dist ./services/api/dist
# 启动脚本：把 @kedaya/contracts / @kedaya/shared 指到 dist/packages/** 的 CJS 副本
COPY --from=builder /repo/services/api/register-workspace-modules.cjs ./services/api/register-workspace-modules.cjs
COPY --from=builder /repo/services/api/prisma ./services/api/prisma
COPY --from=builder /repo/services/api/prisma.config.ts ./services/api/prisma.config.ts

# 非 root 运行
RUN chown -R node:node /repo
USER node

# 镜像不自带数据库 —— 见 docs/deploy.md「数据库」一节：
# 云托管容器**不支持持久化存储**，PostgreSQL 必须用托管实例。
EXPOSE 80

# ⚠️ 只能有一条 CMD：Dockerfile 里多条 CMD 只有最后一条会生效
# （这是云托管「部署成功但服务不通」最常见的原因之一）。
# 迁移不在启动脚本里自动跑：多实例并发启动会让 `migrate deploy` 互相打架，
# 迁移应作为**发布流程的独立步骤**（见 docs/deploy.md）。
# `-r` 必须是绝对路径：相对路径按 workdir 解析，换个 WORKDIR 就会静默失效
# （症状是启动即 `ERR_MODULE_NOT_FOUND: .../packages/contracts/src/envelope`）。
CMD ["node", "-r", "/repo/services/api/register-workspace-modules.cjs", "services/api/dist/services/api/src/main.js"]
