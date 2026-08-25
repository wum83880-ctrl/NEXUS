"use client";
// NEXUS 快照面板：手动创建快照、查看历史、恢复到任意快照（就地重载，不刷页面）。
import { useCallback, useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Camera, History, Loader2, Plus, RotateCcw, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription,
} from "@/components/ui/dialog";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { selectSession } from "./app-frame";
import { cn } from "@/lib/utils";

interface SnapshotItem {
  id: string;
  sessionId: string | null;
  roomId: string | null;
  label: string;
  reason: string;
  turn: number | null;
  eventSeq: number | null;
  createdAt: string;
}

export function SnapshotDialog({
  sessionId, open, onOpenChange,
}: {
  sessionId: string | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
}) {
  const [snapshots, setSnapshots] = useState<SnapshotItem[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoringId, setRestoringId] = useState<string | null>(null);
  const { toast } = useToast();

  const load = useCallback(async () => {
    if (!sessionId) return;
    setLoading(true);
    try {
      const res = await fetch(`/api/snapshots?sessionId=${encodeURIComponent(sessionId)}`);
      const data = await res.json();
      setSnapshots(data.snapshots || []);
    } catch {
      toast({ title: "加载快照失败", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [sessionId, toast]);

  useEffect(() => {
    if (open && sessionId) load();
  }, [open, sessionId, load]);

  const create = async () => {
    if (!sessionId || creating) return;
    setCreating(true);
    try {
      const res = await fetch("/api/snapshots", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sessionId, label: "手动快照", reason: "manual" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      toast({ title: "快照已创建", description: data.snapshot?.id });
      await load();
    } catch (err: any) {
      toast({ title: "创建快照失败", description: err?.message, variant: "destructive" });
    } finally {
      setCreating(false);
    }
  };

  const restore = async (snapshot: SnapshotItem) => {
    if (!confirm(`确定恢复到快照「${snapshot.label}」吗？会话事件将回滚到 #${snapshot.eventSeq ?? "—"}，项目文件还原到快照时刻。`)) return;
    setRestoringId(snapshot.id);
    try {
      const res = await fetch(`/api/snapshots/${snapshot.id}/restore`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "恢复失败");
      toast({
        title: "已恢复",
        description: `回滚 ${data.rolledBackEvents ?? 0} 条事件 · 还原 ${data.restoredFiles ?? 0} 个文件`,
      });
      onOpenChange(false);
      if (sessionId) await selectSession(sessionId);
    } catch (err: any) {
      toast({ title: "恢复失败", description: err?.message, variant: "destructive" });
    } finally {
      setRestoringId(null);
    }
  };

  const remove = async (snapshot: SnapshotItem) => {
    if (!confirm(`确定删除快照「${snapshot.label}」吗？`)) return;
    try {
      const res = await fetch(`/api/snapshots/${snapshot.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("删除失败");
      toast({ title: "快照已删除" });
      await load();
    } catch (err: any) {
      toast({ title: "删除失败", description: err?.message, variant: "destructive" });
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg max-h-[80vh] flex flex-col" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Camera className="size-4 text-nx-brand" /> 快照与回溯</DialogTitle>
          <DialogDescription className="sr-only">创建和恢复项目快照</DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-2">
          <Button size="sm" className="nx-brand-grad border-0 text-white" onClick={create} disabled={creating || !sessionId}>
            {creating ? <Loader2 className="size-3.5 animate-spin" /> : <Plus className="size-3.5" />}
            创建快照
          </Button>
          <span className="text-[11px] text-muted-foreground">危险工具执行前会自动创建快照</span>
        </div>

        <ScrollArea className="flex-1 min-h-0 mt-3">
          {loading ? (
            <div className="flex items-center justify-center py-10 text-muted-foreground">
              <Loader2 className="size-4 animate-spin mr-2" /> 加载中…
            </div>
          ) : snapshots.length === 0 ? (
            <div className="text-center py-10 text-sm text-muted-foreground">
              <History className="size-6 mx-auto mb-2 opacity-50" />
              暂无快照
            </div>
          ) : (
            <div className="space-y-2 pr-2">
              {snapshots.map((s) => (
                <div key={s.id} className={cn("rounded-lg border border-border bg-card/60 p-3")}>
                  <div className="flex items-center gap-2 mb-1">
                    <Camera className="size-3.5 text-nx-brand shrink-0" />
                    <span className="text-sm font-medium truncate">{s.label}</span>
                    <Badge variant="outline" className="text-[9px] px-1.5 py-0">{s.reason}</Badge>
                    <span className="ml-auto text-[10px] text-muted-foreground shrink-0">
                      {new Date(s.createdAt).toLocaleString("zh-CN")}
                    </span>
                  </div>
                  <div className="text-[10px] text-muted-foreground mb-2 flex items-center gap-2 flex-wrap">
                    <span>轮次 {s.turn ?? "—"}</span>
                    <span>· 事件 {s.eventSeq ?? "—"}</span>
                    {(s as any).eventCount != null && <span>· 内容 {(s as any).eventCount} 事件 / {(s as any).fileCount ?? 0} 文件</span>}
                    <span className="font-mono">· {s.id.slice(0, 8)}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Button size="sm" variant="outline" className="h-7 text-[11px]" onClick={() => restore(s)} disabled={restoringId === s.id}>
                      {restoringId === s.id ? <Loader2 className="size-3 animate-spin" /> : <RotateCcw className="size-3" />}
                      恢复到此
                    </Button>
                    <Button size="sm" variant="ghost" className="h-7 text-[11px] hover:text-destructive" onClick={() => remove(s)}>
                      <Trash2 className="size-3" />
                      删除
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}
