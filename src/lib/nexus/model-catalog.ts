// 客户端安全的官方模型目录：当服务端 /models 端点不存在（404）或被 CORS/权限挡住时，
// 按地址域名匹配这份目录作为回退，保证"拉取模型"永远有可用结果。
export const MODEL_CATALOG: Record<string, string[]> = {
  "sensenova": ["SenseChat-5", "SenseChat-5-Pro", "SenseChat-Turbo", "SenseNova-V6-Pro", "SenseNova-V6-Turbo"],
  "deepseek": ["deepseek-chat", "deepseek-reasoner"],
  "openai.com": ["gpt-4.1", "gpt-4.1-mini", "gpt-4o", "gpt-4o-mini", "o4-mini"],
  "anthropic": ["claude-sonnet-4-5", "claude-opus-4-1", "claude-haiku-4-5", "claude-3-5-haiku-latest"],
  "moonshot": ["kimi-k2-0711-preview", "kimi-latest", "moonshot-v1-128k", "moonshot-v1-32k", "moonshot-v1-8k"],
  "bigmodel": ["glm-4.6", "glm-4.5", "glm-4.5-air", "glm-4-flash"],
  "dashscope": ["qwen3-max", "qwen-plus", "qwen-max", "qwen-turbo", "qwen-long"],
  "siliconflow": ["deepseek-ai/DeepSeek-V3", "deepseek-ai/DeepSeek-R1", "Qwen/Qwen2.5-72B-Instruct", "Qwen/Qwen2.5-7B-Instruct", "THUDM/glm-4-9b-chat"],
  "openrouter": ["anthropic/claude-sonnet-4.5", "openai/gpt-4o", "openai/gpt-4o-mini", "google/gemini-2.0-flash-001", "deepseek/deepseek-chat", "qwen/qwen-2.5-72b-instruct"],
  "generativelanguage": ["gemini-2.5-pro", "gemini-2.5-flash", "gemini-2.0-flash", "gemini-1.5-pro"],
  "11434": ["llama3.2", "qwen2.5:7b", "deepseek-r1:8b", "gemma2:9b"],
  "groq": ["llama-3.3-70b-versatile", "llama-3.1-8b-instant", "qwen-2.5-32b"],
  "mistral": ["mistral-large-latest", "mistral-small-latest", "codestral-latest"],
  "x.ai": ["grok-3", "grok-3-mini", "grok-2-latest"],
};

// 按 URL 域名匹配目录（子串匹配，如 api.sensenova.cn 命中 "sensenova"）
export function catalogForUrl(url: string): string[] {
  try {
    const host = new URL(url).hostname;
    for (const [key, models] of Object.entries(MODEL_CATALOG)) {
      if (host.includes(key)) return models;
    }
  } catch {}
  return [];
}
