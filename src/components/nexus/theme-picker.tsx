"use client";
import { Palette, Check } from "lucide-react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger,
} from "@/components/ui/dialog";
import { useTheme, THEMES, type ThemeName } from "@/hooks/nexus/use-theme";
import { cn } from "@/lib/utils";
import { useState } from "react";

export function ThemePicker({ compact }: { compact?: boolean }) {
  const { theme, changeTheme } = useTheme();
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <span
          className="p-2 rounded-md hover:bg-sidebar-accent text-sidebar-foreground/80 hover:text-foreground transition-colors cursor-pointer inline-flex"
          title="切换主题"
        >
          <Palette className="w-4 h-4" />
        </span>
      </DialogTrigger>
      <DialogContent className="sm:max-w-md" aria-describedby={undefined}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2 text-sm">
            <Palette className="w-4 h-4 text-nx-brand" /> 选择主题
          </DialogTitle>
        </DialogHeader>
        <div className="grid grid-cols-1 gap-2 py-2">
          {THEMES.map((t) => (
            <button
              key={t.name}
              onClick={() => { changeTheme(t.name as ThemeName); setOpen(false); }}
              className={cn(
                "flex items-center gap-3 rounded-lg border p-3 transition-colors text-left",
                theme === t.name ? "border-nx-brand ring-1 ring-nx-brand bg-nx-brand/5" : "border-border hover:bg-accent"
              )}
            >
              {/* 预览色块 */}
              <div className="flex shrink-0">
                {t.preview.map((c, i) => (
                  <div
                    key={i}
                    className={cn("w-6 h-6 rounded-full border-2 border-background", i > 0 && "-ml-2")}
                    style={{ backgroundColor: c }}
                  />
                ))}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-medium">{t.label}</div>
                <div className="text-[10px] text-muted-foreground">{t.name}</div>
              </div>
              {theme === t.name && <Check className="w-4 h-4 text-nx-brand shrink-0" />}
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
