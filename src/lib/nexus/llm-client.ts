// NEXUS LLM 客户端 — chat-completions / anthropic / responses 三协议
import { type ModelProvider, activeModelOf } from "./settings";

export interface ChatMessage { role: "system" | "user" | "assistant"; content: string; }

export interface StreamChatOptions {
  onToken?: (delta: string) => void;
  onThinking?: (delta: string) => void;
  shouldStop?: () => boolean;
  model?: string;
  temperature?: number;
  maxTokens?: number;
  thinkingEnabled?: boolean;
  thinkingLevel?: string;
  topP?: number;
  frequencyPenalty?: number;
  presencePenalty?: number;
  stop?: string;
  customParams?: string;
  cacheKey?: string;
  // 原生函数调用工具（按协议转换为对应格式）
  tools?: { name: string; description: string; parameters: Record<string, any> }[];
  provider?: ModelProvider | null;
}

export interface StreamChatResult {
  content: string;
  thinking: string;
  toolCalls?: { id?: string; name: string; arguments: Record<string, any> }[];
}

function parseArguments(raw: unknown): Record<string, any> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? parsed : { raw };
  } catch {
    return { raw };
  }
}

// 空闲超时控制器：只在"连续 IDLE_TIMEOUT_MS 没收到任何字节"时才中止，
// 替代旧的 120s 全局定时器（长思考/长回答会被误杀）。
const IDLE_TIMEOUT_MS = 180_000;
// 严格 API 兼容：400 "未知字段"（如 thinking.level 是 GLM 扩展，部分网关拒绝）时，
// 逐级剥掉可选扩展字段重试（thinking → prompt_cache_key → top_p → 惩罚参数 → stop），保证对话可用。
async function fetchWithCompatRetry(
  url: string,
  headers: Record<string, string>,
  body: any,
  idle: IdleTimeoutController,
): Promise<Response> {
  let current = { ...body };
  const stripOrder: (keyof typeof current)[] = ["thinking", "prompt_cache_key", "top_p", "frequency_penalty", "presence_penalty", "stop"];
  for (let attempt = 0; attempt < 7; attempt++) {
    const resp = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(current),
      signal: idle.signal,
    });
    if (resp.ok) return resp;
    const text = await resp.text().catch(() => "");
    const strippable = resp.status === 400 && /unknown field|未知请求字段|UNKNOWN_FIELD|unexpected field|unknown parameter/i.test(text);
    if (!strippable) throw new Error(`API ${resp.status}: ${text.slice(0, 500)}`);
    const next = stripOrder.find((k) => current[k] !== undefined);
    if (!next) throw new Error(`API ${resp.status}: ${text.slice(0, 500)}`);
    delete current[next];
  }
  throw new Error("API 请求失败：兼容重试后仍返回 400");
}

class IdleTimeoutController {
  private ctrl = new AbortController();
  private timer: ReturnType<typeof setTimeout> | null = null;
  readonly signal = this.ctrl.signal;
  constructor() { this.kick(); }
  kick() {
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.ctrl.abort(), IDLE_TIMEOUT_MS);
  }
  dispose() { if (this.timer) clearTimeout(this.timer); }
}

// 供应商当前生效的模型名（兼容遗留的 model 字段）
export function providerModelName(provider: ModelProvider): string {
  return activeModelOf(provider)?.name || (provider as any).model || "";
}

