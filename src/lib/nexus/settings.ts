// NEXUS settings — 供应商/模型两级配置
import { db } from "@/lib/db";
import type { SafetyMode } from "./sandbox";

// API 协议（固定三选）
export type ProviderProtocol = "chat-completions" | "anthropic" | "responses";

// 单个模型的独立配置
export interface ModelConfig {
  id: string;
  name: string;            // 发送给 API 的模型名
  contextWindow: number;   // 上下文窗口总 token 上限（如 1048576）
  compactThreshold: number;// 上下文占用告警阈值百分比 0-100，达到即自动 compact；100 = 关闭自动压缩
}

export interface ModelProvider {
  id: string;
  name: string;
  protocol?: ProviderProtocol; // API 协议，默认 chat-completions
  apiBaseUrl: string;
  apiKey: string;
  models: ModelConfig[];       // 一个供应商可配置多个模型
  selectedModelId?: string;    // 当前使用的模型
  isDefault: boolean;
  // 自由参数
  thinkingLevel?: string;      // 思考强度: none/low/medium/high（仅在非 none 时下发 thinking 字段）
  topP?: number;               // top_p
  frequencyPenalty?: number;   // 频率惩罚
  presencePenalty?: number;    // 存在惩罚
  stop?: string;               // 停止序列
  customParams?: string;       // 自定义 JSON 参数
  promptCache?: boolean;       // 发送 prompt_cache_key 提升前缀缓存命中率（OpenAI 兼容）
  glmThinking?: boolean;       // 发送 GLM 系 thinking 字段（仅智谱/GLM 兼容网关支持，默认关闭）
}

export interface AgentSettings {
  providers: ModelProvider[];
  defaultProviderId: string;
  temperature: number;
  maxTokens: number;
  systemPromptExtra: string;
  enabledTools: string[];
  thinkingEnabled: boolean;
  autoToolCalls: boolean;
  contextWindow: number;
  maxToolRounds: number;
  responseStyle: "concise" | "detailed" | "balanced";
  language: "zh" | "en" | "auto";
  safetyMode: SafetyMode;
  autoMemory: boolean; // 每轮结束后自动提炼并保存长期记忆
}

export const DEFAULT_SETTINGS: AgentSettings = {
  providers: [], defaultProviderId: "",
  temperature: 0.6, maxTokens: 4096,
  systemPromptExtra: "", enabledTools: [],
  thinkingEnabled: true,
  autoToolCalls: true,
  contextWindow: 24,
  maxToolRounds: 5,
  responseStyle: "balanced",
  language: "zh",
  safetyMode: "default",
  autoMemory: false,
};

const KEY = "agent_settings";

