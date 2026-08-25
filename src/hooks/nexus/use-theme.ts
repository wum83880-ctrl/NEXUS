"use client";
import { useEffect, useState, useCallback } from "react";

export type ThemeName = "tokyo-night" | "forest" | "light" | "midnight" | "solarized";

interface ThemeConfig {
  name: string;
  label: string;
  preview: string[]; // 3 colors for preview
}

export const THEMES: ThemeConfig[] = [
  { name: "tokyo-night", label: "东京之夜", preview: ["#1a1b26", "#7aa2f7", "#9ece6a"] },
  { name: "forest", label: "墨绿森林", preview: ["#1e2326", "#a6e3a1", "#89dceb"] },
  { name: "midnight", label: "午夜深蓝", preview: ["#0f172a", "#3b82f6", "#818cf8"] },
  { name: "light", label: "明亮白昼", preview: ["#f8fafc", "#2563eb", "#7c3aed"] },
  { name: "solarized", label: "暖阳", preview: ["#073642", "#268bd2", "#b58900"] },
];

const THEME_CSS_VARS: Record<ThemeName, Record<string, string>> = {
  "tokyo-night": {
    "--nx-bg-base": "#1a1b26", "--nx-bg-elevated": "#24253a", "--nx-bg-sunken": "#14151f",
    "--nx-brand": "#7aa2f7", "--nx-brand-2": "#bb9af7", "--nx-success": "#9ece6a",
    "--nx-warn": "#e0af68", "--nx-error": "#f7768e", "--nx-cyan": "#7dcfff",
    "--background": "#1a1b26", "--foreground": "#c0caf5", "--card": "#24253a",
    "--card-foreground": "#c0caf5", "--popover": "#1f2034", "--popover-foreground": "#c0caf5",
    "--primary": "#7aa2f7", "--primary-foreground": "#1a1b26", "--secondary": "#2e2f48",
    "--secondary-foreground": "#c0caf5", "--muted": "#1f2034", "--muted-foreground": "#565f89",
    "--accent": "#2e2f48", "--accent-foreground": "#c0caf5", "--destructive": "#f7768e",
    "--border": "#414868", "--input": "#414868", "--ring": "#7aa2f7",
    "--sidebar": "#14151f", "--sidebar-foreground": "#a9b1d6",
    "--sidebar-primary": "#7aa2f7", "--sidebar-primary-foreground": "#1a1b26",
    "--sidebar-accent": "#2e2f48", "--sidebar-accent-foreground": "#c0caf5",
    "--sidebar-border": "#414868", "--sidebar-ring": "#7aa2f7",
  },
  "forest": {
    "--nx-bg-base": "#1e2326", "--nx-bg-elevated": "#2d3437", "--nx-bg-sunken": "#161a1c",
    "--nx-brand": "#a6e3a1", "--nx-brand-2": "#89dceb", "--nx-success": "#a6e3a1",
    "--nx-warn": "#f9e2af", "--nx-error": "#f38ba8", "--nx-cyan": "#89dceb",
    "--background": "#1e2326", "--foreground": "#cdd6f4", "--card": "#2d3437",
    "--card-foreground": "#cdd6f4", "--popover": "#252a2d", "--popover-foreground": "#cdd6f4",
    "--primary": "#a6e3a1", "--primary-foreground": "#1e2326", "--secondary": "#363f42",
    "--secondary-foreground": "#cdd6f4", "--muted": "#252a2d", "--muted-foreground": "#6b7280",
    "--accent": "#363f42", "--accent-foreground": "#cdd6f4", "--destructive": "#f38ba8",
    "--border": "#424a4d", "--input": "#424a4d", "--ring": "#a6e3a1",
    "--sidebar": "#161a1c", "--sidebar-foreground": "#bac2de",
    "--sidebar-primary": "#a6e3a1", "--sidebar-primary-foreground": "#1e2326",
    "--sidebar-accent": "#363f42", "--sidebar-accent-foreground": "#cdd6f4",
    "--sidebar-border": "#424a4d", "--sidebar-ring": "#a6e3a1",
  },
  "midnight": {
    "--nx-bg-base": "#0f172a", "--nx-bg-elevated": "#1e293b", "--nx-bg-sunken": "#020617",
    "--nx-brand": "#3b82f6", "--nx-brand-2": "#818cf8", "--nx-success": "#22c55e",
    "--nx-warn": "#fbbf24", "--nx-error": "#ef4444", "--nx-cyan": "#06b6d4",
    "--background": "#0f172a", "--foreground": "#e2e8f0", "--card": "#1e293b",
    "--card-foreground": "#e2e8f0", "--popover": "#1e293b", "--popover-foreground": "#e2e8f0",
    "--primary": "#3b82f6", "--primary-foreground": "#ffffff", "--secondary": "#334155",
    "--secondary-foreground": "#e2e8f0", "--muted": "#1e293b", "--muted-foreground": "#94a3b8",
    "--accent": "#334155", "--accent-foreground": "#e2e8f0", "--destructive": "#ef4444",
    "--border": "#334155", "--input": "#334155", "--ring": "#3b82f6",
    "--sidebar": "#020617", "--sidebar-foreground": "#cbd5e1",
    "--sidebar-primary": "#3b82f6", "--sidebar-primary-foreground": "#ffffff",
    "--sidebar-accent": "#1e293b", "--sidebar-accent-foreground": "#e2e8f0",
    "--sidebar-border": "#1e293b", "--sidebar-ring": "#3b82f6",
  },
  "light": {
    "--nx-bg-base": "#f8fafc", "--nx-bg-elevated": "#ffffff", "--nx-bg-sunken": "#f1f5f9",
    "--nx-brand": "#2563eb", "--nx-brand-2": "#7c3aed", "--nx-success": "#16a34a",
    "--nx-warn": "#d97706", "--nx-error": "#dc2626", "--nx-cyan": "#0891b2",
    "--background": "#f8fafc", "--foreground": "#1e293b", "--card": "#ffffff",
    "--card-foreground": "#1e293b", "--popover": "#ffffff", "--popover-foreground": "#1e293b",
    "--primary": "#2563eb", "--primary-foreground": "#ffffff", "--secondary": "#e2e8f0",
    "--secondary-foreground": "#1e293b", "--muted": "#f1f5f9", "--muted-foreground": "#64748b",
    "--accent": "#e2e8f0", "--accent-foreground": "#1e293b", "--destructive": "#dc2626",
    "--border": "#cbd5e1", "--input": "#cbd5e1", "--ring": "#2563eb",
    "--sidebar": "#f1f5f9", "--sidebar-foreground": "#475569",
    "--sidebar-primary": "#2563eb", "--sidebar-primary-foreground": "#ffffff",
    "--sidebar-accent": "#e2e8f0", "--sidebar-accent-foreground": "#1e293b",
    "--sidebar-border": "#cbd5e1", "--sidebar-ring": "#2563eb",
  },
  "solarized": {
    "--nx-bg-base": "#073642", "--nx-bg-elevated": "#0d4a52", "--nx-bg-sunken": "#052830",
    "--nx-brand": "#268bd2", "--nx-brand-2": "#d33682", "--nx-success": "#859900",
    "--nx-warn": "#b58900", "--nx-error": "#dc322f", "--nx-cyan": "#2aa198",
    "--background": "#073642", "--foreground": "#93a1a1", "--card": "#0d4a52",
    "--card-foreground": "#93a1a1", "--popover": "#0d4a52", "--popover-foreground": "#93a1a1",
    "--primary": "#268bd2", "--primary-foreground": "#073642", "--secondary": "#13555f",
    "--secondary-foreground": "#93a1a1", "--muted": "#0a3d48", "--muted-foreground": "#586e75",
    "--accent": "#13555f", "--accent-foreground": "#93a1a1", "--destructive": "#dc322f",
    "--border": "#1a6068", "--input": "#1a6068", "--ring": "#268bd2",
    "--sidebar": "#052830", "--sidebar-foreground": "#839496",
    "--sidebar-primary": "#268bd2", "--sidebar-primary-foreground": "#073642",
    "--sidebar-accent": "#13555f", "--sidebar-accent-foreground": "#93a1a1",
    "--sidebar-border": "#1a6068", "--sidebar-ring": "#268bd2",
  },
};

function applyTheme(theme: ThemeName) {
  const root = document.documentElement;
  const vars = THEME_CSS_VARS[theme];
  if (!vars) return;
  // 清除旧主题
  root.classList.remove("dark", "light");
  if (theme === "light") root.classList.add("light");
  else root.classList.add("dark");
  // 应用 CSS 变量
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }
}

export function useTheme() {
  const [theme, setTheme] = useState<ThemeName>("tokyo-night");

  useEffect(() => {
    const saved = localStorage.getItem("nexus-theme") as ThemeName | null;
    const initial = saved && THEMES.find((t) => t.name === saved) ? saved : "tokyo-night";
    const t = setTimeout(() => { setTheme(initial); applyTheme(initial); }, 0);
    return () => clearTimeout(t);
  }, []);

  const changeTheme = useCallback((t: ThemeName) => {
    setTheme(t);
    applyTheme(t);
    localStorage.setItem("nexus-theme", t);
  }, []);

  return { theme, changeTheme };
}