async function streamWithProvider(provider: ModelProvider, messages: ChatMessage[], opts: StreamChatOptions): Promise<StreamChatResult> {
  if (!provider.apiKey) throw new Error(`供应商「${provider.name}」未配置 API Key，请在设置中填写`);
  const modelName = opts.model || providerModelName(provider);
  if (!modelName) throw new Error(`供应商「${provider.name}」未配置模型，请在设置中添加`);
  if (provider.protocol === "anthropic") return streamWithAnthropic(provider, messages, opts);
  if (provider.protocol === "responses") return streamWithResponses(provider, messages, opts);
  const body: any = {
    model: modelName,
    messages, stream: true,
    temperature: opts.temperature ?? 0.6,
    max_tokens: opts.maxTokens ?? 4096,
  };
  // 思考字段兼容策略（重点重构）：
  //  - 默认（glmThinking 未开启）：绝不发送 thinking 字段——它是 GLM 系扩展，
  //    绝大多数 OpenAI 兼容网关/模型（DeepSeek / OpenAI / Qwen / 自定义网关等）不认，
  //    发送即 400（部分严格网关会报 UNKNOWN_FIELD）。
  //    推理模型的思考能力由模型自身决定（如 deepseek-reasoner 自动输出 reasoning_content），
  //    输出侧解析器已兼容 reasoning_content / reasoning / thinking_delta 等格式，无需输入字段。
  //  - glmThinking 开启：仅智谱 GLM / 兼容网关使用，此时才下发 thinking.level。
  if (opts.thinkingEnabled && opts.thinkingLevel && opts.thinkingLevel !== "none" && (provider as any).glmThinking) {
    body.thinking = { type: "enabled", level: opts.thinkingLevel };
  }
  // 高级参数
  if (opts.topP !== undefined) body.top_p = opts.topP;
  if (opts.frequencyPenalty !== undefined) body.frequency_penalty = opts.frequencyPenalty;
  if (opts.presencePenalty !== undefined) body.presence_penalty = opts.presencePenalty;
  if (opts.stop) body.stop = opts.stop;
  // 前缀缓存路由提示（OpenAI 兼容：相同 key 更容易命中服务端 KV 前缀缓存）
  if (provider.promptCache && opts.cacheKey) body.prompt_cache_key = opts.cacheKey;
  // 原生函数调用：不传 tools 时模型只能靠文本协议，稳定性差
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    body.tool_choice = "auto";
  }
  // 自定义参数
  if (opts.customParams) {
    try {
      const custom = JSON.parse(opts.customParams);
      Object.assign(body, custom);
    } catch {}
  }
  // 规范化 base：去尾部斜杠；若已带 /chat/completions 则保留，否则补上
  const rawBase = provider.apiBaseUrl.replace(/\/+$/, "");
  const base = /\/chat\/completions$/i.test(rawBase) ? rawBase : rawBase.replace(/\/completions$/i, "");
  const url = /\/chat\/completions$/i.test(base) ? base : `${base}/chat/completions`;
  const idle = new IdleTimeoutController();
  try {
    const resp = await fetchWithCompatRetry(url, { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` }, body, idle);
    if (!resp.body) throw new Error("无响应体");
    const stream = resp.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { idle.kick(); controller.enqueue(chunk); },
    }));
    return await parseSSE(stream, opts);
  } finally {
    idle.dispose();
  }
}

// Anthropic Messages API（/v1/messages）：系统消息提取到 system 参数，SSE 事件流与 OpenAI 不同
async function streamWithAnthropic(provider: ModelProvider, messages: ChatMessage[], opts: StreamChatOptions): Promise<StreamChatResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const chat = messages.filter((m) => m.role !== "system");
  const body: any = {
    model: opts.model || providerModelName(provider),
    max_tokens: opts.maxTokens ?? 4096,
    messages: chat,
    stream: true,
  };
  if (system) body.system = system;
  // 原生工具（Anthropic 格式）
  if (opts.tools?.length) {
    body.tools = opts.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
  }
  // 思考强度 → budget_tokens；Anthropic 要求开启思考时 temperature 必须为 1
  const level = opts.thinkingEnabled ? opts.thinkingLevel : undefined;
  if (level && level !== "none") {
    body.thinking = { type: "enabled", budget_tokens: level === "low" ? 1024 : level === "medium" ? 4096 : 16384 };
    body.temperature = 1;
  } else {
    if (opts.temperature !== undefined) body.temperature = opts.temperature;
  }
  if (opts.topP !== undefined) body.top_p = opts.topP;
  if (opts.stop) body.stop_sequences = [opts.stop];
  if (opts.customParams) {
    try { Object.assign(body, JSON.parse(opts.customParams)); } catch {}
  }
  const base = provider.apiBaseUrl.replace(/\/+$/, "").replace(/\/messages$/i, "");
  const idle = new IdleTimeoutController();
  try {
    const resp = await fetch(`${base}/messages`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": provider.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify(body),
      signal: idle.signal,
    });
    if (!resp.ok) { const e = await resp.text().catch(() => ""); throw new Error(`API ${resp.status}: ${e.slice(0, 500)}`); }
    if (!resp.body) throw new Error("无响应体");
    const stream = resp.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { idle.kick(); controller.enqueue(chunk); },
    }));
    return await parseAnthropicSSE(stream, opts);
  } finally {
    idle.dispose();
  }
}

// OpenAI Responses API（/responses）：input 数组 + instructions，SSE 事件 response.output_text.delta
async function streamWithResponses(provider: ModelProvider, messages: ChatMessage[], opts: StreamChatOptions): Promise<StreamChatResult> {
  const system = messages.filter((m) => m.role === "system").map((m) => m.content).join("\n\n");
  const chat = messages.filter((m) => m.role !== "system");
  const body: any = {
    model: opts.model || providerModelName(provider),
    stream: true,
    max_output_tokens: opts.maxTokens ?? 4096,
    input: chat.map((m) => ({ role: m.role, content: m.content })),
  };
  if (system) body.instructions = system;
  if (opts.temperature !== undefined) body.temperature = opts.temperature;
  if (opts.topP !== undefined) body.top_p = opts.topP;
  // 思考强度 → reasoning effort
  const level = opts.thinkingEnabled ? opts.thinkingLevel : undefined;
  if (level && level !== "none") {
    body.reasoning = { effort: level === "low" ? "low" : level === "medium" ? "medium" : "high" };
  }
  if (opts.customParams) {
    try { Object.assign(body, JSON.parse(opts.customParams)); } catch {}
  }
  const base = provider.apiBaseUrl.replace(/\/+$/, "").replace(/\/responses$/i, "");
  const idle = new IdleTimeoutController();
  try {
    const resp = await fetch(`${base}/responses`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${provider.apiKey}` },
      body: JSON.stringify(body),
      signal: idle.signal,
    });
    if (!resp.ok) { const e = await resp.text().catch(() => ""); throw new Error(`API ${resp.status}: ${e.slice(0, 500)}`); }
    if (!resp.body) throw new Error("无响应体");
    const stream = resp.body.pipeThrough(new TransformStream({
      transform(chunk, controller) { idle.kick(); controller.enqueue(chunk); },
    }));
    return await parseResponsesSSE(stream, opts);
  } finally {
    idle.dispose();
  }
}

