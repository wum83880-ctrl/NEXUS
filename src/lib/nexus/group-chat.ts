// NEXUS 群聊 — 像真人群聊一样：用户说什么 agent 就回应什么，下任务才各司其职讨论
import { db } from "@/lib/db";
import { getSettings, resolveProvider, type AgentSettings, type ModelProvider } from "./settings";
import { streamChat as llmStreamChat, type ChatMessage } from "./llm-client";
import { parseToolCallsFromText } from "./tool-parser";
import { TOOLS, executeTool, assessToolCall } from "./tools";
import { workspaceRoot } from "./sandbox";

export interface GroupMember {
  id: string; name: string; role: string; systemPrompt: string;
  color: string; icon: string; providerId?: string;
}

export interface GroupRoomData {
  id: string; name: string; members: GroupMember[]; task: string;
  status: string; createdAt: string; updatedAt: string;
}

export interface GroupMessageData {
  id: string; roomId: string; senderId: string; senderName: string;
  senderRole: string; color: string; content: string; thinking: string;
  round: number; createdAt: string;
}

export interface GroupRunCallbacks {
  onMessageStart?: (msg: GroupMessageData) => void;
  onMessageChunk?: (msgId: string, delta: string) => void;
  onMessageDone?: (msg: GroupMessageData) => void;
  onRoundStart?: (round: number) => void;
  onRoundEnd?: (round: number) => void;
  onAllDone?: () => void;
  shouldStop?: () => boolean;
}

function parseMembers(raw: string): GroupMember[] {
  try {
    const v = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((m) => m && typeof m === "object" && m.id && m.name) : [];
  } catch {
    return []; // 脏数据不崩列表：坏成员按空处理，房间仍可浏览
  }
}

export async function listRooms(): Promise<GroupRoomData[]> {
  const rows = await db.groupRoom.findMany({ orderBy: { updatedAt: "desc" }, take: 100 });
  return rows.map((r) => ({ id: r.id, name: r.name, task: r.task, status: r.status, members: parseMembers(r.members), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() }));
}

