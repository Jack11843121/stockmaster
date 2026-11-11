/**
 * Host half of the stock-dashboard bundle.
 *  - Collects A-share/HK market data (涨停/跌停池、指数、持仓、市场宽度、右侧机会) from
 *    free Eastmoney endpoints and stores snapshots / report / swing JSON.
 *  - Registers agent tools so the daily scheduled analysis can fetch, screen and
 *    publish a structured report using the CURRENT agent's own model/persona.
 *  - Serves an HTTP bridge (`/stock-dashboard/*`) for the left-sidebar UI: state,
 *    live refresh, portfolio configuration, stock search, and an AI Q&A chat.
 *  @module @local/dsh-stock-dashboard
 */
import path from 'node:path'
import os from 'node:os'
import { promises as fsp } from 'node:fs'
import {
  collectSnapshot, screenRightSide, searchStocks, fetchStockDetail, fetchStockDetails, fetchStockDetailFull, backtestStrategy, fetchMacroNews, HOLDINGS, INDICES,
  isTradingWindow,
} from './lib/market.js'
import { createStore } from './lib/store.js'

export const inject = ['tools']
export const name = 'dsh-stock-dashboard'

const DATA_DIR = process.env.STOCK_DASHBOARD_DATA_DIR || path.join(os.homedir(), '.stockmaster')
const SNAPSHOT_FILE = path.join(DATA_DIR, 'snapshot.json')
const REPORT_FILE = path.join(DATA_DIR, 'report.json')
const SWING_FILE = path.join(DATA_DIR, 'swing.json')
const BACKTEST_FILE = path.join(DATA_DIR, 'backtest.json')
const PORTFOLIO_FILE = path.join(DATA_DIR, 'portfolio.json')
const STRATEGY_FILE = path.join(DATA_DIR, 'strategy.json')
const MACRO_FILE = path.join(DATA_DIR, 'macro.json')
const LLM_CONFIG_FILE = path.join(DATA_DIR, 'llm-config.json')

/** 最近一次全量抓取的涨跌家数（盘中快速刷新时复用，避免频繁全市场分页） */
let cachedBreadth = null

/** 个股详情最近结果缓存（避免短时间内重复请求东财 F10） */
const detailCache = new Map()

async function readJson(file) {
  try { return JSON.parse(await fsp.readFile(file, 'utf8')) }
  catch { return null }
}
async function writeJson(file, obj) {
  await fsp.mkdir(DATA_DIR, { recursive: true })
  const tmp = file + '.tmp'
  await fsp.writeFile(tmp, JSON.stringify(obj, null, 2))
  await fsp.rename(tmp, file)
}

async function readPortfolio() {
  const p = await readJson(PORTFOLIO_FILE)
  if (p && Array.isArray(p.stocks) && p.stocks.length) return p.stocks
  return HOLDINGS.map((h) => ({ code: h.code, market: h.market, name: h.name }))
}
async function writePortfolio(list) {
  await writeJson(PORTFOLIO_FILE, { stocks: list, updatedAt: new Date().toISOString() })
}

/** 由代码推断市场：港股 5 位=116，沪市 6/9 开头=1，其余深市=0 */
function inferMarket(code) {
  const c = String(code || '').trim()
  if (c.length <= 5) return '116'
  return c.startsWith('6') || c.startsWith('9') ? '1' : '0'
}

/** 把当前的 snapshot/report/swing/backtest/strategy/macro 存档到 SQLite 历史 */
async function archiveToday(store) {
  const [snap, rep, swing, bt, strategy, macro] = await Promise.all([
    readJson(SNAPSHOT_FILE), readJson(REPORT_FILE), readJson(SWING_FILE), readJson(BACKTEST_FILE), readJson(STRATEGY_FILE), readJson(MACRO_FILE),
  ])
  const day = (rep && rep.date) || (snap && snap.tradingDay) || new Date().toISOString().slice(0, 10)
  store.archiveDay(String(day).slice(0, 10), { snapshot: snap, report: rep, swing, backtest: bt, strategy, macro })
  return String(day).slice(0, 10)
}

