#!/bin/bash
# NEXUS 一键安装 (Linux/macOS)
set -e

echo "╔══════════════════════════════════════╗"
echo "║    NEXUS 一键安装 (Linux/macOS)      ║"
echo "╚══════════════════════════════════════╝"
echo

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# 检查 Node.js（唯一硬依赖，npm 随附）
if ! command -v node &> /dev/null; then
    echo "[X] 未检测到 Node.js，请先安装 Node.js 18+"
    echo "    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -"
    echo "    sudo apt-get install -y nodejs"
    exit 1
fi
echo "[OK] Node.js: $(node --version)"

# 安装依赖（npm 即可，不强制 bun）
echo "[1/4] 安装主项目依赖..."
npm install --no-audit --no-fund

echo "[2/4] 安装流式服务依赖..."
(cd mini-services/nexus-stream && npm install --no-audit --no-fund)

echo "[3/4] 初始化数据库 + 编译 stream 服务..."
node scripts/nexus.mjs setup

echo "[4/4] 创建一键启动脚本 start-nexus.sh..."
cat > start-nexus.sh << 'EOF'
#!/bin/bash
cd "$(dirname "$0")"
echo "正在启动 NEXUS，就绪后会自动打开浏览器..."
node scripts/nexus.mjs web
EOF
chmod +x start-nexus.sh

echo
echo "╔══════════════════════════════════════╗"
echo "║            安装完成！                ║"
echo "╠══════════════════════════════════════╣"
echo "║ 以后使用：./start-nexus.sh           ║"
echo "║ 或在命令行运行: ./nexus web          ║"
echo "║ 访问: http://localhost:3000          ║"
echo "║                                      ║"
echo "║ 首次使用请先配置 AI 供应商：         ║"
echo "║ 页面右上角 设置 → 添加供应商         ║"
echo "╚══════════════════════════════════════╝"

read -p "现在要立即启动 NEXUS 吗？(Y/N): " LAUNCH
if [[ "$LAUNCH" =~ ^[Yy] ]]; then
    node scripts/nexus.mjs web
else
    echo "已跳过。之后运行 ./start-nexus.sh 启动。"
fi
