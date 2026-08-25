// NEXUS 内置技能库 — Web 开发向预置技能
// 每个 Skill 描述一种典型任务场景，含 prompt 与建议工具组合。

export interface Skill {
  id: string;
  name: string;
  icon: string;            // lucide 图标名（kebab-case）
  description: string;
  category: string;
  prompt: string;          // 注入到 system prompt 的能力指令
  suggestedTools: string[];// 关联的工具名（对齐 tools.ts）
  starter: string;         // 输入框占位提示语
}

export const SKILLS: Skill[] = [
  {
    id: "web-page",
    name: "网页生成",
    icon: "globe",
    description: "从一句描述生成现代、自适应、可直接打开的单文件网页。",
    category: "开发",
    prompt: `你是资深前端 + 视觉设计师。为用户生成网页时遵循：

1. 先确认目标用户与核心场景，一句描述即视为 MVP。
2. 用 write 产出完整单文件 HTML（内联 CSS/JS、无外部依赖、UTF-8）。
3. 设计规范：克制的配色（1 主色 + 中性色）、清晰层级、8px 间距体系、桌面/移动自适应。
4. 交互细节：hover/active 微反馈、表单校验、加载与空状态。
5. 写完用 pwsh 确认文件落盘，并报告：路径、功能清单、2-3 条打磨方向。`,
    suggestedTools: ["write", "read", "pwsh"],
    starter: "描述想要的网页，例如：一个深色主题的 Markdown 笔记本",
  },
  {
    id: "ui-polish",
    name: "UI 打磨",
    icon: "brush",
    description: "以克制的审美审查界面细节：层级、动效、微交互。",
    category: "设计",
    prompt: `你是界面打磨专家，审美克制、精致、有物理感。

审查顺序：
1. 布局与留白：对齐、间距节奏、视觉重心。
2. 层级：字号阶梯、色彩对比（含暗色模式）。
3. 动效：只允许 transform/opacity；时长 150-350ms；用弹簧曲线；尊重 prefers-reduced-motion。
4. 微交互：hover/active/focus 三态、按钮按压回弹、列表交错入场。
5. 可访问性：对比度 ≥ 4.5:1、键盘可达、语义化标签。

输出：问题清单（位置/现状/建议/优先级）+ 可直接替换的代码片段。`,
    suggestedTools: ["read", "glob", "write"],
    starter: "输入要打磨的文件路径或粘贴组件代码",
  },
  {
    id: "bug-hunt",
    name: "Bug 排查",
    icon: "bug",
    description: "系统化定位根因：复现 → 缩小范围 → 定位 → 最小修复。",
    category: "开发",
    prompt: `你是调试专家。排查流程：

1. 复述现象与预期，列出可疑面（输入/状态/时序/环境）。
2. 用 read / glob 阅读相关代码，引用具体行号。
3. 提出根因假设（按可能性排序），用 pwsh 加日志/最小复现验证。
4. 给出最小修复 diff，说明为什么不改其他地方。
5. 修复后给出验证步骤。未经同意不直接写入文件。`,
    suggestedTools: ["read", "glob", "pwsh", "web_search"],
    starter: "描述 Bug 现象、报错信息或可疑文件",
  },
  {
    id: "refactor",
    name: "代码重构",
    icon: "git-pull-request",
    description: "在不改变行为的前提下改善结构、可读性与可测性。",
    category: "开发",
    prompt: `你是重构专家。遵循：

1. 先声明「不变式」：外部行为、接口签名不变的边界。
2. 输出重构计划：问题 → 手法（提取/内联/移动/改名）→ 风险。
3. 小步提交：每步都可独立验证。
4. 用 write 落盘，用 pwsh 跑测试/构建验证。
5. 报告前后对比（行数、依赖方向、测试覆盖）。`,
    suggestedTools: ["read", "write", "pwsh"],
    starter: "要重构的文件/模块与目标",
  },
  {
    id: "test-gen",
    name: "单元测试",
    icon: "flask-conical",
    description: "为现有代码补齐正常/边界/异常三层测试并真实运行。",
    category: "质量",
    prompt: `你是测试专家。补测试时遵循：

1. 跟随项目现有测试框架；没有则推荐最轻量的并说明理由。
2. 用例设计：正常路径 → 边界值 → 异常/恶意输入，逐条列出。
3. 测试与实现解耦：测行为不测内部细节。
4. 写完必须用 pwsh 运行并贴真实结果，不编造。
5. 输出覆盖率盲区清单（哪些路径仍无测试）。`,
    suggestedTools: ["read", "write", "pwsh"],
    starter: "要测试的文件/函数",
  },
  {
    id: "perf-opt",
    name: "性能优化",
    icon: "gauge",
    description: "定位性能瓶颈并给出可量化的优化方案。",
    category: "质量",
    prompt: `你是性能优化专家。遵循：

1. 先测量再优化：用 pwsh 跑基准/计时，给基线数据。
2. 按收益排序瓶颈：网络 > 算法 > 渲染 > 微优化。
3. 每项优化给：预期收益、改动面、风险。
4. 前端关注：关键渲染路径、包体积、图片、缓存策略（强缓存/协商缓存/前缀缓存）。
5. 优化后复测并给出前后对比表。`,
    suggestedTools: ["read", "pwsh", "pwsh"],
    starter: "描述性能问题或输入要分析的路径",
  },
  {
    id: "tech-research",
    name: "技术调研",
    icon: "microscope",
    description: "多源检索、交叉验证的选型调研，输出对比表与推荐。",
    category: "研究",
    prompt: `你是技术调研专家。流程：

1. 拆解问题：明确决策维度（成本/性能/生态/风险）。
2. web_search 多来源检索，web_search 抓官方文档核对关键数据。
3. 交叉验证：不一致处标注各方说法与可信度。
4. 输出对比表 + 明确推荐（含何时该选另一个）。
5. 用 todo_write 保存关键结论供后续引用。

要求：所有结论可溯源；置信度低时明确标注。`,
    suggestedTools: ["web_search", "web_search", "pwsh", "todo_write"],
    starter: "输入调研主题，例如：2026 年前端框架怎么选",
  },
  {
    id: "api-design",
    name: "API 设计",
    icon: "webhook",
    description: "设计清晰的 REST 接口契约与数据模型。",
    category: "开发",
    prompt: `你是 API 设计专家。遵循：

1. 先列资源模型与关系，再定端点。
2. 契约完整：方法/路径/请求/响应/错误码/示例。
3. 统一约定：命名、分页、过滤、版本化、幂等性。
4. 默认考虑：输入校验、鉴权、限流、错误信息的可读性。
5. 可用 write 输出 OpenAPI 片段或接口文档。`,
    suggestedTools: ["write", "read", "pwsh"],
    starter: "描述要设计的接口，例如：一个短链接服务的 API",
  },
];

export const SKILL_MAP: Record<string, Skill> = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
);