/** 读取用户配置的大模型 key 配置；无有效配置时返回 null */
async function readLlmConfig() {
  const c = await readJson(LLM_CONFIG_FILE)
  if (c && c.apiKey && c.baseUrl && c.model) return { baseUrl: c.baseUrl, apiKey: c.apiKey, model: c.model }
  return null
}
async function writeLlmConfig(cfg) {
  await writeJson(LLM_CONFIG_FILE, { baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, model: cfg.model, updatedAt: new Date().toISOString() })
}

/** 用用户自定义 key 走 OpenAI 兼容接口（如 DeepSeek / 通义 / OpenAI 等） */
async function completeViaApi(messages, cfg, signal) {
  const base = String(cfg.baseUrl || '').replace(/\/+$/, '')
  const r = await fetch(base + '/chat/completions', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer ' + cfg.apiKey },
    body: JSON.stringify({ model: cfg.model, messages, temperature: 0.6, max_tokens: 2048, stream: false }),
    signal,
  })
  if (!r.ok) throw new Error('LLM HTTP ' + r.status)
  const j = await r.json()
  const c = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content
  return typeof c === 'string' ? c : null
}

const textOutput = () => ({
  schema: { type: 'string' },
  render: (_args, value) => [{ type: 'text', text: String(value) }],
})

/** 紧凑、供 Agent 直接阅读的快照摘要 */
function snapshotSummary(s) {
  const idx = (s.indices || []).map((i) => `${i.name}: ${i.price ?? '-'} ${i.changePct == null ? '' : (i.changePct > 0 ? '+' : '') + i.changePct.toFixed(2) + '%'}`)
  const hold = (s.holdings || []).map((h) => `${h.name}(${h.code}): ${h.price ?? '-'} ${h.changePct == null ? '' : (h.changePct > 0 ? '+' : '') + h.changePct.toFixed(2) + '%'}`)
  const zt = (s.limitUp || []).map((x) => `${x.name}(${x.code}) ${x.lbc}连板 ${x.industry} 价${x.price} 封单${(x.fund / 1e8).toFixed(2)}亿 炸${x.zbc}次 换手${x.turnover?.toFixed?.(1)}%`)
  const dt = (s.limitDown || []).map((x) => `${x.name}(${x.code}) ${x.days}连跌 ${x.industry} 价${x.price} 封单${(x.fund / 1e8).toFixed(2)}亿`)
  return {
    tradingDay: s.tradingDay,
    fetchedAt: s.fetchedAt,
    mode: s.mode,
    indices: idx,
    holdings: hold,
    sentiment: s.sentiment || {},
    breadth: s.breadth || {},
    limitUp: zt,
    limitUpFull: s.limitUp,
    limitDown: dt,
    limitDownFull: s.limitDown,
  }
}

