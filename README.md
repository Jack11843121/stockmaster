# 股票大师 · StockMaster

> **一站式 A 股 / 港股智能投研终端** —— 把「行情、涨停跌停、右侧机会、策略回测、宏观研判、AI 投顾」装进一块看板，数据与决策一体化，每日自动成文。

StockMaster 是一个 DeepSeek Harness（Cordis）插件，运行在你的 Harness 左侧菜单里，面向 A 股（含港股）做**盘中实时 + 盘后复盘**的量化投研。

---

## ✨ 核心能力

| 模块 | 说明 |
| --- | --- |
| 📊 **涨跌停扫描** | 自动抓取当日涨停/跌停池：连板数、封单资金、炸板次数、封板时间、行业、市值，逐只给出「再次涨停概率 / 反转概率」 |
| 🎯 **右侧机会挖掘** | 全市场 5500+ 只，按 60 日 + 20 日表现 + 均线结构，产出「超跌反转候选」与「右侧趋势候选」+ 概率分 |
| 💰 **涨停板策略回测** | 「涨停次日追涨」规则化回测（+5% 止盈 / -5% 止损 / 5 日时间止损），给出胜率、盈亏比、逐笔记录 |
| 🧠 **宏观与市场动态** | 抓取 7×24 快讯，AI 输出政策 / 行业 / 资金 / A港股联动 / 新动向的深度研判 |
| 🤖 **AI 对话投顾「杰克」** | 有记忆、有记录、用数据说话的投研顾问，可针对看板数据连续追问 |
| 📈 **个股详情** | 点击任意股票名：公司介绍 + 基本面 + K 线（分时 / 日K / 月K 蜡烛图）+ 财报趋势 + 公告 |
| 📋 **历史看板** | SQLite 自动归档每个交易日，可回看、逐日对比 |
| 🗂️ **自选持仓** | 自定义跟踪股票，实时行情 + AI 点评 |
| ⚙️ **自带大模型 Key** | 支持 OpenAI 兼容接口（DeepSeek / 通义 / OpenAI / Moonshot…），填入你的 Key 即可完全自托管 |

## 🚀 安装（快速开始）

### 前置要求

- 已安装 **DeepSeek Harness（DSH）** 桌面版或 Web 版（本插件挂载在它的左侧菜单区）。
- DSH 自带的 Node 版本需 **≥ 22.5**（插件用到 Node 内置 `node:sqlite`，22.5 以下会加载失败）。
- **无需任何行情数据 Key**：行情来自东方财富公开接口；只有「AI 分析」默认用 DSH 内置模型，也可自配 Key（见下文）。

### 第 1 步：下载源码

```bash
git clone https://github.com/Jack11843121/stockmaster.git
cd stockmaster
```

### 第 2 步：安装 bundle

把整个目录作为 bundle 安装进 DSH。任选一种方式：

**方式 A · 让 Agent 帮你装（最省事）**
在 DSH 里新建一个对话，对 Agent 说：

> 请安装这个插件 bundle：`/你克隆到的绝对路径/stockmaster`

Agent 会执行 `plugin_manager install_bundle` 完成安装。

**方式 B · Web GUI 插件页**
打开 DSH 左侧「插件」页面 → 安装（Install）→ 输入/选择本地目录 `stockmaster` 的绝对路径，确认安装。

**方式 C · 命令行（若你的 dsh 支持）**
```bash
plugin_manager install_bundle /绝对路径/stockmaster
```

### 第 3 步：打开看板

安装完成后**刷新页面**，左侧菜单会出现「**股票大师**」入口，点进去即可。

### 第 4 步（可选）· 配置你自己的大模型 Key

默认 AI 分析用 DSH 内置模型；想完全自托管就配自己的 Key：

1. 看板顶部点「**模型配置**」；
2. 填 API 地址（如 `https://api.deepseek.com`）、模型名（如 `deepseek-chat`）、API Key；
3. 保存。AI 分析与宏观研判即走你的模型，失败自动回退内置。

> 支持任何 OpenAI 兼容接口：DeepSeek、通义千问、Moonshot、智谱、OpenAI 等。

## 📁 数据目录

- 默认：`~/.stockmaster`
- 可用环境变量覆盖：`STOCK_DASHBOARD_DATA_DIR=/path/to/dir`

数据包含行情快照、报告、SQLite 历史库（`dashboard.db`）等，均为运行时生成，已加入 `.gitignore`。

## 🧩 技术栈

- **前端**：React（Harness 主题令牌）+ SVG 蜡烛图/折线图
- **后端**：Cordis 插件（Node ESM）+ `node:sqlite`（历史/记忆存储）
- **数据**：东方财富公开接口（涨停/跌停池、指数 K 线、个股 F10、7×24 快讯、全市场行情）
- **AI**：Harness Agent 模型 / 自带 OpenAI 兼容 Key（自动回退）

## 📂 目录结构

```
.
├── index.js            # Host 侧：数据服务、Agent 工具、HTTP 接口
├── client.js           # Client 侧：看板 UI（面板 + 图表 + 弹窗）
├── lib/
│   ├── market.js       # 行情/F10/回测/筛选 数据引擎
│   └── store.js        # SQLite 历史与对话记忆
├── cordis.patch.yml    # bundle 声明
├── locale/             # 多语言标题与描述
└── icon.svg            # 图标
```

## ⚠️ 免责声明

本项目仅用于**研究与教育**，所有行情、概率、回测与 AI 观点均为数据驱动的参考，**不构成任何投资建议**。股市有风险，据此操作盈亏自负。

## 📄 License

[MIT](./LICENSE)