async function parseResponsesSSE(stream: ReadableStream<Uint8Array>, opts: StreamChatOptions): Promise<StreamChatResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", thinking = "";
  // Responses API 原生函数调用：流式事件分片累积，output_item.done 时收口
  const toolCalls: { id?: string; name: string; arguments: Record<string, any> }[] = [];
  const toolByItemId = new Map<string, number>();
  while (true) {
    if (opts.shouldStop?.()) { try { await reader.cancel(); } catch {} break; }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const t = json?.type;
        if (t === "response.output_text.delta" && typeof json.delta === "string") {
          content += json.delta;
          opts.onToken?.(json.delta);
        } else if ((t === "response.reasoning_text.delta" || t === "response.reasoning_summary_text.delta") && typeof json.delta === "string") {
          thinking += json.delta;
          opts.onThinking?.(json.delta);
        } else if (t === "response.output_item.added") {
          // 新函数调用条目（item.type === "function_call"）
          const item = json?.item;
          if (item?.type === "function_call" && item?.name) {
            const idx = toolCalls.length;
            toolCalls.push({ id: item.id || item.call_id, name: item.name, arguments: {} });
            if (item.id) toolByItemId.set(item.id, idx);
          }
        } else if (t === "response.function_call_arguments.delta") {
          const idx = typeof json.item_id === "string" ? toolByItemId.get(json.item_id) : undefined;
          const tc = idx != null ? toolCalls[idx] : toolCalls[toolCalls.length - 1];
          if (tc && typeof json.delta === "string") {
            const raw = ((tc.arguments as any).__raw || "") + json.delta;
            (tc.arguments as any).__raw = raw;
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") tc.arguments = parsed;
            } catch {
              // 分片未完整，继续累积
            }
          }
        } else if (t === "response.output_item.done") {
          // 收口：确保 name 与最终参数可用
          const item = json?.item;
          if (item?.type === "function_call" && item?.name) {
            const idx = item.id ? toolByItemId.get(item.id) : toolCalls.length - 1;
            const tc = idx != null ? toolCalls[idx] : undefined;
            if (tc) {
              if (!tc.name) tc.name = item.name;
              if (typeof item.arguments === "string" && item.arguments) {
                try {
                  const parsed = JSON.parse(item.arguments);
                  if (parsed && typeof parsed === "object") tc.arguments = parsed;
                } catch {}
              }
            }
          }
        }
      } catch {}
    }
  }
  const cleanedToolCalls = toolCalls
    .filter((tc) => tc && tc.name)
    .map((tc) => {
      if ((tc.arguments as any)?.__raw !== undefined) {
        const { __raw, ...rest } = tc.arguments as any;
        if (Object.keys(rest).length) tc.arguments = rest;
        else {
          try { tc.arguments = JSON.parse(__raw); } catch { tc.arguments = { raw: __raw }; }
        }
      }
      return tc;
    });
  return { content, thinking, ...(cleanedToolCalls.length ? { toolCalls: cleanedToolCalls } : {}) };
}