export function apply(ctx) {
  const llm = ctx.get('llm')
  const agentDefaultModel = ctx.get('agentDefaultModel')

  const store = createStore(path.join(DATA_DIR, 'dashboard.db'))
  ctx.effect(() => () => store.close())

  const modelRoute = () => {
    const sel = agentDefaultModel?.currentSelection?.()
    return (sel?.provider && sel?.model) ? { provider: sel.provider, model: sel.model } : null
  }
  /** One-shot completion：优先用用户配置的大模型 key，否则回退到当前 Agent 模型 */
  const complete = async (prompt, signal) => {
    const cfg = await readLlmConfig()
    if (cfg) {
      try {
        const out = await completeViaApi([{ role: 'user', content: String(prompt) }], cfg, signal)
        if (out != null && String(out).trim()) return out
      } catch { /* 自定义接口失败则回退内置模型 */ }
    }
    const route = modelRoute()
    if (!llm || !route) return null
    try {
      const chunks = []
      for await (const c of llm.stream({
        provider: route.provider,
        model: route.model,
        messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
        signal,
      })) {
        if (c.type === 'text-delta') chunks.push(c.text)
      }
      return chunks.join('')
    } catch { return null }
  }

  /* ------------------------------------------------------------ agent tools */

  ctx.effect(() => ctx.tools.register({
    name: 'stock_dashboard_fetch',
    description: '采集当日 A 股行情快照并保存到股市看板：涨停/跌停股池（含连板数、封单、行业、市值）、关键指数、持仓报价、涨跌家数与两市成交额。数据来自东方财富免费接口，无需密钥。返回结构化摘要供分析，也会连带存下供看板展示。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(),
    timeoutMs: 5 * 60 * 1000,
    execute: async () => {
      const portfolio = await readPortfolio()
      const snap = await collectSnapshot({ portfolio })
      if (snap.breadth && !snap.breadth.error) cachedBreadth = snap.breadth
      await writeJson(SNAPSHOT_FILE, snap)
      const sum = snapshotSummary(snap)
      return JSON.stringify({ ok: true, ...sum }, null, 2)
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'stock_dashboard_publish',
    description: '把当日盘后分析报告发布到股市看板。report 为结构化结果，markdown 为可直接发社区的成文。看板会按 report 里的字段渲染涨停/跌停分析、指数趋势、持仓表现、复盘、次日建议、右侧机会诊断等。',
    parameters: {
      type: 'object',
      properties: {
        report: {
          type: 'object',
          additionalProperties: true,
          description: '结构化分析报告。建议字段：date(交易日)、title、summary、sentiment{label,score,note}、market{indices[],breadth,review}、limitUp[{code,name,lbc,industry,reason,fundamentals,againProb,score,analysis}]、limitDown[{code,name,days,industry,reason,reversalProb,analysis}]、holdings[{name,code,changePct,comment}]、recommend(建议投资诊断Markdown)、tomorrow、article(markdown全文)。',
        },
        markdown: { type: 'string', description: '可选：可直接发社区的完整成文（Markdown）。若 report.article 缺失则用它。' },
      },
      required: ['report'],
    },
    output: textOutput(),
    execute: async (args) => {
      const src = args.report && typeof args.report === 'object' ? args.report : {}
      const report = { ...src }
      if (typeof report.article !== 'string' && typeof args.markdown === 'string') report.article = args.markdown
      report.updatedAt = new Date().toISOString()
      report.publishedBy = 'agent'
      await writeJson(REPORT_FILE, report)
      const day = await archiveToday(store)
      return JSON.stringify({ ok: true, date: report.date || null, title: report.title || null, archived: day, saved: REPORT_FILE })
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'stock_dashboard_status',
    description: '读取股市看板当前状态：最近行情快照与已发布报告的概况。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(),
    execute: async () => {
      const snap = await readJson(SNAPSHOT_FILE)
      const rep = await readJson(REPORT_FILE)
      return JSON.stringify({
        snapshot: snap ? { tradingDay: snap.tradingDay, fetchedAt: snap.fetchedAt, mode: snap.mode, sentiment: snap.sentiment } : null,
        report: rep ? { date: rep.date, title: rep.title, updatedAt: rep.updatedAt } : null,
      }, null, 2)
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'stock_dashboard_screen',
    description: '全市场挖掘「跌后反转 / 连续下跌 / 右侧信号」个股：拉取全部约 5500 只 A 股，结合 60 日与 20 日表现、今日涨跌、量比与均线结构，计算超跌反转候选与右侧趋势候选（含反转/右侧概率、连跌天数、站线情况），保存到看板并返回结构化结果供诊断分析。',
    parameters: { type: 'object', properties: {}, additionalProperties: false },
    output: textOutput(),
    timeoutMs: 10 * 60 * 1000,
    execute: async () => {
      const swing = await screenRightSide()
      await writeJson(SWING_FILE, swing)
      return JSON.stringify({ ok: true, summary: swing.summary, oversold: swing.oversold.map(s => `${s.name}(${s.code}) 反转${s.reversalProb}% 连跌${s.downStreak}日 20日${s.change20d}% 60日${s.change60d}% ${s.reason}`), trend: swing.trend.map(t => `${t.name}(${t.code}) 右侧${t.rightProb}% 20日${t.change20d}% 60日${t.change60d}% ${t.reason}`) }, null, 2)
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'stock_dashboard_backtest',
    description: '对历史涨停股做「涨停次日追涨」模拟交易回测：涨停日次日开盘买入，+5% 止盈 / -5% 止损 / 持有5日时间止损（同日触发止损优先），每只1万元等额本金。返回交易规则、胜率、平均/累计收益、盈亏分布与近期逐笔记录，保存到看板。',
    parameters: { type: 'object', properties: { days: { type: 'integer', description: '回测的涨停交易日数量，默认 8' } }, additionalProperties: false },
    output: textOutput(),
    timeoutMs: 15 * 60 * 1000,
    execute: async (args) => {
      const bt = await backtestStrategy({ days: args && args.days ? Number(args.days) : undefined })
      await writeJson(BACKTEST_FILE, bt)
      const st = bt.stats || {}
      return JSON.stringify({ ok: true, rules: bt.rules, stats: st, sampleTrades: (bt.trades || []).slice(0, 15).map(t => `${t.buyDate} ${t.name}(${t.code}) 买${t.entry} 卖${t.exit} ${t.retPct > 0 ? '+' : ''}${t.retPct}% ${t.rule} 持${t.held}日`) }, null, 2)
    },
  }))

  ctx.effect(() => ctx.tools.register({
    name: 'stock_dashboard_strategy',
    description: '读取或更新我的交易系统（交易规则）。action=read 返回当前策略；action=update 用新 strategy 覆盖并按版本号+1 追加版本历史与反思日志。策略沉淀在股市看板最前方，供每日反思迭代、逐步稳定。',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['read', 'update'], description: 'read 读取当前策略 / update 更新策略。' },
        strategy: {
          type: 'object', additionalProperties: true,
          description: '（update 时必填）新策略对象，建议字段：title、summary、principles[]、rules[]、shiftNote(本次规则变更说明)、reflection(当日反思小结)。',
        },
      },
      required: ['action'],
    },
    output: textOutput(),
    execute: async (args) => {
      if (args.action === 'update') {
        const src = args.strategy && typeof args.strategy === 'object' ? args.strategy : {}
        const cur = (await readJson(STRATEGY_FILE)) || {}
        const version = (cur.version || 0) + 1
        const today = new Date().toISOString().slice(0, 10)
        const note = src.shiftNote || src.reflection || ''
        const next = {
          version,
          title: src.title || cur.title || '我的交易系统',
          summary: src.summary != null ? src.summary : cur.summary,
          principles: Array.isArray(src.principles) ? src.principles : (cur.principles || []),
          rules: Array.isArray(src.rules) ? src.rules : (cur.rules || []),
          updatedAt: new Date().toISOString(),
          latestReflection: { date: today, note },
          history: [...(cur.history || []), { version, date: today, note }],
        }
        await writeJson(STRATEGY_FILE, next)
        return JSON.stringify({ ok: true, version: next.version, title: next.title, rules: next.rules })
      }
      const cur = (await readJson(STRATEGY_FILE)) || {}
      return JSON.stringify(cur, null, 2)
    },
  }))

  /* ------------------------------------------------------------ HTTP bridge */

  const webServer = ctx.get('webServer')
  const connection = ctx.get('connection')
  if (!webServer) return

  const reject = (req, res) => {
    const s = connection?.requestRejection?.(req)
    if (s) { res.statusCode = s; res.end(); return true }
    return false
  }

  /** 供 AI 问答使用的紧凑看板上下文 */
  function contextSummary(snap, rep, swing, strategy, backtest) {
    const lines = []
    if (snap) {
      const s = snap.sentiment || {}
      lines.push(`交易日 ${snap.tradingDay}（${snap.mode === 'intraday' ? '盘中实时' : '收盘'}）`)
      lines.push(`指数：${(snap.indices || []).map(i => `${i.name} ${i.changePct?.toFixed?.(2)}%`).join('；')}`)
      lines.push(`情绪：涨停${s.limitUpCount} 跌停${s.limitDownCount} 连板高度${s.maxLbc}；涨${s.breadthUp ?? '-'}跌${s.breadthDown ?? '-'}平${s.breadthFlat ?? '-'}，两市${s.totalAmountYi ?? '-'}亿`)
      lines.push(`持仓：${(snap.holdings || []).map(h => `${h.name}(${h.code}) ${h.changePct?.toFixed?.(2)}%`).join('；')}`)
      lines.push(`涨停池：${(snap.limitUp || []).map(x => `${x.name}${x.lbc}板(${x.industry})`).join('、')}`)
      lines.push(`跌停池：${(snap.limitDown || []).map(x => `${x.name}(${x.industry})`).join('、')}`)
    }
    if (swing) {
      lines.push(`右侧候选：超跌反转[${(swing.oversold || []).map(x => `${x.name}${x.reversalProb}%`).join('、')}]；右侧趋势[${(swing.trend || []).map(x => `${x.name}${x.rightProb}%`).join('、')}]`)
    }
    if (strategy && (strategy.rules || []).length) {
      lines.push(`我的交易规则：${strategy.rules.join('；')}`)
    }
    if (backtest && backtest.stats) {
      const b = backtest.stats
      lines.push(`涨停次日策略回测：胜率${b.winRate}% 平均收益${b.avgRetPct}% 盈亏比${b.profitFactor ?? '—'}`)
    }
    if (rep) {
      if (rep.summary) lines.push(`当日总结：${rep.summary}`)
      if (rep.recommend) lines.push(`投资诊断：${rep.recommend}`)
      if (rep.tomorrow) lines.push(`次日建议：${rep.tomorrow}`)
    }
    return lines.join('\n')
  }

  /** 整个看板状态：快照 + 报告 + 右侧候选 + 持仓配置 + 交易状态 */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/state',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
      const [snap, rep, swing, bt, portfolio, strategy, macro] = await Promise.all([
        readJson(SNAPSHOT_FILE), readJson(REPORT_FILE), readJson(SWING_FILE), readJson(BACKTEST_FILE), readPortfolio(), readJson(STRATEGY_FILE), readJson(MACRO_FILE),
      ])
      const llmCfg = await readLlmConfig()
      sendJson(res, 200, {
        snapshot: snap,
        report: rep,
        swing,
        backtest: bt,
        portfolio,
        strategy,
        macro,
        llm: { baseUrl: llmCfg ? llmCfg.baseUrl : 'https://api.deepseek.com', model: llmCfg ? llmCfg.model : 'deepseek-chat', hasKey: !!llmCfg, using: llmCfg ? 'custom' : 'builtin' },
        trading: isTradingWindow(),
        meta: {
          indices: INDICES.map((i) => ({ code: i.code, name: i.name })),
        },
      })
    },
  }))

  /** 头像：AI「杰克」使用「杰克观潮」logo（本地 PNG） */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/avatar',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'GET' && req.method !== 'HEAD') { res.statusCode = 405; res.end(); return }
      try {
        const buf = await fsp.readFile(path.join(DATA_DIR, 'jack-logo.png'))
        res.statusCode = 200
        res.setHeader('content-type', 'image/png')
        res.setHeader('content-length', String(buf.length))
        res.setHeader('cache-control', 'public, max-age=86400')
        if (req.method === 'HEAD') { res.end(); return }
        res.end(buf)
      } catch {
        res.statusCode = 404
        res.end('not found')
      }
    },
  }))

  /** 刷新行情快照（纯市场数据，不含 AI 分析）。body: { quick } —— 盘中快速刷新跳过全市场分页 */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/refresh',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      let quick = false
      try { const body = JSON.parse(await readBody(req, 1024 * 1024)); quick = body && (body.quick === true || body.quick === '1') } catch { /* default false */ }
      try {
        const portfolio = await readPortfolio()
        const snap = await collectSnapshot({ portfolio, quick })
        if (quick) {
          if (cachedBreadth) {
            snap.breadth = { ...cachedBreadth, cached: true }
            const amountYi = Number(cachedBreadth.totalAmountYuan || 0) / 1e8
            snap.sentiment.breadthUp = cachedBreadth.up
            snap.sentiment.breadthDown = cachedBreadth.down
            snap.sentiment.breadthFlat = cachedBreadth.flat
            snap.sentiment.totalAmountYi = Math.round(amountYi)
          }
        } else if (snap.breadth && !snap.breadth.error) {
          cachedBreadth = snap.breadth
        }
        await writeJson(SNAPSHOT_FILE, snap)
        sendJson(res, 200, { ok: true, snapshot: snap })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  /** 刷新右侧机会：全市场扫描（约 8 秒），重新计算并保存 swing.json */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/screen',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      try {
        const swing = await screenRightSide()
        await writeJson(SWING_FILE, swing)
        sendJson(res, 200, { ok: true, swing })
      } catch (e) { sendJson(res, 500, { ok: false, error: String(e && e.message || e) }) }
    },
  }))

  /** 持仓配置：GET 读取，POST 保存 { stocks: [{code,market?,name?}] } */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/portfolio',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method === 'GET') {
        sendJson(res, 200, { stocks: await readPortfolio() })
        return
      }
      if (req.method === 'POST') {
        try {
          const body = JSON.parse(await readBody(req, 1024 * 1024))
          const raw = Array.isArray(body?.stocks) ? body.stocks : []
          const stocks = raw
            .map((s) => ({
              code: String(s.code || '').trim(),
              market: String(s.market || inferMarket(s.code)),
              name: String(s.name || s.code),
            }))
            .filter((s) => /^[0-9A-Za-z.]{2,10}$/.test(s.code))
            .slice(0, 50)
          await writePortfolio(stocks)
          sendJson(res, 200, { ok: true, stocks })
        } catch (e) { sendJson(res, 400, { ok: false, error: String(e && e.message || e) }) }
        return
      }
      res.statusCode = 405; res.end()
    },
  }))

  /** AI 大模型 key 配置：GET 读取（脱敏），POST 保存 { baseUrl, apiKey, model } */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/llm-config',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method === 'GET') {
        const c = await readLlmConfig()
        sendJson(res, 200, { baseUrl: c ? c.baseUrl : 'https://api.deepseek.com', model: c ? c.model : 'deepseek-chat', hasKey: !!c, using: c ? 'custom' : 'builtin' })
        return
      }
      if (req.method === 'POST') {
        try {
          const b = JSON.parse(await readBody(req, 64 * 1024)) || {}
          const baseUrl = String(b.baseUrl || '').trim()
          const apiKey = String(b.apiKey || '').trim()
          const model = String(b.model || '').trim()
          if (!baseUrl || !apiKey || !model) { sendJson(res, 400, { ok: false, error: '请填写 API 地址、Key 和模型名' }); return }
          await writeLlmConfig({ baseUrl, apiKey, model })
          sendJson(res, 200, { ok: true, hasKey: true })
        } catch (e) { sendJson(res, 400, { ok: false, error: String(e && e.message || e) }) }
        return
      }
      res.statusCode = 405; res.end()
    },
  }))

  /** 股票搜索（用于配置持仓）：GET ?kw= */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/stock-search',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
      const url = new URL(String(req.url), 'http://localhost')
      const kw = url.searchParams.get('kw') || ''
      const hits = await searchStocks(kw)
      sendJson(res, 200, { hits })
    },
  }))

  /** 个股详情（公司介绍 + 基本面）：GET ?code=&market= */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/stock-detail',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
      const url = new URL(String(req.url), 'http://localhost')
      const code = url.searchParams.get('code') || ''
      const market = url.searchParams.get('market') || ''
      if (!/^[0-9A-Za-z.]{2,10}$/.test(code)) { sendJson(res, 400, { ok: false, error: '代码无效' }); return }
      const key = `${market}.${code}`
      const cached = detailCache.get(key)
      if (cached && Date.now() - cached.ts < 5 * 60 * 1000) { sendJson(res, 200, { ok: true, ...cached.data }); return }
      try {
        const detail = await fetchStockDetailFull(code, market)
        detailCache.set(key, { ts: Date.now(), data: detail })
        sendJson(res, 200, { ok: true, ...detail })
      } catch (e) {
        sendJson(res, 500, { ok: false, error: String(e && e.message || e) })
      }
    },
  }))

  /** 批量个股详情：POST { stocks: [{code,market}] } → { details: {code: detail} } */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/stock-details',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      let stocks = []
      try { stocks = (JSON.parse(await readBody(req, 512 * 1024)) || {}).stocks || [] } catch { /* ignore */ }
      stocks = stocks.filter((s) => /^[0-9A-Za-z.]{2,10}$/.test(String(s && s.code || ''))).slice(0, 60)
      const details = await fetchStockDetails(stocks)
      sendJson(res, 200, { ok: true, details })
    },
  }))

  /** AI 问答：POST { question, history } → { answer }（多轮记忆 + 当前 Agent 模型 + 看板数据上下文） */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/ask',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      let body = {}
      try { body = JSON.parse(await readBody(req, 512 * 1024)) || {} } catch { /* ignore */ }
      const question = String(body.question || '').trim()
      if (!question) { sendJson(res, 400, { ok: false, error: '请输入问题' }); return }
      const history = Array.isArray(body.history) ? body.history.slice(-16).map((h) => ({ role: h.role === 'user' ? 'user' : 'assistant', content: String(h.content || '') })).filter((h) => h.content) : []
      const longMem = store.listChat(20)
      const [snap, rep, swing, strategy, backtest] = await Promise.all([
        readJson(SNAPSHOT_FILE), readJson(REPORT_FILE), readJson(SWING_FILE), readJson(STRATEGY_FILE), readJson(BACKTEST_FILE),
      ])
      const ctxText = contextSummary(snap, rep, swing, strategy, backtest)
      const histText = history.map((h) => (h.role === 'user' ? '我' : '杰克') + '：' + h.content).join('\n')
      const memText = longMem.map((m) => (m.role === 'user' ? '我' : '杰克') + '：' + m.content).join('\n')
      const prompt = `你是「杰克」，一名专业、务实、有洞察力的 A 股 / 港股投资研究顾问，也是用户的私人交易伙伴。你有记忆（能自然衔接此前与历史对话）、用数据说话、有清晰的风控与交易规则意识，回答不空谈、结论明确。\n\n【你当前掌握的看板数据】\n${ctxText}\n\n【本次会话对话（记忆）】\n${histText || '（无）'}\n\n【历史对话记录（长期记忆）】\n${memText || '（无）'}\n\n【用户现在的问题】\n${question}\n\n要求：优先基于看板数据回答，并结合对话记忆自然衔接；结论清晰、尽量给出依据和可操作建议；若信息不足，明确指出缺什么；不要重复自我介绍；结尾可提示「不构成投资建议」。直接回答，不要寒暄。`
      const answer = await complete(prompt, undefined)
      if (answer == null || !String(answer).trim()) { sendJson(res, 503, { ok: false, error: '当前未配置可用大模型，无法作答。' }); return }
      store.appendChat('user', question)
      store.appendChat('assistant', String(answer))
      sendJson(res, 200, { ok: true, answer, fetchedAt: new Date().toISOString() })
    },
  }))

  /** 宏观与市场动态分析：抓取最新快讯 + 当前 Agent 模型深度解读，存 macro.json */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/macro',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      const [news, snap] = await Promise.all([fetchMacroNews(30), readJson(SNAPSHOT_FILE)])
      const idx = ((snap && snap.indices) || []).map((i) => `${i.name} ${i.changePct?.toFixed?.(2)}%`).join('、')
      const sent = (snap && snap.sentiment) || {}
      const newsText = (news || []).map((n) => `· ${n.time ? n.time + ' ' : ''}${n.title}`).join('\n')
      const prompt = `你是资深宏观与市场策略分析师，兼具政策敏感性、产业链认知与全球视野。请基于下面最新资讯与市场数据，输出一篇**全面、深刻、有洞察**的 A股/港股「宏观与市场动态分析」（直接用 Markdown，不要寒暄）。\n\n【今日市场快照】\n交易日 ${snap && snap.tradingDay ? snap.tradingDay : '—'}；指数涨跌：${idx || '—'}；情绪：涨停${sent.limitUpCount ?? '-'} 跌停${sent.limitDownCount ?? '-'} 连板高度${sent.maxLbc ?? '-'}，上涨${sent.breadthUp ?? '-'}/下跌${sent.breadthDown ?? '-'}，两市成交约${sent.totalAmountYi ?? '-'}亿。\n\n【最新资讯（7x24 快讯）】\n${newsText || '（暂无）'}\n\n请覆盖并给出你的独立判断：\n1) 政策与政府动向（监管/产业政策/宏观政策信号）及其对市场的影响；\n2) 行业与产业链动态（哪些行业受益/承压，资金在切向哪里）；\n3) 市场资金与情绪面（成交、风险偏好、风格切换）；\n4) A股与港股联动与大环境（全球流动性、汇率、外围）；\n5) 新动向与投资启示（结合看板情绪与右侧/超跌机会，给出你的判断与操作启示）。\n\n要求：观点明确、有逻辑链、有洞察力，不空谈；用 ## 分小标题；控制 800-1200 字；末尾注明「以上为研究观点，不构成投资建议」。直接输出 Markdown 正文。`
      const content = await complete(prompt, undefined)
      if (content == null || !String(content).trim()) {
        sendJson(res, 503, { ok: false, error: '当前未配置可用大模型，无法分析。' })
        return
      }
      const macro = { generatedAt: new Date().toISOString(), news, content, source: 'agent-llm' }
      await writeJson(MACRO_FILE, macro)
      sendJson(res, 200, { ok: true, generatedAt: macro.generatedAt, content })
    },
  }))

  /** 历史看板：GET 不带 date 返回日期列表；带 ?date=YYYY-MM-DD 返回该日完整数据 */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/history',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'GET') { res.statusCode = 405; res.end(); return }
      const url = new URL(String(req.url), 'http://localhost')
      const date = url.searchParams.get('date') || ''
      if (date) {
        const day = store.getHistory(date)
        if (!day) { sendJson(res, 404, { ok: false, error: '该日期暂无存档' }); return }
        sendJson(res, 200, { ok: true, ...day })
        return
      }
      const list = store.listHistory(120).map((d) => ({
        date: d.date,
        archivedAt: d.archivedAt,
        title: (d.report && d.report.title) || null,
        summary: (d.report && d.report.summary) || null,
        sentiment: (d.report && d.report.sentiment) || null,
      }))
      sendJson(res, 200, { ok: true, list })
    },
  }))

  /** 手动归档当前数据到历史 */
  ctx.effect(() => webServer.register({
    kind: 'exact', path: '/stock-dashboard/history-archive',
    handler: async (req, res) => {
      if (reject(req, res)) return
      if (req.method !== 'POST') { res.statusCode = 405; res.end(); return }
      try {
        const day = await archiveToday(store)
        sendJson(res, 200, { ok: true, date: day })
      } catch (e) { sendJson(res, 500, { ok: false, error: String(e && e.message || e) }) }
    },
  }))
}

/* ------------------------------------------------------------ http helpers */

function readBody(req, limit = 20 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (c) => {
      size += c.length
      if (size > limit) { reject(new Error('request body too large')); req.destroy(); return }
      chunks.push(c)
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

function sendJson(res, code, obj) {
  const body = JSON.stringify(obj)
  res.statusCode = code
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('content-length', Buffer.byteLength(body))
  res.end(body)
}