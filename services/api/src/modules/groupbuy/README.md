# 校园拼单 API

- `GET /api/v1/groupbuy/items`：游标分页；支持 `category`、`kind`、`keyword`。
- `GET /api/v1/groupbuy/items/:id`：详情、成员与总份数。
- `POST /api/v1/groupbuy/items`：登录后发起；服务端固定截止时间为创建后 24 小时。
- `PATCH /api/v1/groupbuy/items/:id`：发起人在成团前修改。
- `DELETE /api/v1/groupbuy/items/:id`：发起人在成团前取消。
- `POST /api/v1/groupbuy/items/:id/join`：登记或覆盖自己的份数与备注。
- `DELETE /api/v1/groupbuy/items/:id/join`：成团前退出。
- `POST /api/v1/groupbuy/items/:id/pickup-notice`：成团后发起人发布取货通知。
- `PATCH /api/v1/groupbuy/items/:id/members/:userId/received`：成团后发起人标记或撤销领取。

发起人可在 `items` 提供最多 12 种商品，成员以 `selections` 分别填写各商品份数；`quantity` 必须等于各项之和。成团按有效成员的 `quantity` 总和与 `targetCount` 比较。登记操作在数据库事务中锁定拼单行，避免并发超额。到期未成团的拼单每分钟扫描取消；读取和写入也会触发补偿检查。已成团的拼单不因截止时间取消。

会员代购目前仅要求发起人声明本人持有对应商家会员，`membershipDeclaration` 并非平台核验结果。上线真实会员资格校验前，前端必须显示“发起人自述持卡”。平台不处理支付。

全新数据库可运行 `npm run prisma:migrate -w @kedaya/api` 创建表；已有通过 `prisma db push` 建表的开发数据库，应先按自身数据情况同步新增字段，不要直接应用初始迁移。当前工作环境的 Docker 数据库未启动，因此迁移尚未实际执行。