async function parseAnthropicSSE(stream: ReadableStream<Uint8Array>, opts: StreamChatOptions): Promise<StreamChatResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", thinking = "";
  const toolCalls: { id?: string; name: string; arguments: Record<string, any> }[] = [];
  const blockKind: Record<number, string> = {};

  while (true) {
    if (opts.shouldStop?.()) { try { await reader.cancel(); } catch {} break; }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        if (json.type === "content_block_start") {
          const idx: number = json.index ?? 0;
          blockKind[idx] = json.content_block?.type ?? "text";
          if (json.content_block?.type === "tool_use") {
            toolCalls[idx] = { id: json.content_block.id, name: json.content_block.name || "", arguments: {} };
          }
        } else if (json.type === "content_block_delta") {
          const idx: number = json.index ?? 0;
          const d = json.delta || {};
          if (d.type === "text_delta" && d.text) { content += d.text; opts.onToken?.(d.text); }
          else if (d.type === "thinking_delta" && d.thinking) { thinking += d.thinking; opts.onThinking?.(d.thinking); }
          else if (d.type === "input_json_delta" && d.partial_json && toolCalls[idx]) {
            const raw = ((toolCalls[idx].arguments as any).__raw || "") + d.partial_json;
            (toolCalls[idx].arguments as any).__raw = raw;
            try {
              const parsed = JSON.parse(raw);
              if (parsed && typeof parsed === "object") toolCalls[idx].arguments = parsed;
            } catch {}
          }
        }
      } catch {}
    }
  }

  const cleanedToolCalls = toolCalls
    .filter((tc) => tc && tc.name)
    .map((tc) => {
      if ((tc.arguments as any)?.__raw !== undefined) {
        const { __raw, ...rest } = tc.arguments as any;
        if (Object.keys(rest).length) {
          tc.arguments = rest;
        } else {
          try { tc.arguments = JSON.parse(__raw); }
          catch { tc.arguments = { raw: __raw }; }
        }
      }
      return tc;
    });

  return { content, thinking, ...(cleanedToolCalls.length ? { toolCalls: cleanedToolCalls } : {}) };
}

