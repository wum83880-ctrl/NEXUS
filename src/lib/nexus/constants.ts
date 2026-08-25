// 客户端安全的共享常量（不引入 Prisma/DB，可在任意组件中 import）

// 思考强度选项（与主流 OpenAI 兼容 API 的 thinking.level 取值对齐）
export const THINKING_LEVELS = [
  { value: "none", label: "关闭", desc: "不使用思考" },
  { value: "low", label: "低", desc: "快速思考" },
  { value: "medium", label: "中", desc: "平衡思考" },
  { value: "high", label: "高", desc: "深度思考" },
];

// 上下文长度预设（tokens）
export const CONTEXT_LENGTH_PRESETS = [
  { value: 8192, label: "8K" },
  { value: 32768, label: "32K" },
  { value: 131072, label: "128K" },
  { value: 262144, label: "256K" },
  { value: 524288, label: "512K" },
  { value: 1048576, label: "1M" },
];

// API 协议（固定三选），value 对齐 settings.ts 的 ProviderProtocol
export const PROTOCOLS: { value: "chat-completions" | "anthropic" | "responses"; label: string; desc: string }[] = [
  { value: "chat-completions", label: "Chat Completions", desc: "/chat/completions · OpenAI 标准对话接口" },
  { value: "anthropic", label: "Anthropic Messages", desc: "/v1/messages · Claude 原生接口" },
  { value: "responses", label: "Responses", desc: "/responses · OpenAI Responses 新版接口" },
];
