# `test` 类型的构建 Agent recipe（2026-10-25）

- 状态：代码已实现，B 上的插件安装未完成
- 服务器：`43.163.113.98`
- 失败阶段：SSH 认证等待超时，不是 recipe 脚本执行失败

## 1. 已实现

`test` 类型增加：

```text
software: @smp/console-self-evolution/onedev-build-agent
recipe:   @smp/console-self-evolution/onedev-build-agent-test
```

`test.sh` 的 agent 分支：

```text
前置：Java 17、/srv/ces-test/secrets/onedev-server-url、
      /srv/ces-test/secrets/onedev-agent-token、
      /srv/ces-test/bootstrap/agent.tar.gz
解压 Agent 分发包到 /srv/ces-test/agent
写 conf/agent.properties（serverUrl、agentTokenFile、agentName）
chown cesagent:cesagent
RUN_AS_USER=cesagent bin/agent.sh install
systemctl start onedev.agent
等待 active
```

detect 通过 `systemctl is-active onedev.agent` 判断；缺少 bootstrap 文件时 execute
返回 `agent_bootstrap_missing` 或 `agent_package_missing`。

## 2. Bootstrap 文件

已在 B 准备：

```text
/srv/ces-test/secrets/onedev-agent-token  (新 token id 3，600 cesagent)
/srv/ces-test/secrets/onedev-server-url   (http://43.128.69.189)
/srv/ces-test/bootstrap/agent.tar.gz      (30 MB，600)
```

旧的 `onedev.agent` 服务和 `/srv/ces-test/agent` 已移除，准备由插件重装。

## 3. 安装尝试

- 先通过 `PATCH /servers/:id` 刷新 B 的 type snapshot，使 requirements 包含 agent。
- 触发 `install-components`，Job `3d2cb8d8-ecce-453f-a013-ef0efdf8e9f6`。
- 结果：`failed`，`ssh_auth_timeout`（SSH 握手完成，认证等待 30 秒超时）。
- 失败发生在连接/认证阶段，尚未进入 agent recipe 的 execute。

## 4. 未验证

- Agent recipe 的实际安装、服务启动和 OneDev online 状态。
- B 的最终 `software_state` 是否 ready。
- 构建 Agent 与候选部署同时运行的稳定性。

## 5. 下一步

SSH 恢复后：

1. 重新触发 `install-components`。
2. 确认 `onedev.agent` 为 active，OneDev Agents 页面 online。
3. 确认 `/srv/ces-test/agent/conf/agent.properties` 使用新 token。
4. 重新写入候选并验证 80 入口。

## 7. 后续：安装成功（2026-10-25）

B 的 SSH 恢复后重新执行 `install-components`：

```text
preflight ced68bf6... succeeded
apply     d4ddfe3f... succeeded
```

结果：

```text
onedev.agent：active
/srv/ces-test/agent/conf/agent.properties：存在
OneDev agent：ces-build-agent online（token id 3）
B 服务器：status=normal，software_state=ready
```

说明 `test.sh` 的 agent 分支、bootstrap token/package 和 systemd 安装路径
均可用；之前的失败确认为 SSH 认证超时。
