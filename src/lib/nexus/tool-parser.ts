// 工具调用解析：兼容 ```json 代码块、裸 JSON、arguments 为字符串等格式。
export interface ParsedToolCall {
  name: string;
  arguments: Record<string, any>;
}

// 从文本中提取所有“看起来像 JSON 对象”的完整片段（支持嵌套大括号）。
function extractJsonObjectCandidates(content: string): string[] {
  const candidates: string[] = [];
  for (let i = 0; i < content.length; i++) {
    if (content[i] !== "{") continue;
    let depth = 0;
    let inString = false;
    let escaped = false;
    for (let j = i; j < content.length; j++) {
      const ch = content[j];
      if (inString) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') inString = false;
        continue;
      }
      if (ch === '"') { inString = true; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) {
          candidates.push(content.slice(i, j + 1));
          i = j;
          break;
        }
      }
    }
  }
  return candidates;
}

export function parseToolCallsFromText(content: string): ParsedToolCall[] | null {
  const calls: ParsedToolCall[] = [];
  const candidates = extractJsonObjectCandidates(content);

  for (const raw of candidates) {
    let inner = raw.trim();
    // 去掉可能包裹的 ```json 围栏
    inner = inner.replace(/^```(?:json)?\s*/, "").replace(/\s*```$/, "").trim();
    try {
      const obj = JSON.parse(inner);
      if (obj && typeof obj === "object" && (obj.tool || obj.name)) {
        const name = String(obj.tool || obj.name);
        let args: Record<string, any>;
        if (obj.args && typeof obj.args === "object" && Object.keys(obj.args).length > 0) args = obj.args;
        else if (obj.arguments && typeof obj.arguments === "object") args = obj.arguments;
        else if (typeof obj.arguments === "string") {
          try { args = JSON.parse(obj.arguments); } catch { args = { raw: obj.arguments }; }
        } else if (obj.args && typeof obj.args === "object") args = obj.args;
        else { const { tool, name: _n, ...rest } = obj; args = rest; }
        calls.push({ name, arguments: args });
      }
    } catch {}
  }
  return calls.length ? calls : null;
}
