# 应用服务器类型方案

- 状态：方案设计，未实现
- 日期：2026-11-06
- 范围：服务器管理、服务器类型扩展、TCR 凭据注入
- 结论：做“应用服务器”类型；不在应用服务器上安装 OneDev Agent

## 1. 结论

采用服务器类型来声明应用服务器的能力：

```text
应用服务器
├─ Docker Engine
├─ Docker Compose
└─ TCR 只读拉取凭据
```

不在应用服务器上安装 OneDev Agent。

OneDev Agent 只属于构建服务器，负责构建和推送镜像。应用服务器只消费 TCR 中的镜像。

## 2. 角色拆分

### 构建服务器

```text
OneDev Build Agent
├─ checkout 代码
├─ docker build
├─ docker push
└─ 输出 digest / image.json
```

凭据：

```text
TCR push 凭据
```

### 应用服务器

```text
Docker Engine
Docker Compose
TCR pull 凭据
```

职责：

```text
docker pull
docker run / docker compose up
停止和回滚
```

不负责：

```text
OneDev Job
代码 checkout
镜像构建
镜像推送
```

### 控制面

CES 服务器管理负责：

- 服务器登记
- 类型绑定
- 软件安装
- 凭据注入
- 生命周期回收
- 状态和审计

## 3. 为什么不在应用服务器装 OneDev Agent

应用服务器装 OneDev Agent 会带来：

- 每台应用服务器都有 OneDev Agent Token
- 应用服务器可以接收构建 Job
- Agent 通常需要 Docker 权限
- 攻击面扩大
- Token 生命周期复杂
- 应用服务器和构建服务器职责混乱

因此：

```text
OneDev Agent：构建服务器的职责
应用服务器：只负责运行镜像
```

## 4. 新服务器流程

```text
创建服务器
  ↓
cloud-init 安装 CES 管理 Agent
  ↓
一次性注册令牌登记服务器
  ↓
管理员选择类型：应用服务器
  ↓
预检
  ├─ 网络能否访问 TCR
  ├─ Docker 是否可用
  ├─ 磁盘和端口
  └─ 系统是否兼容
  ↓
安装 Docker Engine / Docker Compose
  ↓
从 CES 加密配置 / Secret Manager 获取 TCR pull 凭据
  ↓
写入专用 Docker config
  ↓
docker pull 验证
  ↓
标记应用服务器就绪
```

全部流程不需要人工 SSH 登录。

## 5. 类型切换流程

### 转换为应用服务器

```text
切换类型
  → 预检
  → 安装 Docker
  → 注入 TCR 只读凭据
  → 验证拉取
  → 标记 ready
```

### 移出应用服务器

```text
切换类型
  → 删除 Docker config 中的 TCR 凭据
  → 停止相关容器（按策略）
  → 保留或卸载 Docker（按类型策略）
  → 审计记录
```

原则：

```text
注入和回收必须成对存在
```

## 6. 凭据设计

### 不放什么

类型定义中不放：

- TCR 用户名
- TCR 密码
- 长期 Token
- OneDev Agent Token

服务器类型快照、计划、审计和日志中也不出现明文 Secret。

### 放什么

只放凭据引用：

```text
credential_scope: tcr-pull
```

真实凭据放在：

```text
CES 加密配置
或腾讯云 Secret Manager
```

### 账号权限

```text
应用服务器：TCR pull only
构建服务器：TCR push
```

绝不把 push 账号放到应用服务器。

### 注入方式

```text
读取 Secret
→ docker login --password-stdin
→ 写入专用 Docker config
→ 权限 600
```

不以命令行参数、环境变量或日志形式暴露密码。

## 7. 内网服务器的处理

如果应用服务器只能内网访问：

### 方案 A：控制面出站连接

服务器上的管理 Agent 主动连接 CES：

```text
应用服务器 → CES 控制面
```

不需要 CES 主动 SSH 服务器。

### 方案 B：VPC Registry Mirror

```text
TCR → VPC 内 Registry Mirror → 应用服务器
```

应用服务器只配置 Mirror 地址，不需要访问公网 TCR。

### 方案 C：TCR 私有网络端点

使用 TCR 企业版私有网络访问能力，应用服务器通过 VPC 内网拉取。

### 方案 D：云助手

通过云厂商的 Cloud Assistant / SSM 下发命令，不开 SSH。

如果服务器既不能出网，也没有内网 Mirror 或私有端点，则无法从公网 TCR 拉取。这是网络前提，不是 Agent 能解决的问题。

## 8. 类型实现方式

建议新增类型插件：

```text
应用服务器
```

类型声明：

```text
software:
  - Docker Engine
  - Docker Compose

capabilities:
  - tcr-pull
```

凭据注入建议作为该类型的扩展能力，而不是写进类型定义：

```text
ApplicationServerExtension
├─ 预检 TCR 网络
├─ 注入 TCR pull 凭据
├─ 验证 docker pull
└─ 类型移除时清理凭据
```

这样可以复用现有：

```text
@smp/console-container-runtime
```

的 Docker Engine / Docker Compose 软件定义。

## 9. 安全要求

- 只有管理员能切换服务器类型
- 类型切换需要审批
- 凭据注入、验证、清理写审计日志
- UI 只显示“已配置”，不回显密码
- Docker config 权限 `600`
- 支持凭据轮换
- 服务器删除时清理凭据引用
- 不允许 AI 直接读取 TCR 密码
- 不允许应用服务器拥有 push 权限

## 10. 实施阶段

### 第一阶段：应用服务器类型

- 新增“应用服务器”类型
- Docker Engine / Docker Compose
- TCR pull 凭据自动注入
- 类型移除时清理凭据
- 拉取验证

### 第二阶段：自动化注册

- cloud-init 安装管理 Agent
- 一次性注册令牌
- 类型自动绑定
- 状态上报

### 第三阶段：内网和凭据治理

- VPC Registry Mirror 或 TCR 私有端点
- 短期 Token
- 凭据轮换
- 审计和告警

## 11. 验收标准

1. 新服务器不需要人工 SSH 登录即可登记。
2. 选择应用服务器后自动安装 Docker。
3. 应用服务器自动获得 TCR 只读拉取能力。
4. 应用服务器没有 TCR push 权限。
5. 应用服务器没有 OneDev Agent。
6. 类型移除后凭据被清理。
7. 凭据不出现在日志、计划、类型快照和 UI 中。
8. 内网服务器可通过 Mirror 或私有端点拉取。
9. AI 只调用部署工具，不接触 Registry 密码。
10. 构建服务器仍然负责构建和推送 TCR。
