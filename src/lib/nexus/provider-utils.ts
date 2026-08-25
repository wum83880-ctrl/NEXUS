// 客户端安全的供应商解析工具（仅类型依赖，不引入 Prisma）
import type { AgentSettings, ModelProvider, ModelConfig } from "./settings";

export function resolveProvider(settings: AgentSettings): ModelProvider | null {
  // 优先级：defaultProviderId → isDefault 标记 → 第一个 Provider
  const byId = settings.providers.find((p) => p.id === settings.defaultProviderId);
  return byId ?? settings.providers.find((p) => p.isDefault) ?? settings.providers[0] ?? null;
}

// 当前生效的模型配置（选中模型 → 第一个模型）
export function activeModelOf(provider: ModelProvider | null): ModelConfig | null {
  if (!provider) return null;
  return provider.models.find((m) => m.id === provider.selectedModelId) ?? provider.models[0] ?? null;
}
