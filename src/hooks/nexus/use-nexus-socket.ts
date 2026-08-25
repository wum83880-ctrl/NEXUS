"use client";
import { useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { useNexus } from "./use-nexus";
import { nexusSocketUrl } from "@/lib/nexus/socket-url";
import { getClientToken } from "@/lib/nexus/client-token";
import type { ClientMessage, ServerMessage } from "@/lib/nexus/types";

// 会话重载：动态 import 避免与 app-frame 的循环依赖。
// 只在会话仍处于活跃态且没有新一轮开始时执行，防止过期响应覆盖新状态。
let reloadToken = 0;
async function reloadSession(sessionId: string) {
  const token = ++reloadToken;
  const st = useNexus.getState();
  if (st.activeSessionId !== sessionId) return;
  if (st.runStatus === "running") return; // 新一轮已开始，跳过
  try {
    const { selectSession } = await import("../../components/nexus/app-frame");
    if (token !== reloadToken) return;
    const before = useNexus.getState().runStatus;
    await selectSession(sessionId);
    if (token !== reloadToken) return;
    // 重载期间若新一轮已启动，保持 running 语义由 chat:started 维护
    if (useNexus.getState().runStatus === "idle" && before === "running") {
      useNexus.getState().setRunStatus("idle");
    }
  } catch {
    // 重载失败不影响主流程（会话数据以 REST 为准）
  }
}

export function useNexusSocket() {
  const socketRef = useRef<Socket | null>(null);
  // hello 竞态保护：服务端 handler 注册完才发 hello，此前缓存所有待发消息
  const helloRef = useRef(false);
  const pendingRef = useRef<ClientMessage[]>([]);

  useEffect(() => {
    const token = getClientToken();
    const socket = io(nexusSocketUrl(), {
      path: "/", transports: ["websocket", "polling"],
      forceNew: true, reconnection: true, reconnectionAttempts: Infinity,
      reconnectionDelay: 1000, timeout: 10000,
      ...(token ? { auth: { token } } : {}),
    });
    socketRef.current = socket;

    const onMsg = (m: ServerMessage) => {
      const store = useNexus.getState();
      switch (m.type) {
        case "hello": {
          store.setSocketConnected(true);
          if (helloRef.current) break;
          helloRef.current = true;
          const pending = pendingRef.current; pendingRef.current = [];
          for (const m of pending) socketRef.current?.emit(m.type, m);
          break;
        }
        case "session:updated": store.setSessionTitle(m.sessionId, m.title); break;
        case "chat:started": store.setRunStatus("running", m.turn); store.setLastError(null); break;
        case "chat:done": {
          store.setRunStatus("idle", m.turn);
          // 完成后重载会话：live 事件 seq 恒为 -1，时间轴/检查点/快照需要真实 seq 才会更新
          reloadSession(m.sessionId);
          // 排队消息自动发送
          const q = useNexus.getState().queuedMessage;
          if (q) {
            useNexus.getState().setQueuedMessage(null);
            socketRef.current?.emit("chat:run", { sessionId: m.sessionId, message: q, turn: m.turn + 1 });
          }
          break;
        }
        case "chat:error": {
          store.setRunStatus("error", m.turn);
          store.setLastError(m.error || "未知错误");
          // 出错后重载会话：runTurn 可能已写入部分事件（工具结果/错误），实时态需与服务端对齐
          reloadSession(m.sessionId);
          break;
        }
        case "chat:stopped": {
          store.setRunStatus("stopped", m.turn);
          // 用户主动停止：清空排队消息，避免意外自动发送
          useNexus.getState().setQueuedMessage(null);
          reloadSession(m.sessionId).then(() => {
            // 重载会把 runStatus 复位为 idle，这里恢复"已停止"标识
            useNexus.getState().setRunStatus("stopped", m.turn);
          });
          break;
        }
        case "event": store.applyLiveEvent(m.event); break;
      }
    };
    const types: ServerMessage["type"][] = ["hello", "session:updated", "ping", "chat:started", "chat:done", "chat:error", "chat:stopped", "event"];
    for (const t of types) socket.on(t, (payload: any) => onMsg({ type: t, ...payload } as ServerMessage));

    socket.on("disconnect", () => {
      useNexus.getState().setSocketConnected(false);
      useNexus.getState().setReconnecting(true);
      // 断线时收不到 chat:done/error/stopped：不复位会永久卡"运行中"
      if (useNexus.getState().runStatus === "running") {
        useNexus.getState().setRunStatus("idle");
      }
    });
    socket.on("connect", () => { useNexus.getState().setSocketConnected(true); useNexus.getState().setReconnecting(false); });
    socket.on("reconnect_attempt", (attempt: number) => { useNexus.getState().setReconnectAttempt(attempt); });

    return () => { socket.disconnect(); socketRef.current = null; };
  }, []);

  const send = (m: ClientMessage) => {
    if (!helloRef.current) {
      pendingRef.current.push(m);
      return;
    }
    socketRef.current?.emit(m.type, m);
  };

  useEffect(() => {
    useNexus.getState().setSend(send);
    return () => useNexus.getState().setSend(null);
  }, []);

  return { send, socket: socketRef };
}
