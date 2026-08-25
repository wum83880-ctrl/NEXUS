# NEXUS Worklog

## 创新功能

### 1. 时间回溯（核心）
- 每个阶段保存状态 + 项目文件备份，支持恢复到任意快照
- 智能恢复点推荐：按新鲜度/信息量/意图加权打分，回溯界面默认选中最佳点
- 完整性标记：文件备份丢失的快照在列表中明确标红，恢复时如实反馈"部分恢复"
- before_tool 自动快照滚动清理（每会话保留最近 5 个），不再无限占磁盘
- 快照自动摘要标签：「手动快照 · 第3轮 · 42事件·180文件」

### 2. 群聊多 Agent 协作
- 微信群聊式：用户发消息每个 agent 回应
- agent 可调用工具和记忆

## 功能清单
1. 会话 — 对话 + 工具调用 + 执行图 + 决策轨迹 + 快捷指令
2. 群聊 — 多Agent协作 + 工具调用（工作区内自动放行/外部智能拒绝） + 记忆
3. 技能 — 8内置 + 自定义
4. 团队 — 8角色 + 自定义 + 委派任务
5. 记忆 — 自动进化 + 手动CRUD
6. MCP — 说明 + 服务器配置
7. 设置 — 多Provider + 完整模型参数（空闲超时180s/思考强度等）
8. 时间回溯 — 快照 + 智能恢复点推荐 + 完整性标记 + before_tool 滚动清理

## 安装
- Windows: `install-windows.bat`
- Linux: `install-linux.sh`

## 2025 改造轮（分析 + 修复 + 优化，详见 docs/CHANGES.md）
- 代码图谱：docs/CODE-GRAPH.md（架构/模块/调用关系/数据流/Socket 协议）
- 修复 30+ bug：API Key 静默清空、群聊状态卡 idle、快照坏 JSON 捕获失败、socket 空载荷崩溃（DoS）、stopFlags 冲突、限流泄漏、CLI 自动 setup 缺 stream 编译、代理 IP 限流伪造等
- 功能添加：Agent 记忆工具（memory_save/recall + 记忆注入上下文）、http_request/calculator/current_time/echo、审批后自动续跑（chat:rerun）、群聊任务/闲聊分流
- 验证：tsc 0 错误 · 37 测试全过 · next build 通过 · stream 编译通过 · schema 同步

## 第二轮（编程能力补强）
- 编程工具 +3：run_tests（验证闭环）/ workspace_info（项目认知）/ page_reader（网页阅读）；grep 增加 context 前后文
- 代码图谱：import 依赖确定性提取（schema imports 列）+ /graph LLM 分批归纳命令 + 上下文注入依赖关系
- llm-client：Responses 协议原生工具调用解析
- PERSONA：编程工作流（先读后写 / 改完必验证 / 小步迭代 / 报错看根因）
- Bug：app-frame 启动健壮性（try/catch + res.ok）、stream 构建缺导入修复
- 验证：tsc ✅ / 44 测试 ✅ / eslint ✅ / next build ✅ / stream 编译 ✅ / 新工具端到端冒烟 ✅

## 第三轮（图架构补强 + GitHub 借鉴）
- 图架构：代码图谱浏览视图（第4 Tab）、执行图决策节点、执行统计条（GraphStats）
- GitHub 调研借鉴：Auto-Memory 自动记忆（qwen-code/agentmemory）、会话导出/导入（LibreChat）、LLM 智能标题、代码块复制
- Bug：chat:graph 运行锁缺失
- 验证：tsc ✅ / 46 测试 ✅ / eslint ✅ / next build ✅ / stream 冒烟 ✅ / 导入重放冒烟 ✅

## 目标轮第2轮
- Token 用量跟踪（Decision inputTokens/outputTokens + 详情展示）
- 全局消息搜索（/api/search + 侧边栏直达时间轴）
- apply_patch 工具（unified diff 多文件/hunk/dry-run，借鉴 Claude Code）
- Bug：tool-approvals 坏 JSON 500、auto-memory 审批轮误提炼
- 验证：tsc ✅ / 51 测试 ✅ / eslint ✅ / next build ✅ / patch 端到端冒烟 ✅

## 目标轮第3轮
- 排队发送（队列 follow-up，LibreChat 借鉴）：运行中输入入队，完成后自动发送
- 审批触发消息精确回放（ToolApproval.triggerMessage 列）
- 代码图谱过期保鲜（mtime 比对 + stale 徽标）
- 最近改动文件注入上下文
- Bug：schema CRLF 编辑失效、审批回放目标不精确
- 验证：tsc ✅ / 51 测试 ✅ / eslint ✅ / next build ✅ / stream 编译 ✅ / 回放冒烟 ✅

## 自主修 Bug 轮
- 限流桶 graph:/rerun: 键泄漏、chat:error 状态不同步、短 Key 掩码误判、实时消息工具结果丢失、未处理 fetch 拒绝
- 新增 isMaskedApiKey 边界回归测试
- 验证：tsc ✅ / 54 测试 ✅ / eslint ✅ / next build ✅ / stream 编译 ✅ / 搜索冒烟 ✅

## 持续打磨轮
- 本地子代理 delegate（子代真正可用，只读工具白名单）
- 上下文用量指示器（/context + 头部徽标 + 一键压缩）
- 记忆偏好学习（prefs 命名空间，最高优先级注入）
- 快照深度（事件/决策/文件数展示）
- 全局快捷键 + 相对时间 + 安全响应头 + 端口冲突预检
- 验证：tsc ✅ / 54 测试 ✅ / eslint ✅ / next build ✅ / stream 编译 ✅

## 继续打磨轮
- 快照单文件恢复（文件清单 + 恢复接口 + 时间轴 UI）
- patch 工具 CRLF 兼容 + 回归测试
- 未配置供应商引导横幅（localStorage 记忆）
- start-standalone 优先 dist 产物（无需 bun）
- 验证：tsc ✅ / 55 测试 ✅ / eslint ✅ / next build ✅ / 恢复冒烟 ✅

## 故障修复：Turbopack panic
- 根因：stream package.json 自我引用 file:../.. 造成 node_modules junction 循环
- 修复：删除依赖与 junction，npm install 重同步；dev 启动验证 200 无 panic

## 图谱视图重构
- 智能嵌入底层：进入视图自动分析；未配置供应商优雅引导
- 分析失败可见（红字+原因）；头部改克制小图标 + 流动进度条
- /organize 快捷指令下沉到对话层
- 验证：tsc/tests(55)/eslint/next build 全过

## 故障诊断：供应商余额不足
- 根因：自定义网关 chat 接口 503→402 余额不足（拉模型正常）
- 改进：错误真实可见（lastError）、LLM 重试（退避）、图谱失败降级写入结构节点

## 已断开问题修复
- stream 全局错误兜底（不因单错误崩溃）
- nexus web 自动重启 stream（5 次退避）
- socket-url 局域网 dev 直连 + NEXUS_BIND