export async function getRoom(id: string): Promise<GroupRoomData | null> {
  const r = await db.groupRoom.findUnique({ where: { id } });
  if (!r) return null;
  return { id: r.id, name: r.name, task: r.task, status: r.status, members: parseMembers(r.members), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

export async function createRoom(name: string, members: GroupMember[], task = ""): Promise<GroupRoomData> {
  const r = await db.groupRoom.create({ data: { name, members: JSON.stringify(members), task, status: "idle" } });
  return { id: r.id, name: r.name, task: r.task, status: r.status, members, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
}

export async function updateRoom(id: string, patch: { name?: string; members?: GroupMember[]; task?: string; status?: string }) {
  const data: any = {};
  if (patch.name !== undefined) data.name = patch.name;
  if (patch.members !== undefined) data.members = JSON.stringify(patch.members);
  if (patch.task !== undefined) data.task = patch.task;
  if (patch.status !== undefined) data.status = patch.status;
  return db.groupRoom.update({ where: { id }, data });
}

export async function deleteRoom(id: string) {
  await db.groupMessage.deleteMany({ where: { roomId: id } }).catch(() => {});
  await db.groupRoom.delete({ where: { id } }).catch(() => {});
}

export async function getRoomMessages(roomId: string): Promise<GroupMessageData[]> {
  const rows = await db.groupMessage.findMany({ where: { roomId }, orderBy: { createdAt: "asc" }, take: 500 });
  return rows.map((r) => ({ id: r.id, roomId: r.roomId, senderId: r.senderId, senderName: r.senderName, senderRole: r.senderRole, color: r.color, content: r.content, thinking: r.thinking, round: r.round, createdAt: r.createdAt.toISOString() }));
}

export async function addMessage(msg: Omit<GroupMessageData, "id" | "createdAt"> & { id?: string }): Promise<GroupMessageData> {
  const r = await db.groupMessage.create({
    data: {
      // 允许传入与前端占位一致的 id：流式占位结束后按 id 原位替换，避免重复气泡
      ...(msg.id ? { id: msg.id } : {}),
      roomId: msg.roomId,
      senderId: msg.senderId,
      senderName: msg.senderName,
      senderRole: msg.senderRole,
      color: msg.color,
      content: msg.content,
      thinking: msg.thinking,
      round: msg.round,
    },
  });
  return { ...msg, id: r.id, createdAt: r.createdAt.toISOString() };
}

// 解析工具调用（统一走 tool-parser）
function parseToolCalls(content: string): { name: string; arguments: Record<string, any> }[] | null {
  return parseToolCallsFromText(content);
}

// 群聊工具循环：【思考 → 工具调用 → 结果回灌 → 再思考】，直到信息充足或轮次耗尽。
// 与主会话的执行约束一致：不允许调用一次工具就停止。
interface ToolLoopOptions {
  messages: ChatMessage[];
  settings: AgentSettings;
  provider: ModelProvider | null;
  cacheKey: string;
  roomId?: string;
  onChunk?: (d: string) => void;
  shouldStop?: () => boolean;
  maxToolRounds?: number;
}

async function runToolLoop(opts: ToolLoopOptions): Promise<string> {
  const { messages, settings, provider, cacheKey } = opts;
  const maxRounds = opts.maxToolRounds ?? 3;
  const toolDefs = TOOLS
    .filter((t) => !settings.enabledTools.length || settings.enabledTools.includes(t.name))
    .map((t) => ({ name: t.name, description: t.description, parameters: t.parameters }));
  const baseOpts = {
    temperature: settings.temperature, maxTokens: settings.maxTokens,
    thinkingEnabled: settings.thinkingEnabled,
    thinkingLevel: provider?.thinkingLevel,
    topP: provider?.topP,
    frequencyPenalty: provider?.frequencyPenalty,
    presencePenalty: provider?.presencePenalty,
    stop: provider?.stop,
    customParams: provider?.customParams,
    cacheKey,
    tools: toolDefs,
    provider,
    shouldStop: opts.shouldStop,
  };
  let content = "";
  for (let round = 0; round <= maxRounds; round++) {
    if (opts.shouldStop?.()) break;
    try {
      const r = await llmStreamChat(messages, { ...baseOpts, onToken: opts.onChunk });
      content = r.content || "";
      // 原生 tool_calls 优先；无原生调用时兜底解析文本 JSON 协议
      const native = r.toolCalls?.length
        ? r.toolCalls.map((tc) => ({ name: tc.name, arguments: tc.arguments }))
        : null;
      const toolCalls = native ?? parseToolCalls(content);
      if (!toolCalls || toolCalls.length === 0) return content;

      // 原生调用时 content 常为空，给 assistant 消息一个可读占位
      messages.push({ role: "assistant", content: content || `[调用工具: ${toolCalls.map((tc) => tc.name).join(", ")}]` });
      let toolResults = "";
      for (const tc of toolCalls) {
        const assessment = assessToolCall(tc.name, tc.arguments, settings.safetyMode);
        if (assessment.blockedBySystemGuard) {
          toolResults += `\n[工具 ${tc.name} 被系统保护拦截：${assessment.guardReason ?? "危险操作"}，请换一种安全的方式]\n`;
          continue;
        }
        if (assessment.requiresApproval && settings.safetyMode !== "unrestricted") {
          toolResults += `\n[工具 ${tc.name} 需要写工作区外/敏感位置，群聊模式已自动拒绝。请把目标路径改到项目工作区内（${workspaceRoot()}），或改用其他方案]\n`;
          continue;
        }
        const res = await executeTool(tc.name, tc.arguments, settings.enabledTools, {
          mode: settings.safetyMode,
          workspaceRoot: workspaceRoot(),
          roomId: opts.roomId,
          approved: true,
        });
        toolResults += `\n[工具 ${tc.name} 结果] ${res.content}\n`;
      }
      messages.push({
        role: "user",
        content: `以下是工具返回结果：\n${toolResults}\n\n请基于结果重新判断：信息仍不足就继续调用工具；信息充足请直接给出最终回复（不要再输出工具 JSON）。`,
      });
    } catch (err: any) {
      return `[出错] ${err?.message || String(err)}`;
    }
  }
  // 工具轮次耗尽：若模型最后仍只输出工具 JSON，追加一次"收尾"调用要求直接给结论，
  // 避免把裸 JSON 当最终回复落库展示。
  if (parseToolCalls(content)) {
    messages.push({ role: "user", content: "工具调用轮次已达上限。请忽略之前的工具请求，直接基于已有信息给出最终结论（不要输出任何工具 JSON）。" });
    try {
      const r = await llmStreamChat(messages, { ...baseOpts, tools: [], onToken: opts.onChunk });
      content = r.content || "";
    } catch (err: any) {
      content = `[出错] ${err?.message || String(err)}`;
    }
  }
  return content;
}

// 核心：处理用户消息 —— 像真人群聊
// 用户说"你们好" → 每个 agent 回应"你好"
// 用户下任务 → 每个 agent 各司职提见解、讨论验证
export async function handleUserMessage(roomId: string, userMessage: string, cb: GroupRunCallbacks): Promise<void> {
  const room = await getRoom(roomId);
  if (!room) throw new Error("群聊不存在");
  await updateRoom(roomId, { status: "running" }).catch(() => {});

  try {
    const settings = await getSettings();
    const provider = resolveProvider(settings);
    const priorMessages = await getRoomMessages(roomId);

    // 持久化用户消息
    const userMsg = await addMessage({ roomId, senderId: "user", senderName: "我", senderRole: "用户", color: "zinc", content: userMessage, thinking: "", round: 0 });
    cb.onMessageStart?.(userMsg);
    cb.onMessageDone?.(userMsg);

    cb.onRoundStart?.(0);

    // 任务/闲聊分流：任务类消息走完整工具协议；闲聊/问候走轻量提示，省 token、回复更自然
    const isTask = /(任务|分析|讨论|评估|设计|实现|研究|规划|方案|对比|审查|排查|解决|优化|建议|帮我|修复|写|生成|部署|调研)/.test(userMessage) && userMessage.length > 10;

    for (const member of room.members) {
      if (cb.shouldStop?.()) break;

      const placeholderId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${member.id}`;
      const placeholder: GroupMessageData = {
        id: placeholderId, roomId,
        senderId: member.id, senderName: member.name, senderRole: member.role,
        color: member.color, content: "", thinking: "", round: 0,
        createdAt: new Date().toISOString(),
      };
      cb.onMessageStart?.(placeholder);

      // 关键修复：system prompt 定义角色 + 当前场景
      // user message 直接是用户说的话（不是包装过的任务格式）
      const sysPrompt = `你是「${member.name}」，${member.role}。${member.systemPrompt}

你正在一个多 Agent 群聊中。群聊成员：${room.members.map((m) => `${m.name}（${m.role}）`).join("、")}。

规则：
- 用户说什么你就回应什么，像真人群聊一样自然。
- 如果用户打招呼，你就打招呼。
- 如果用户提问，你就从你的专业角度回答。
- 如果用户下任务，你各司其职：先分析问题，提出见解，阅读其他人的回复后可以赞同、质疑或补充。
- 用中文，简洁自然，像真人说话。
- 可以 @其他成员。${isTask ? `
- 你可以使用工具来增强回答，优先使用原生工具调用；没有原生工具时输出 JSON 代码块：
\`\`\`json
{"tool": "<工具名>", "args": {<参数>}}
\`\`\`
可用工具：read（读文件）、write（写文件）、edit（编辑）、glob（查找文件）、grep（搜索内容）、pwsh（执行命令）、web_search（搜索）、memory_save（保存记忆）、memory_recall（回忆记忆）、http_request（HTTP 请求）、todo_write（任务清单）、ask_user_question（提问）。
- 工具返回后必须基于结果重新判断：信息不足继续调用工具；信息充足才给出最终回复。不允许调用一次工具就结束。
- 如果需要搜索信息或验证事实，主动使用 web_search。` : `- 闲聊场景不需要调用工具，直接自然回应即可。`}`;

      const messages: ChatMessage[] = [{ role: "system", content: sysPrompt }];

      // 注入群聊历史 —— 关键修复：用正确的方式区分不同人的发言
      // 用 user 角色表示"别人说的话"，让 LLM 理解这是对话历史
      for (const pm of priorMessages) {
        if (pm.senderId === "user") {
          messages.push({ role: "user", content: pm.content });
        } else if (pm.senderId === "system") {
          continue; // 跳过系统消息
        } else {
          // 其他 agent 的发言 —— 用 user 角色包装，明确标注是谁说的
          messages.push({ role: "user", content: `${pm.senderName}：${pm.content}` });
        }
      }

      // 当前用户消息
      messages.push({ role: "user", content: userMessage });

      let memberProvider = provider;
      if (member.providerId) {
        const p = settings.providers.find((x) => x.id === member.providerId);
        if (p) memberProvider = p;
      }

      // 工具循环：思考→工具→结果回灌→再思考（与主会话执行约束一致）
      const content = await runToolLoop({
        messages,
        settings,
        provider: memberProvider,
        cacheKey: `group:${roomId}:${member.id}:0`,
        roomId,
        onChunk: (d) => cb.onMessageChunk?.(placeholder.id, d),
        shouldStop: cb.shouldStop,
      });

      // 保存时复用占位 id：前端 message_done 按 id 原位替换，不会出现"空气泡+完整气泡"双份
      const saved = await addMessage({ id: placeholder.id, roomId, senderId: member.id, senderName: member.name, senderRole: member.role, color: member.color, content, thinking: "", round: 0 });
      cb.onMessageDone?.(saved);
      priorMessages.push(saved); // 让后续 agent 看到这条
    }

    cb.onRoundEnd?.(0);
    if (!cb.shouldStop?.()) {
      cb.onAllDone?.();
    }
  } finally {
    // 无论正常/停止/异常都复位状态，避免群聊徽标永久"运行中"
    await updateRoom(roomId, { status: "idle" }).catch(() => {});
  }
}

// 原始的 runGroupChat 保留用于多轮任务讨论
export async function runGroupChat(roomId: string, task: string, rounds: number, cb: GroupRunCallbacks): Promise<void> {
  await updateRoom(roomId, { status: "running", task });
  await addMessage({ roomId, senderId: "system", senderName: "系统", senderRole: "", color: "zinc", content: `📋 任务开始：${task}`, thinking: "", round: 0 });

  let finished = false;
  try {
    for (let r = 0; r < rounds; r++) {
      if (cb.shouldStop?.()) break;
      await runGroupRound(roomId, task, r, cb);
    }

    // 最终总结
    const room = await getRoom(roomId);
    if (room && room.members.length > 0 && !cb.shouldStop?.()) {
      const summarizer = room.members.find((m) => m.role.includes("总结") || m.role.includes("主持")) || room.members[0];
      cb.onRoundStart?.(rounds);
      const summaryId = `msg-summary-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const placeholder: GroupMessageData = { id: summaryId, roomId, senderId: summarizer.id, senderName: `${summarizer.name}（总结）`, senderRole: "总结", color: summarizer.color, content: "", thinking: "", round: rounds, createdAt: new Date().toISOString() };
      cb.onMessageStart?.(placeholder);

      const allMessages = await getRoomMessages(roomId);
      const summarySys = `${summarizer.systemPrompt}\n\n你现在要为这次群聊做最终总结。综合所有成员的发言，提炼：1. 共识点 2. 分歧点 3. 行动建议。用中文，300-500 字。`;
      const messages: ChatMessage[] = [{ role: "system", content: summarySys }];
      messages.push({ role: "user", content: `任务：${task}` });
      for (const pm of allMessages) {
        if (pm.senderId === "system" || pm.senderId === "user") continue;
        const m = room.members.find((x) => x.id === pm.senderId);
        if (m) messages.push({ role: "user", content: `${m.name}：${pm.content}` });
      }
      messages.push({ role: "user", content: "请给出最终总结。" });

      const settings = await getSettings();
      const provider = resolveProvider(settings);
      let sumProvider = provider;
      if (summarizer.providerId) { const p = settings.providers.find((x) => x.id === summarizer.providerId); if (p) sumProvider = p; }

      let content = "";
      try {
        const result = await llmStreamChat(messages, {
          onToken: (d) => { content += d; cb.onMessageChunk?.(placeholder.id, d); },
          shouldStop: cb.shouldStop,
          temperature: settings.temperature, maxTokens: settings.maxTokens,
          thinkingEnabled: settings.thinkingEnabled,
          thinkingLevel: sumProvider?.thinkingLevel,
          topP: sumProvider?.topP,
          stop: sumProvider?.stop,
          customParams: sumProvider?.customParams,
          cacheKey: `group:${roomId}:summary`,
          provider: sumProvider,
        });
        content = result.content || content;
      } catch (err: any) { content = `[总结出错] ${err?.message}`; }

      const saved = await addMessage({ id: summaryId, roomId, senderId: summarizer.id, senderName: `${summarizer.name}（总结）`, senderRole: "总结", color: summarizer.color, content, thinking: "", round: rounds });
      cb.onMessageDone?.(saved);
      cb.onRoundEnd?.(rounds);
    }

    if (!cb.shouldStop?.()) {
      await updateRoom(roomId, { status: "done" });
      finished = true;
      cb.onAllDone?.();
    }
  } finally {
    // 正常完成保持 done；停止/异常时兜底复位，避免房间 status 卡在 running
    if (!finished) await updateRoom(roomId, { status: "idle" }).catch(() => {});
  }
}

async function runGroupRound(roomId: string, task: string, round: number, cb: GroupRunCallbacks): Promise<void> {
  const room = await getRoom(roomId);
  if (!room) throw new Error("群聊不存在");
  const settings = await getSettings();
  const provider = resolveProvider(settings);
  const priorMessages = await getRoomMessages(roomId);
  cb.onRoundStart?.(round);

  for (const member of room.members) {
    if (cb.shouldStop?.()) break;

    const placeholderId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${member.id}`;
    const placeholder: GroupMessageData = {
      id: placeholderId, roomId,
      senderId: member.id, senderName: member.name, senderRole: member.role,
      color: member.color, content: "", thinking: "", round,
      createdAt: new Date().toISOString(),
    };
    cb.onMessageStart?.(placeholder);

    const sysPrompt = `你是「${member.name}」（${member.role}），正在多 Agent 群聊中协作讨论任务。

任务：${task}

规则：
- 针对任务给出专业见解。
- 阅读其他成员发言，可以赞同、质疑或补充，不要重复别人说过的。
- 用中文，150-300 字。
- 可以 @其他成员。
- 如需查证事实/读取文件，可使用工具：优先原生工具调用；否则输出 JSON 代码块：
\`\`\`json
{"tool": "<工具名>", "args": {<参数>}}
\`\`\`
可用工具：read（读文件）、glob（查找文件）、grep（搜索内容）、web_search（搜索）、http_request（HTTP 请求）、memory_recall（回忆记忆）。工具返回后基于结果继续，信息充足再给出结论。`;

    const messages: ChatMessage[] = [{ role: "system", content: sysPrompt }];
    // 注入历史 —— 用 user 角色标注谁说的
    for (const pm of priorMessages) {
      if (pm.senderId === "system") continue;
      if (pm.senderId === "user") {
        messages.push({ role: "user", content: `用户：${pm.content}` });
      } else {
        messages.push({ role: "user", content: `${pm.senderName}：${pm.content}` });
      }
    }
    if (round === 0) {
      messages.push({ role: "user", content: `请从你的专业角度分析这个任务并给出初步见解。` });
    } else {
      messages.push({ role: "user", content: `第 ${round + 1} 轮讨论。请基于以上发言补充新观点或回应其他成员。` });
    }

    let memberProvider = provider;
    if (member.providerId) { const p = settings.providers.find((x) => x.id === member.providerId); if (p) memberProvider = p; }

    // 工具循环：讨论中也能检索/读文件，结果回灌后继续思考
    const content = await runToolLoop({
      messages,
      settings,
      provider: memberProvider,
      cacheKey: `group:${roomId}:${member.id}:${round}`,
      roomId,
      onChunk: (d) => cb.onMessageChunk?.(placeholder.id, d),
      shouldStop: cb.shouldStop,
    });

    const saved = await addMessage({ id: placeholder.id, roomId, senderId: member.id, senderName: member.name, senderRole: member.role, color: member.color, content, thinking: "", round });
    cb.onMessageDone?.(saved);
    priorMessages.push(saved);
  }
  cb.onRoundEnd?.(round);
}
