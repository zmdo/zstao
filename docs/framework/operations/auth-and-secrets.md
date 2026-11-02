# 认证、密钥和敏感数据

核对基线：`ces/develop`，`f2b8d86`，2026-10-20。

产品前提（2026-10-23 确认）：这是单用户系统，只有现有的一个平台账户。登录、管理操作和人工审批均面向该用户，不引入 `user/ops/admin` 角色、账号权限组、多用户 RBAC 或逐服务器 ACL。工作区组和服务器分组仅组织业务资源，不承担账号权限职责。

## 两层连接状态

frame 提供控制台用户名／密码和可选 TOTP 登录，签发 `smp_session`；Harness 自己还管理浏览器页面连接。两者是独立状态，不能把其中一个 cookie 的存在当作另一层已认证。

frame 的 `connection.authorizeIndex` 门禁在有有效控制台签名、但尚无有效 Harness 页面连接时，使用宿主当前启动 token 完成连接交换；token 不应写入文档或排查输出。页面访问遇到问题时分别检查安装门禁、控制台账户、页面连接三层。

当前 cookie 签名内容是用户名和过期时间，HMAC-SHA256，期限 14 天；调用 `consoleSession.read()` 的受保护入口还会重新查账户是否存在。源码 cookie 标记为 HttpOnly、SameSite=Lax，未添加 Secure。单用户登录不需要新增角色校验；当前没有统一会话撤销表。

`/console-api` 不是全局鉴权中间件覆盖的命名空间，各路由自行校验。例如 `GET /console-api/site` 公开提供网站信息，同路径 POST 修改才要求登录；登录和安装引导也有公开入口。新增接口要检查实际 handler 的方法与会话校验，不能仅凭路径前缀判断受保护。服务器管理使用自己的公共 guard，见下文。

密码为 bcrypt（12 轮）；TOTP 配置在既有账户字段中。修改密码会在数据库事务里尝试重加密旧 `wallets.ciphertext`，因此该路径依赖旧钱包表和兼容的密码派生密文。

## 各种 secret 不能混用

| 值 | 用途 | 变化影响 |
| --- | --- | --- |
| frame `sessionSecret` | 控制台 cookie 签名 | 旧 cookie 无法通过新 secret 校验 |
| database `encryptionKey` | `secrets.encrypt/decrypt`，Fernet 密文 | 当前更换操作不重加密旧业务数据 |
| 登录密码 | bcrypt 认证；兼容旧钱包密文解密 | 不等于数据库 Fernet key |
| SSH 私钥／密码 | 连接登记服务器 | 数据库加密保存，使用前由宿主解密 |
| Harness credential reference | 模型服务等凭据引用 | 模型镜像保存引用及可解析凭据的密文 |
| 安装标记 | 锁定安装流程 | 是文件状态，不是加密密钥 |

数据页面的 `GET /console-api/data/key` 在登录后返回当前 Fernet key；`POST` 写回 profile 并调用 `secrets.replaceKey()`。它只是替换后续编解码使用的 key，没有旧密文批量轮换和双 key 过渡机制。不能把“页面保存成功”理解为旧 SSH、模型等密文已经迁移。

## 服务器认证

服务器管理统一通过 `consoleSession.read()` 保护 HTTP 业务入口，终端 WebSocket 升级也检查控制台会话。SSH 目标是登记地址／端口／用户，没有“必须内网地址”的限制。

已有密钥由服务端按 ID 读取并解密，客户端列表不返回私钥正文。当前拒绝带 passphrase 的加密私钥；私钥格式、连接、SSH 握手、认证和主机指纹是不同失败阶段。

首次成功连接可钉住主机指纹；已登记指纹不匹配时拒绝。不能为解决连接失败顺手取消指纹核验、修改 socket 权限或自动授予 sudo。

## 故障和资料交接

排查可以记录错误代码、阶段、时间、目标的脱敏标识、配置修订和任务 ID。不要打印完整 profile、私钥、cookie、数据库 URL、安装提交内容或带 token 的启动链接。

当前可信插件运行在宿主进程内，不是互不信任代码的沙箱。namespace 与来源校验用于避免错误身份和误调用，不等于内存／数据库权限隔离。

源码：[门禁](../../../plugins/frame/src/gate.ts)、[会话签名](../../../plugins/frame/src/session.ts)、[安全设置](../../../plugins/frame/src/security.ts)、[密文服务](../../../plugins/database/src/fernet.ts)、[密钥替换](../../../plugins/encryption-key/src/index.ts)、[SSH](../../../plugins/server-management/src/host/remote/ssh.ts)。