async function parseSSE(stream: ReadableStream<Uint8Array>, opts: StreamChatOptions): Promise<StreamChatResult> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let buffer = "", content = "", thinking = "";
  const toolCalls: { id?: string; name: string; arguments: Record<string, any> }[] = [];

  const flushToolCall = (index: number, id: string | undefined, nameDelta: string | undefined, argsDelta: string | undefined) => {
    toolCalls[index] = toolCalls[index] || { id: id || `call-${index}`, name: "", arguments: {} };
    if (id) toolCalls[index].id = id;
    if (nameDelta) toolCalls[index].name += nameDelta;
    if (argsDelta) {
      const raw = ((toolCalls[index].arguments as any).__raw || "") + argsDelta;
      (toolCalls[index].arguments as any).__raw = raw;
      try {
        const parsed = JSON.parse(raw);
        if (parsed && typeof parsed === "object") toolCalls[index].arguments = parsed;
      } catch {
        // 分片未完整，继续累积
      }
    }
  };

  while (true) {
    if (opts.shouldStop?.()) { try { await reader.cancel(); } catch {} break; }
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split("\n");
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const payload = trimmed.slice(5).trim();
      if (payload === "[DONE]") continue;
      try {
        const json = JSON.parse(payload);
        const delta = json.choices?.[0]?.delta;
        if (delta?.content) { content += delta.content; opts.onToken?.(delta.content); }
        // 思考内容：兼容 reasoning_content(标准) 与 reasoning(SenseNova)
        const think = delta?.reasoning_content ?? delta?.reasoning;
        if (think) { thinking += think; opts.onThinking?.(think); }
        // OpenAI 原生 tool_calls 流式分片
        if (Array.isArray(delta?.tool_calls)) {
          for (const tc of delta.tool_calls) {
            // index 缺失时（SenseNova 等）不能拿 toolCalls.length 当 index——
            // 同一调用的后续分片会被写进新槽位，参数被撕碎。有 id/name=新调用，否则延续最后一个。
            let idx: number;
            if (typeof tc?.index === "number") idx = tc.index;
            else if (tc?.id || tc?.function?.name || toolCalls.length === 0) idx = toolCalls.length;
            else idx = toolCalls.length - 1;
            flushToolCall(idx, tc?.id, tc?.function?.name, tc?.function?.arguments);
          }
        }
      } catch {}
    }
  }

  const cleanedToolCalls = toolCalls
    .filter((tc) => tc.name)
    .map((tc) => {
      if ((tc.arguments as any)?.__raw !== undefined) {
        const { __raw, ...rest } = tc.arguments as any;
        if (Object.keys(rest).length) {
          tc.arguments = rest;
        } else {
          try { tc.arguments = JSON.parse(__raw); }
          catch { tc.arguments = { raw: __raw }; }
        }
      }
      return tc;
    });

  return {
    content,
    thinking,
    ...(cleanedToolCalls.length ? { toolCalls: cleanedToolCalls } : {}),
  };
}

export async function streamChat(messages: ChatMessage[], opts: StreamChatOptions & { provider?: ModelProvider | null }): Promise<StreamChatResult> {
  // 未配置供应商时直接明确报错，绝不静默挂起
  if (!opts.provider) throw new Error("未配置模型供应商，请先在设置中添加供应商与 API Key");
  return streamWithProvider(opts.provider, messages, opts);
}

// 规范化 OpenAI 兼容地址：去尾部斜杠 / 已带 chat/completions 则保留，否则补全
export function normalizeProviderUrl(base: string, suffix: "chat/completions" | "models" = "chat/completions"): string {
  const raw = base.replace(/\/+$/, "");
  if (/\/chat\/completions$/i.test(raw)) return raw;
  const stripped = raw.replace(/\/completions$/i, "").replace(/\/models$/i, "");
  if (suffix === "models") return /\/models$/i.test(raw) ? raw : `${stripped}/models`;
  return `${stripped}/chat/completions`;
}
