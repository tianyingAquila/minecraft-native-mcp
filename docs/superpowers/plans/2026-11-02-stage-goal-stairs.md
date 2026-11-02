# 阶段目标板与向上阶梯 Implementation Plan

> **For agentic workers:** Execute this approved scope in the current session, task by task.

**Goal:** 在直播左上角持续展示模型维护的阶段目标，并补齐普通向上阶梯工具。

**Architecture:** 复用Store.goal和set_goal，经已有overlay接口送入原生HUD及备用网页；每轮明确读回当前目标。扩展dig_tunnel的up坡度，清除起步头顶与前方空间，检查支撑后正常跳上一级。

**Tech Stack:** Node.js、Fabric Java、HTML/CSS。

**Spec:** 本会话用户2026-11-02明确请求。

## Global Constraints

- 不精简既有上下文；不引入额外模型调用或永久服务。
- 目标由模型在阶段变化时更新，不由每条动作气泡覆盖；存档和记忆保留。
- 上行仍遵守流体、落沙、受伤、敌人、支撑、时限和取消检查，不垂直盲挖。

## Review Focus

- 长中文目标换行且不覆盖行动气泡；关闭直播扩展后不显示。
- 跨轮、暂停和重启目标仍存在，模型明确看见现值。
- 普通双格高矿道起步须清理当前头顶，否则跳不上。
- 上方流体/落沙、无支撑与取消不能伪报完成。
- 真客户端截图与真实上楼位置分别验收；保留原世界。

### Task 1: 目标闭环

- [ ] 修改src/state.mjs输出goal、src/agent.mjs读回goal及prompts/game.md的阶段更新规则。
- [ ] 修改FishHud.java与web/overlay.*，固定标题、自动换行，并为气泡保留空间。
- [ ] 在已有core/agent测试中保留少量目标不被气泡覆盖的回归检查。

### Task 2: 上行阶梯

- [ ] 修改src/tunnel.mjs与client-actions.mjs：up枚举、起步头顶、前方两格、支撑、正常跳跃。
- [ ] 扩展tests/tunnel.test.mjs验证上行、头部障碍/危险与取消，保留level/down验证。
- [ ] 独立可回收世界完成真实三步上行/下行与目标板截图，不调用模型。

### Task 3: 发布与日常部署

- [ ] 更新说明和版本，构建12版匹配模组、执行测试及包检查。
- [ ] 备份原源码/模组/世界，部署日常项目并重新准备后冻结，不自动开始。
- [ ] 发布安装0.3.6，更新系统账本及恢复说明，清理临时测试世界。