// 旧格式（单一 model 字符串 / contextLength / protocol:"openai"）→ 新多模型结构
export function normalizeProvider(p: any): ModelProvider {
  const protocol: ProviderProtocol =
    p?.protocol === "anthropic" || p?.protocol === "responses" ? p.protocol : "chat-completions";
  let models: ModelConfig[] = Array.isArray(p?.models) && p.models.length
    ? p.models
        .filter((m: any) => m && (m.name || m.model))
        .map((m: any, i: number) => ({
          id: m.id || `mdl-${p.id}-${i}`,
          name: String(m.name || m.model),
          contextWindow: Number(m.contextWindow) > 0 ? Number(m.contextWindow) : 131072,
          compactThreshold: Number.isFinite(Number(m.compactThreshold)) && Number(m.compactThreshold) >= 0 && Number(m.compactThreshold) <= 100 ? Number(m.compactThreshold) : 70,
        }))
    : [];
  if (models.length === 0 && typeof p?.model === "string" && p.model) {
    models = [{ id: `mdl-${p.id}-legacy`, name: p.model, contextWindow: Number(p?.contextLength) > 0 ? Number(p.contextLength) : 131072, compactThreshold: 70 }];
  }
  const selectedModelId = models.some((m) => m.id === p?.selectedModelId) ? p.selectedModelId : (models[0]?.id ?? "");
  return {
    id: p?.id || `prov-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name: p?.name || "新供应商",
    protocol,
    apiBaseUrl: p?.apiBaseUrl || "",
    apiKey: p?.apiKey || "",
    models,
    selectedModelId,
    isDefault: !!p?.isDefault,
    ...(p?.thinkingLevel !== undefined ? { thinkingLevel: p.thinkingLevel } : {}),
    ...(p?.topP !== undefined ? { topP: p.topP } : {}),
    ...(p?.frequencyPenalty !== undefined ? { frequencyPenalty: p.frequencyPenalty } : {}),
    ...(p?.presencePenalty !== undefined ? { presencePenalty: p.presencePenalty } : {}),
    ...(p?.stop !== undefined ? { stop: p.stop } : {}),
    ...(p?.customParams !== undefined ? { customParams: p.customParams } : {}),
    ...(p?.promptCache !== undefined ? { promptCache: p.promptCache } : {}),
    ...(p?.glmThinking !== undefined ? { glmThinking: p.glmThinking } : {}),
    ...(p?.glmThinking !== undefined ? { glmThinking: p.glmThinking } : {}),
  };
}

function normalizeSettings(raw: any): AgentSettings {
  const merged = { ...DEFAULT_SETTINGS, ...raw };
  const providers = Array.isArray(raw?.providers) ? raw.providers.map(normalizeProvider) : [];
  const safetyMode = raw?.safetyMode === "unrestricted" ? "unrestricted" : "default";
  // 字段级归一化：历史/脏数据里的 null、错误类型会导致运行期崩溃（如 enabledTools.length）
  return {
    ...merged,
    providers,
    safetyMode,
    enabledTools: Array.isArray(merged.enabledTools) ? merged.enabledTools.filter((t: any) => typeof t === "string") : [],
    temperature: typeof merged.temperature === "number" && Number.isFinite(merged.temperature) ? merged.temperature : DEFAULT_SETTINGS.temperature,
    maxTokens: Number.isFinite(Number(merged.maxTokens)) && Number(merged.maxTokens) > 0 ? Number(merged.maxTokens) : DEFAULT_SETTINGS.maxTokens,
    maxToolRounds: Number.isFinite(Number(merged.maxToolRounds)) ? Math.min(Math.max(Number(merged.maxToolRounds), 1), 10) : DEFAULT_SETTINGS.maxToolRounds,
    contextWindow: Number.isFinite(Number(merged.contextWindow)) ? Number(merged.contextWindow) : DEFAULT_SETTINGS.contextWindow,
    thinkingEnabled: typeof merged.thinkingEnabled === "boolean" ? merged.thinkingEnabled : DEFAULT_SETTINGS.thinkingEnabled,
    autoToolCalls: typeof merged.autoToolCalls === "boolean" ? merged.autoToolCalls : DEFAULT_SETTINGS.autoToolCalls,
    responseStyle: merged.responseStyle === "concise" || merged.responseStyle === "detailed" ? merged.responseStyle : "balanced",
    language: merged.language === "en" || merged.language === "auto" ? merged.language : "zh",
    autoMemory: typeof merged.autoMemory === "boolean" ? merged.autoMemory : false,
  };
}

export async function getSettings(): Promise<AgentSettings> {
  const row = await db.setting.findUnique({ where: { key: KEY } }).catch(() => null);
  if (!row) return structuredClone(DEFAULT_SETTINGS);
  try { return normalizeSettings(JSON.parse(row.value)); } catch { return structuredClone(DEFAULT_SETTINGS); }
}

export function maskApiKey(key: string): string {
  if (!key) return "";
  if (key.length <= 8) return "****";
  return `${key.slice(0, 3)}****${key.slice(-4)}`;
}

export function isMaskedApiKey(key: string): boolean {
  // 掩码格式为 前3位+4星+后4位（maskApiKey 输出）；
  // 超短 Key（≤8 字符）掩码后就是 "****"，也必须识别，否则会被当作真实 Key 存回。
  // 仅凭 includes("****") 会把真实 key 里恰好含字面星号的场景误判，故用精确格式匹配。
  return /^(.{3}\*{4}.{4}|\*{4})$/.test(key);
}

export function sanitizeSettings(settings: AgentSettings): AgentSettings {
  return {
    ...settings,
    providers: settings.providers.map((p) => ({ ...p, apiKey: maskApiKey(p.apiKey) })),
  };
}

export async function saveSettings(s: Partial<AgentSettings>): Promise<AgentSettings> {
  const current = await getSettings();
  const incoming = normalizeSettings({ ...current, ...s });

  // 前端只提交掩码/空 Key 时，保留服务端原有 Key，避免被掩码覆盖。
  // 匹配策略：优先 id；id 缺失/变更时按 name+apiBaseUrl 回退匹配，
  // 避免 normalizeProvider 对缺 id 的 provider 生成随机 id 导致旧记录匹配失败、Key 被静默清空。
  if (Array.isArray(s.providers)) {
    incoming.providers = s.providers.map((raw) => {
      const p = normalizeProvider(raw);
      const existing =
        current.providers.find((x) => x.id === p.id) ??
        (p.id ? undefined : current.providers.find((x) => x.name === p.name && x.apiBaseUrl === p.apiBaseUrl)) ??
        current.providers.find((x) => !x.id && x.name === p.name && x.apiBaseUrl === p.apiBaseUrl);
      const keepKey = !p.apiKey || isMaskedApiKey(p.apiKey);
      const mergedId = existing?.id ?? p.id;
      return { ...p, id: mergedId, apiKey: keepKey ? (existing?.apiKey || "") : p.apiKey };
    });
  }

  await db.setting.upsert({
    where: { key: KEY },
    update: { value: JSON.stringify(incoming) },
    create: { key: KEY, value: JSON.stringify(incoming) },
  });
  return incoming;
}

// 供应商/模型解析（客户端安全实现，供服务端复用）
export { resolveProvider, activeModelOf } from "./provider-utils";

// 思考强度选项（与主流 OpenAI 兼容 API 的 thinking.level 取值对齐）
export { THINKING_LEVELS } from "./constants";
