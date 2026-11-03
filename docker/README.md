# CES Docker 部署

这个镜像只包含 CES 应用和 dsh，不包含 PostgreSQL。数据库使用外部 PostgreSQL；容器通过 `1panel-network` 访问 `postgresql:5432`。

## 构建与传输

```bash
docker build --platform linux/amd64 -t ces:0.0.1-alpha -f docker/Dockerfile .
docker save ces:0.0.1-alpha | gzip > ces-0.0.1-alpha.tar.gz
scp ces-0.0.1-alpha.tar.gz <user>@<host>:/tmp/
```

服务器上：

```bash
sudo docker load < /tmp/ces-0.0.1-alpha.tar.gz
```

## 服务器目录

```text
/opt/ces/
  docker-compose.yml
  .env
  data/
    dsh/          # DSH_HOME：凭据、会话、日志、profile 状态
    workspaces/   # 工作区文件
    components/   # 服务器管理组件目录
```

`data/` 必须持久化；更新镜像只替换容器，不删除这些目录。

## 配置

复制 `.env.example` 为 `.env`，填写：

- `DATABASE_URL`：外部 PostgreSQL 地址
- `ENCRYPTION_KEY`：Fernet key；首次安装后不要更换，已有密文会解不开
- `SESSION_SECRET`：会话签名密钥
- `INITIAL_USERNAME` / `INITIAL_PASSWORD`：首次启动创建的平台账户
- `TRUSTED_HOST`：浏览器访问域名

`.env` 权限设为 `600`。

## 启动

```bash
cd /opt/ces
sudo docker compose up -d
sudo docker compose logs -f --tail=100 ces
```

应用只监听 `127.0.0.1:9090`，由宿主机上的 OpenResty/Nginx 反向代理。不要把 9090 直接暴露公网。

## 数据说明

- `/dsh-home` 映射到 `data/dsh`，包含 `.credentials.yaml`、日志、会话缓存和 profile 状态。
- `/srv/workspaces` 映射到 `data/workspaces`。
- `/srv/components` 映射到 `data/components`。
- 数据库表由 `@smp/console-database` 在启动时迁移；不要删除数据库。
- 每次启动时，镜像内 `/opt/dsh-profile` 会同步到 `data/dsh/profiles/web`，并修正 `@smp` 插件的绝对路径。

## 健康检查

```bash
curl -fsS http://127.0.0.1:9090/
sudo docker inspect --format '{{.State.Health.Status}}' ces
```
