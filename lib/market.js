/**
 * A-share / HK market data collector over free Eastmoney public endpoints.
 * No API key required. Pure Node fetch against the browser-facing JSON APIs.
 *
 * Each function is defensive: a failed network call throws a typed error so the
 * caller (index.js) can log and degrade rather than crash the plugin.
 * @module @local/dsh-stock-dashboard/lib/market
 */

const H = {
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
  'Referer': 'https://quote.eastmoney.com/',
}
const UT = '7eea3edcaed734bea9cbfc24409ed989'

async function getJson(url) {
  const res = await fetch(url, { headers: H })
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`)
  return res.json()
}

/** HHMMSS -> "HH:MM:SS" */
function fmtTime(t) {
  const s = String(t == null ? '' : t).padStart(6, '0')
  if (!/^\d{6}$/.test(s)) return ''
  return `${s.slice(0, 2)}:${s.slice(2, 4)}:${s.slice(4, 6)}`
}

export const INDICES = [
  { code: '000001', market: '1', name: '上证指数' },
  { code: '399001', market: '0', name: '深证成指' },
  { code: '399006', market: '0', name: '创业板指' },
  { code: '000300', market: '1', name: '沪深300' },
  { code: '000688', market: '1', name: '科创50' },
  { code: '000905', market: '1', name: '中证500' },
]

/** The user's tracked portfolio. market: 0=SZ 1=SH 116=HK */
export const HOLDINGS = [
  { code: '000333', market: '0', name: '美的集团' },
  { code: '600036', market: '1', name: '招商银行' },
  { code: '00700', market: '116', name: '腾讯控股' },
  { code: '03690', market: '116', name: '美团-W' },
  { code: '01339', market: '116', name: '中国人民保险集团' },
  { code: '601138', market: '1', name: '工业富联' },
  { code: '000661', market: '0', name: '长春高新' },
  { code: '601012', market: '1', name: '隆基绿能' },
  { code: '002049', market: '0', name: '紫光国微' },
]

/** Latest settled trading day, read off the 上证指数 daily kline tail. */
export async function fetchTradingDay() {
  const u = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=1&lmt=3&end=20500101&fields1=f1&fields2=f51,f53&_=${Date.now()}`
  const k = await getJson(u)
  const lines = (k && k.data && k.data.klines) || []
  if (!lines.length) throw new Error('无法确定最近交易日')
  const last = String(lines[lines.length - 1]).split(',')[0]
  return last
}

/** 涨停 / 跌停股池，`kind` = 'zt' | 'dt'，`date` = YYYYMMDD */
async function fetchLimitPool(kind, date) {
  const endpoint = kind === 'zt' ? 'getTopicZTPool' : 'getTopicDTPool'
  const sort = kind === 'zt' ? 'fbt%3Aasc' : 'fund%3Aasc'
  const url = `https://push2ex.eastmoney.com/getTopic${endpoint === 'getTopicZTPool' ? 'ZTPool' : 'DTPool'}?ut=${UT}&dpt=wz.ztzt&Pageindex=0&pagesize=400&sort=${sort}&date=${date}&_=${Date.now()}`
  const j = await getJson(url)
  const data = (j && j.data) || {}
  const pool = Array.isArray(data.pool) ? data.pool : []
  const qdate = data.qdate || date
  if (kind === 'zt') {
    return (pool || []).map((x) => ({
      code: String(x.c || ''),
      market: x.m,
      name: x.n,
      price: (x.p || 0) / 1000,
      changePct: x.zdp,
      lbc: x.lbc ?? 1,
      firstTime: fmtTime(x.fbt),
      lastTime: fmtTime(x.lbt),
      fund: x.fund,
      zbc: x.zbc ?? 0,
      industry: x.hybk || '',
      amount: x.amount,
      floatMv: x.ltsz,
      totalMv: x.tshare,
      turnover: x.hs,
      ztStat: x.zttj || {},
    }))
  }
  return (pool || []).map((x) => ({
    code: String(x.c || ''),
    market: x.m,
    name: x.n,
    price: (x.p || 0) / 1000,
    changePct: x.zdp,
    days: x.days ?? 1,
    lastTime: fmtTime(x.lbt),
    fund: x.fund,
    openCount: x.oc ?? 0,
    industry: x.hybk || '',
    amount: x.amount,
    pe: x.pe,
    turnover: x.hs,
  }))
}

/** 指数 60 交易日日线；返回含 klines 的数组（同时derive当日/昨收） */
export async function fetchIndices() {
  const out = []
  for (const idx of INDICES) {
    const secid = `${idx.market}.${idx.code}`
    const u = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=60&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&_=${Date.now()}`
    try {
      const j = await getJson(u)
      const raw = (j && j.data && j.data.klines) || []
      const klines = raw.map((l) => {
        const a = String(l).split(',')
        return {
          date: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4],
          volume: +a[5], amount: +a[6],
        }
      })
      const last = klines[klines.length - 1]
      const prev = klines[klines.length - 2] || last
      const price = last ? last.close : null
      const change = last ? last.close - prev.close : null
      const changePct = (prev && prev.close) ? (change / prev.close) * 100 : null
      out.push({ ...idx, secid, price, change, changePct, prevClose: prev ? prev.close : null, klines })
    } catch (e) {
      out.push({ ...idx, secid, error: String(e && e.message || e), klines: [] })
    }
  }
  return out
}

/** 持仓报价（A 股 / 港股），price 统一换算成真实小数。list: [{code,market,name}] */
export async function fetchHoldings(list) {
  const items = (list && list.length ? list : HOLDINGS)
  const secids = items.map((h) => `${h.market}.${h.code}`)
  const fields = 'f12,f13,f14,f2,f3,f18'
  const u = `https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${secids.join(',')}&fields=${fields}&ut=${UT}&_=${Date.now()}`
  const j = await getJson(u)
  const diff = (j && j.data && j.data.diff) || []
  const byCode = new Map(diff.map((x) => [x.f12, x]))
  return items.map((h) => {
    const x = byCode.get(h.code)
    if (!x) return { ...h, error: 'no data' }
    const scale = h.market === '116' ? 1000 : 100 // 港股 3 位小数
    const price = x.f2 / scale
    const prevClose = x.f18 / scale
    const change = prevClose ? price - prevClose : null
    const changePct = prevClose ? (change / prevClose) * 100 : null
    return { ...h, price, prevClose, change, changePct, name: x.f14 || h.name }
  })
}

/** 搜索 A 股 / 港股代码或名称（用于配置持仓） */
export async function searchStocks(kw) {
  const q = String(kw || '').trim()
  if (!q) return []
  const isPure = /^\d{4,6}$/.test(q)
  const u = `https://searchapi.eastmoney.com/api/suggest/get?input=${encodeURIComponent(q)}&type=14&token=D43BF722C8E33BDC906FB84D85E326E8&count=8`
  try {
    const j = await getJson(u)
    const list = (j && j.QuotationCodeTable && j.QuotationCodeTable.Data) || []
    return list
      .filter((x) => {
        const code = String(x.Code || '')
        const mkt = String(x.MktNum || x.MarketType || '')
        return /^(0|1|116)$/.test(mkt) || isPure
      })
      .map((x) => ({
        code: String(x.Code || ''),
        market: String(x.MktNum || x.MarketType || marketOf(String(x.Code || ''))),
        name: String(x.Name || ''),
        type: String(x.SecurityTypeName || x.MktNum || ''),
      }))
      .slice(0, 8)
  } catch { return [] }
}

/** 由 A 股代码推断市场：6 开头沪市，其余深市 */
export function marketOf(code) {
  const c = String(code || '')
  if (c.startsWith('6') || c.startsWith('9')) return '1'
  return '0'
}

/** 全市场涨跌家数 + 两市成交额（分页拉取全部 A 股） */
export async function fetchBreadth() {
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
  let up = 0, down = 0, flat = 0, total = 0
  let amount = 0
  let page = 1
  // 分页拉全量（该接口单页上限 100）；异常时在调用方降级
  const pageSize = 100
  for (let guard = 0; guard < 80; guard++) {
    const u = `https://82.push2.eastmoney.com/api/qt/clist/get?pn=${page}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=f2,f3,f6,f12,f14&ut=${UT}&_=${Date.now()}`
    const j = await getJson(u)
    const data = (j && j.data) || {}
    const diff = Array.isArray(data.diff) ? data.diff : []
    if (page === 1) total = data.total || diff.length
    for (const x of diff) {
      const pct = Number(x.f3)
      if (pct > 0) up++
      else if (pct < 0) down++
      else flat++
      const amt = Number(x.f6)
      if (Number.isFinite(amt)) amount += amt
    }
    if (!diff.length || diff.length < pageSize) break
    if (page * pageSize >= total) break
    page++
  }
  return { total: total || (up + down + flat), up, down, flat, totalAmountYuan: amount }
}

/** 一次性采集：返回结构化快照（不做文件 IO） */
export async function collectSnapshot({ portfolio = null, quick = false } = {}) {
  const tradingDay = await fetchTradingDay()
  const dateYmd = String(tradingDay).replace(/-/g, '')
  const holdingsList = (portfolio && portfolio.length ? portfolio : HOLDINGS)
  const breadthPromise = quick ? Promise.resolve(null) : fetchBreadth().catch((e) => ({ error: String(e && e.message || e) }))
  const [indices, holdings, limitUp, limitDown, breadth] = await Promise.all([
    fetchIndices(),
    fetchHoldings(holdingsList),
    fetchLimitPool('zt', dateYmd),
    fetchLimitPool('dt', dateYmd),
    breadthPromise,
  ])
  const maxLbc = limitUp.reduce((m, x) => Math.max(m, x.lbc || 0), 0)
  const amountYi = breadth ? Number(breadth.totalAmountYuan || 0) / 1e8 : null
  return {
    kind: 'snapshot',
    tradingDay,
    fetchedAt: new Date().toISOString(),
    mode: quick ? 'intraday' : 'close',
    indices,
    holdings,
    limitUp,
    limitDown,
    breadth,
    sentiment: {
      limitUpCount: limitUp.length,
      limitDownCount: limitDown.length,
      maxLbc,
      breadthUp: breadth ? breadth.up : null,
      breadthDown: breadth ? breadth.down : null,
      breadthFlat: breadth ? breadth.flat : null,
      totalAmountYi: amountYi == null ? null : Math.round(amountYi),
    },
  }
}

/* ------------------------------------------------------------------------ */
/* 全市场「跌后反转 / 连续下跌 / 右侧信号」挖掘                              */
/* ------------------------------------------------------------------------ */

const SPOT_FIELDS = 'f2,f3,f5,f6,f8,f9,f10,f12,f13,f14,f20,f21,f23,f24,f25,f26,f62,f100'

/** 分页拉取全部 A 股当日行情 + 60 日/年初至今涨跌等字段。 */
export async function fetchSpotAll() {
  const fs = 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
  const pageSize = 100
  const out = []
  let total = 0
  for (let pn = 1; pn <= 80; pn++) {
    const u = `https://82.push2.eastmoney.com/api/qt/clist/get?pn=${pn}&pz=${pageSize}&po=1&np=1&fltt=2&invt=2&fid=f3&fs=${encodeURIComponent(fs)}&fields=${SPOT_FIELDS}&ut=${UT}&_=${Date.now()}`
    const j = await getJson(u)
    const data = (j && j.data) || {}
    const diff = Array.isArray(data.diff) ? data.diff : []
    if (pn === 1) total = data.total || 0
    for (const x of diff) {
      out.push({
        code: String(x.f12 || ''),
        market: x.f13,
        name: x.f14 || '',
        price: Number(x.f2) || 0,
        todayPct: Number(x.f3) || 0,
        amount: Number(x.f6) || 0,
        turnover: Number(x.f8) || 0,
        pe: Number(x.f9) || null,
        volRatio: Number(x.f10) || 0,
        floatMv: Number(x.f21) || 0,
        totalMv: Number(x.f20) || 0,
        pb: Number(x.f23) || null,
        change60d: Number(x.f24) || 0,
        changeYtd: Number(x.f25) || 0,
        listDate: x.f26,
        mainFlow: Number(x.f62) || 0,
        industry: x.f100 || '',
      })
    }
    if (!diff.length || diff.length < pageSize) break
    if (pn * pageSize >= total) break
  }
  return out
}

/** 单只股票 60 交易日日线（升序） */
export async function fetchStockKline(code, market, days = 60) {
  const secid = `${market}.${code}`
  const u = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=101&fqt=1&lmt=${days}&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&_=${Date.now()}`
  const j = await getJson(u)
  const raw = (j && j.data && j.data.klines) || []
  return raw.map((l) => {
    const a = String(l).split(',')
    return { date: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4], volume: +a[5], amount: +a[6] }
  })
}

function sma(arr, n, i) {
  const end = i === undefined ? arr.length : i + 1
  if (end < n) return null
  let s = 0
  for (let k = end - n; k < end; k++) s += arr[k]
  return s / n
}

/** 由升序日线计算右侧/反转指标 */
function klineMetrics(rows) {
  const n = rows.length
  if (n < 25) return null
  const closes = rows.map((r) => r.close)
  const vols = rows.map((r) => r.volume)
  const highs = rows.map((r) => r.high)
  const last = closes[n - 1]
  const prev = closes[n - 2]
  const ma5 = closes.map((_, i) => sma(closes, 5, i))
  const ma10 = closes.map((_, i) => sma(closes, 10, i))
  const ma20 = closes.map((_, i) => sma(closes, 20, i))

  // 连跌天数：若今日收涨，则为反转前的连跌；否则为截至今日的连跌
  let downStreak = 0
  if (last > prev) {
    let i = n - 2
    while (i > 0 && closes[i] < closes[i - 1]) { downStreak++; i-- }
  } else {
    let i = n - 1
    while (i > 0 && closes[i] < closes[i - 1]) { downStreak++; i-- }
  }

  // 20 日内最长连跌段
  let maxDownStreak20 = 0
  let cur = 0
  for (let i = Math.max(1, n - 20); i < n; i++) {
    if (closes[i] < closes[i - 1]) { cur++; maxDownStreak20 = Math.max(maxDownStreak20, cur) }
    else cur = 0
  }

  const r5 = ((last - closes[n - 6]) / closes[n - 6]) * 100
  const r20 = ((last - closes[n - 21]) / closes[n - 21]) * 100
  const low20 = Math.min(...closes.slice(-20))
  const reboundFromLow = ((last - low20) / low20) * 100
  const high20 = Math.max(...highs.slice(-20))

  const ma20Now = ma20[n - 1]
  const ma20Prev5 = ma20[n - 5]
  const ma20SlopeUp = ma20Now != null && ma20Prev5 != null ? ma20Now > ma20Prev5 : false
  const aboveMA20 = ma20Now != null ? last > ma20Now : false
  const aboveMA10 = ma10[n - 1] != null ? last > ma10[n - 1] : false
  const bullAlign = ma5[n - 1] != null && ma10[n - 1] != null && ma20Now != null && ma5[n - 1] > ma10[n - 1] && ma10[n - 1] > ma20Now

  const volAvg5 = vols.slice(-6, -1).reduce((a, b) => a + b, 0) / 5
  const volRatio = volAvg5 > 0 ? vols[n - 1] / volAvg5 : 1

  return {
    bars: n, last, prev, r5, r20, downStreak, maxDownStreak20, low20, reboundFromLow, high20,
    ma20: ma20Now, ma20SlopeUp, aboveMA20, aboveMA10, bullAlign, volRatio,
  }
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, Math.round(v))) }
function isSTName(name) { return /ST|退/.test(String(name || '')) }

/** 全市场右侧信号/反转机会挖掘 */
export async function screenRightSide() {
  const spot = await fetchSpotAll()
  const now = Date.now()
  const list60ago = 60 * 24 * 3600 * 1000
  const liquid = (x) => x.amount >= 50000000 && !isSTName(x.name) && (!x.listDate || (now - new Date(`${String(x.listDate).slice(0, 4)}-${String(x.listDate).slice(4, 6)}-${String(x.listDate).slice(6, 8)}`).getTime()) > list60ago)

  // 全市场分布统计
  const distribution = { deep: 0, down: 0, weak: 0, flat: 0, up: 0, strong: 0 }
  let upToday = 0, downToday = 0
  const oversoldPool = []
  const trendPool = []
  for (const x of spot) {
    if (x.todayPct > 0) upToday++
    else if (x.todayPct < 0) downToday++
    const c = x.change60d
    if (c < -30) distribution.deep++
    else if (c < -10) distribution.down++
    else if (c < 0) distribution.weak++
    else if (c < 10) distribution.flat++
    else if (c < 30) distribution.up++
    else distribution.strong++
    if (!liquid(x)) continue
    if (x.change60d < -12 && x.todayPct > 0 && x.todayPct <= 19.5 && x.volRatio >= 1) {
      oversoldPool.push(x)
    } else if (x.change60d >= 3 && x.change60d <= 75 && x.todayPct > 0 && x.todayPct <= 19.5 && x.volRatio >= 1.1) {
      trendPool.push(x)
    }
  }
  oversoldPool.sort((a, b) => ((Math.min(50, Math.abs(b.change60d)) * 1.2 + b.todayPct + Math.min(b.volRatio, 4) * 2) - (Math.min(50, Math.abs(a.change60d)) * 1.2 + a.todayPct + Math.min(a.volRatio, 4) * 2)))
  trendPool.sort((a, b) => ((Math.min(b.change60d, 45) * 0.5 + b.todayPct + Math.min(b.volRatio, 4) * 2.5) - (Math.min(a.change60d, 45) * 0.5 + a.todayPct + Math.min(a.volRatio, 4) * 2.5)))

  const oversoldTop = oversoldPool.slice(0, 26)
  const trendTop = trendPool.slice(0, 26)

  // 并发拉取候选日线（限流：每次 6 个）
  const fetchAll = async (pool) => {
    const res = []
    const queue = [...pool]
    const workers = Array.from({ length: 6 }, async () => {
      while (queue.length) {
        const x = queue.shift()
        try {
          const rows = await fetchStockKline(x.code, x.market === 1 ? '1' : '0', 70)
          const m = klineMetrics(rows)
          res.push({ x, m })
        } catch { /* skip */ }
      }
    })
    await Promise.all(workers)
    return res
  }

  const oversoldK = await fetchAll(oversoldTop)
  const trendK = await fetchAll(trendTop)

  const oversold = oversoldK
    .filter((r) => r.m)
    .map(({ x, m }) => {
      let prob = 40
      prob += Math.min(15, m.downStreak * 3)
      prob += Math.min(12, -(m.r20 > 0 ? 0 : m.r20) * 0.4)
      prob += m.reboundFromLow >= 5 ? 8 : m.reboundFromLow >= 0 ? 4 : 0
      prob += x.todayPct >= 5 ? 4 : 8
      prob += m.volRatio >= 1.5 ? 8 : m.volRatio >= 1 ? 4 : 0
      prob += m.aboveMA10 ? 4 : 0
      return {
        code: x.code, market: x.market, name: x.name, industry: x.industry,
        price: x.price, todayPct: x.todayPct, change20d: round1(m.r20), change60d: x.change60d,
        downStreak: Math.max(m.downStreak, m.maxDownStreak20), reboundFromLow: round1(m.reboundFromLow),
        aboveMA10: m.aboveMA10, volRatio: round1(m.volRatio),
        reversalProb: clamp(prob, 45, 88),
        totalMv: x.totalMv, pe: x.pe,
        reason: buildOversoldReason(m, x),
      }
    })
    .sort((a, b) => b.reversalProb - a.reversalProb)
    .slice(0, 12)

  const trend = trendK
    .filter((r) => r.m)
    .map(({ x, m }) => {
      let prob = 52
      prob += m.aboveMA20 ? 10 : -14
      prob += m.ma20SlopeUp ? 9 : -4
      prob += m.bullAlign ? 7 : 1
      prob += m.volRatio >= 1.3 ? 7 : 0
      prob += Math.min(12, (m.r20 > 0 ? m.r20 : 0) * 0.4)
      return {
        code: x.code, market: x.market, name: x.name, industry: x.industry,
        price: x.price, todayPct: x.todayPct, change20d: round1(m.r20), change60d: x.change60d,
        aboveMA20: m.aboveMA20, bullAlign: m.bullAlign, volRatio: round1(m.volRatio),
        rightProb: clamp(prob, 40, 92),
        totalMv: x.totalMv, pe: x.pe,
        reason: buildTrendReason(m, x),
      }
    })
    .sort((a, b) => b.rightProb - a.rightProb)
    .slice(0, 12)

  const avg60d = spot.length ? spot.reduce((s, x) => s + x.change60d, 0) / spot.length : 0

  return {
    kind: 'swing',
    tradingDay: null,
    computedAt: new Date().toISOString(),
    summary: {
      totalStocks: spot.length,
      upToday, downToday, avg60dPct: round1(avg60d),
      distribution,
      oversoldCount: oversoldPool.length,
      trendCount: trendPool.length,
    },
    oversold,
    trend,
  }
}

function round1(v) { return Math.round(Number(v || 0) * 10) / 10 }

function buildOversoldReason(m, x) {
  const streak = Math.max(m.downStreak || 0, m.maxDownStreak20 || 0)
  const bits = []
  if (streak >= 3) bits.push(`连跌${streak}日后放量反弹`)
  else if (m.downStreak >= 2) bits.push(`连跌${m.downStreak}日今日首阳`)
  else bits.push('深跌后今日收涨')
  if (m.aboveMA10) bits.push('已收复10日线')
  if (m.reboundFromLow >= 5) bits.push('距20日低点已反弹')
  if (m.volRatio >= 1.5) bits.push('量能明显放大')
  bits.push(x.industry || '')
  return bits.slice(0, 3).join('，')
}

function buildTrendReason(m, x) {
  const bits = []
  if (m.bullAlign) bits.push('均线多头排列')
  else if (m.aboveMA20) bits.push('站上20日线')
  if (m.ma20SlopeUp) bits.push('20日线拐头向上')
  if (m.volRatio >= 1.3) bits.push('放量上攻')
  bits.push(x.industry || '')
  return bits.slice(0, 3).join('，')
}

/* ------------------------------------------------------------------------ */
/* 交易时段判断（Asia/Shanghai）                                             */
/* ------------------------------------------------------------------------ */

/** 判断当前是否处于 A 股连续竞价时段（09:30–11:30 / 13:00–15:00，周一至周五） */
export function isTradingWindow(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Shanghai', hour12: false,
    weekday: 'short', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(now)
  const get = (t) => parts.find((p) => p.type === t)?.value || ''
  const wd = get('weekday')
  const hour = Number(get('hour'))
  const min = Number(get('minute'))
  const minutes = hour * 60 + min
  const isWeekday = !['Sat', 'Sun'].includes(wd)
  const am = minutes >= 9 * 60 + 30 && minutes <= 11 * 60 + 30
  const pm = minutes >= 13 * 60 && minutes <= 15 * 60
  return isWeekday && (am || pm)
}

/** 返回盘中状态描述，供服务端/前端展示 */
export function tradingStatus(now = new Date()) {
  return {
    trading: isTradingWindow(now),
    label: isTradingWindow(now) ? '盘中（实时刷新）' : '休市（展示最新数据）',
  }
}

/* ------------------------------------------------------------------------ */
/* 公司介绍 + 基本面（东财 F10 数据中心，无需密钥）                            */
/* ------------------------------------------------------------------------ */

const secuSuffix = (market) => (market === '1' ? '.SH' : market === '116' ? '.HK' : '.SZ')

function fmtYi(v) {
  const n = Number(v)
  if (!Number.isFinite(n)) return null
  return Math.round(n / 1e8 * 10) / 10 // 元 -> 亿
}

/** 批量拉取个股详情（公司介绍 + 基本面），按 code 返回 map，失败跳过 */
export async function fetchStockDetails(stocks) {
  const out = {}
  const queue = [...(stocks || [])]
  const workers = Array.from({ length: 6 }, async () => {
    while (queue.length) {
      const s = queue.shift()
      try { out[s.code] = await fetchStockDetail(s.code, s.market) }
      catch { /* skip */ }
    }
  })
  await Promise.all(workers)
  return out
}

/* ------------------------------------------------------------------------ */
/* 涨停板模拟交易系统（规则化回测）                                           */
/* ------------------------------------------------------------------------ */

function round2(v) { return Math.round(Number(v || 0) * 100) / 100 }

/** 东财 7x24 全局快讯（宏观/政策/行业动态来源） */
export async function fetchMacroNews(count = 30) {
  const t = Date.now()
  try {
    const j = await getJson(`https://np-listapi.eastmoney.com/comm/web/getFastNewsList?client=web&biz=web_724&fastColumn=102&sortEnd=&pageSize=${count}&req_trace=${t}`)
    const list = (j && j.data && j.data.fastNewsList) || []
    return list.map((x) => ({ title: x.title || x.summary || '', time: x.showTime || '' }))
  } catch { return [] }
}

/** 最近 N 个交易日的日期（上证指数日线，升序） */
async function fetchTradingDays(count = 40) {
  try {
    const j = await getJson(`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=1.000001&klt=101&fqt=1&lmt=${count}&end=20500101&fields1=f1&fields2=f51,f53&_=${Date.now()}`)
    return ((j && j.data && j.data.klines) || []).map((l) => String(l).split(',')[0])
  } catch { return [] }
}

/**
 * 涨停板次日追涨策略回测。
 * 规则：涨停日 D 次日开盘价买入；持有期 holdDays 日内，+take 止盈、-stop 止损（同时触发止损优先）；
 * 到期未触发按第 holdDays 日收盘卖出。每只等额 1 万元模拟本金。
 */
export async function backtestStrategy(opts = {}) {
  const holdDays = opts.holdDays || 5
  const take = opts.take ?? 0.05
  const stop = opts.stop ?? 0.05
  const days = opts.days || 8

  const allDays = await fetchTradingDays(60)
  const last = allDays.length - 1
  if (last < holdDays + 2) return { error: '历史交易日数据不足' }

  const maxD = last - holdDays
  const minD = Math.max(0, last - holdDays - days + 1)

  // 1) 逐日拉涨停池
  const pools = []
  for (let di = maxD; di >= minD; di--) {
    const date = allDays[di]
    if (!date) continue
    try {
      const pool = await fetchLimitPool('zt', date.replace(/-/g, ''))
      pools.push({ date, di, stocks: (pool || []).filter((s) => !isSTName(s.name) && (s.amount || 0) >= 50000000) })
    } catch { /* skip */ }
  }

  // 2) 拉个股日线（去重 + 并发）
  const codeMap = new Map()
  for (const p of pools) for (const s of p.stocks) if (!codeMap.has(s.code)) codeMap.set(s.code, s)
  const klines = {}
  const q = [...codeMap.keys()]
  const workers = Array.from({ length: 8 }, async () => {
    while (q.length) {
      const code = q.shift()
      const s = codeMap.get(code)
      try { klines[code] = await fetchStockKline(code, s.market === 1 ? '1' : '0', 40) }
      catch { klines[code] = [] }
    }
  })
  await Promise.all(workers)

  // 3) 模拟交易
  const trades = []
  for (const p of pools) {
    for (const s of p.stocks) {
      const rows = klines[s.code] || []
      let dIdx = -1
      for (let i = 0; i < rows.length; i++) if (rows[i].date === p.date) { dIdx = i; break }
      if (dIdx < 0) continue
      const e = dIdx + 1
      if (e + holdDays - 1 >= rows.length) continue
      const entryBar = rows[e]
      const prevBar = rows[dIdx]
      // 一字涨停（开=高=低且相对前一日≈涨停）无法买入，跳过
      if (entryBar.high === entryBar.low && prevBar.close > 0 && (entryBar.close - prevBar.close) / prevBar.close > 0.09) continue
      const entry = entryBar.open
      if (!entry || entry <= 0) continue

      let exit = null, exitDate = null, rule = '时间', held = holdDays
      for (let k = 0; k < holdDays; k++) {
        const bar = rows[e + k]
        const hitTake = bar.high >= entry * (1 + take)
        const hitStop = bar.low <= entry * (1 - stop)
        if (hitTake && hitStop) { exit = entry * (1 - stop); rule = '止损'; exitDate = bar.date; held = k + 1; break }
        if (hitTake) { exit = entry * (1 + take); rule = '止盈'; exitDate = bar.date; held = k + 1; break }
        if (hitStop) { exit = entry * (1 - stop); rule = '止损'; exitDate = bar.date; held = k + 1; break }
        if (k === holdDays - 1) { exit = bar.close; rule = '时间'; exitDate = bar.date; held = holdDays }
      }
      if (exit == null) continue
      trades.push({
        code: s.code, market: s.market, name: s.name, industry: s.industry || '',
        buyDate: rows[e].date, entry: round2(entry),
        sellDate: exitDate, exit: round2(exit), retPct: round2(((exit - entry) / entry) * 100), rule, held,
      })
    }
  }

  trades.sort((a, b) => (a.buyDate < b.buyDate ? 1 : -1))

  // 4) 统计
  const n = trades.length
  const wins = trades.filter((t) => t.retPct > 0).length
  const losses = trades.filter((t) => t.retPct < 0).length
  const flats = n - wins - losses
  const sum = trades.reduce((s, t) => s + t.retPct, 0)
  const best = trades.reduce((m, t) => Math.max(m, t.retPct), -Infinity)
  const worst = trades.reduce((m, t) => Math.min(m, t.retPct), Infinity)
  const avgHold = n ? trades.reduce((s, t) => s + t.held, 0) / n : 0

  return {
    kind: 'backtest',
    computedAt: new Date().toISOString(),
    rules: {
      buy: '涨停次日开盘价买入（剔除 ST、成交额<5000万、次日一字不可买），每只 1 万元等额',
      takeProfit: `+${Math.round(take * 100)}% 止盈卖出`,
      stopLoss: `-${Math.round(stop * 100)}% 止损卖出（基本面没问题但被行情错杀，跌破支撑即离场）`,
      timeStop: `持有 ${holdDays} 个交易日未触发则收盘卖出`,
      bothHit: '同日同时触及止盈止损：止损优先（保守）',
      universe: `近 ${days} 个可完整回测的涨停交易日，共覆盖 ${codeMap.size} 只个股`,
    },
    stats: {
      totalTrades: n,
      winRate: n ? round1(wins / n * 100) : 0,
      winCount: wins, lossCount: losses, flatCount: flats,
      avgRetPct: round2(n ? sum / n : 0),
      totalRetPct: round2(sum),
      totalPnlYuan: Math.round(sum * 100), // 每只 1 万本金：1 个百分点 = 100 元
      bestPct: n ? round2(best) : 0,
      worstPct: n ? round2(worst) : 0,
      profitFactor: losses ? round2(wins / Math.max(1, losses)) : null,
      avgHoldDays: round1(avgHold),
      takeCount: trades.filter((t) => t.rule === '止盈').length,
      stopCount: trades.filter((t) => t.rule === '止损').length,
      timeCount: trades.filter((t) => t.rule === '时间').length,
    },
    trades: trades.slice(0, 200),
  }
}
export async function fetchStockDetail(code, market) {
  const sc = String(code || '') + secuSuffix(market)
  const fields = 'f12,f13,f14,f2,f3,f9,f20,f21,f23,f100'
  const out = { code: String(code || ''), market: String(market || ''), profile: null, mainBusiness: null, industry: null, province: null, fundamentals: null }

  // 1) 报价/估值
  try {
    const q = await getJson(`https://push2.eastmoney.com/api/qt/ulist.np/get?secids=${market}.${code}&fields=${fields}&ut=${UT}&_=${Date.now()}`)
    const x = ((q && q.data && q.data.diff) || [])[0] || {}
    const scale = market === '116' ? 1000 : 100
    out.name = x.f14 || ''
    out.price = x.f2 ? x.f2 / scale : null
    out.changePct = x.f3 != null ? Number(x.f3) / 100 : null
    out.pe = x.f9 != null ? Number(x.f9) / 100 : null
    out.pb = x.f23 != null ? Number(x.f23) / 100 : null
    out.totalMv = x.f20 != null ? Number(x.f20) : null
    out.floatMv = x.f21 != null ? Number(x.f21) : null
    out.industry = out.industry || x.f100 || null
  } catch { /* ignore */ }

  // 2) 公司简介
  try {
    const p = await getJson(`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_BASIC_ORGINFO&columns=SECUCODE,SECURITY_CODE,SECURITY_NAME_ABBR,ORG_PROFILE,MAIN_BUSINESS,PROVINCE,INDUSTRYCSRC1&filter=(SECURITY_CODE%3D%22${code}%22)&pageNumber=1&pageSize=1`)
    const row = (((p && p.result && p.result.data) || [])[0]) || {}
    out.profile = row.ORG_PROFILE || null
    out.mainBusiness = row.MAIN_BUSINESS || null
    out.province = row.PROVINCE || null
    out.industry = out.industry || row.INDUSTRYCSRC1 || null
    out.name = out.name || row.SECURITY_NAME_ABBR || ''
  } catch { /* ignore */ }

  // 3) 主要财务指标（最近一期）
  try {
    const f = await getJson(`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=REPORT_DATE,EPSJB,BPS,TOTALOPERATEREVE,PARENTNETPROFIT,TOTALOPERATEREVETZ,PARENTNETPROFITTZ,ROEJQ,XSMLL,ZCFZL,MGJYXJJE&filter=(SECUCODE%3D%22${sc}%22)&pageNumber=1&pageSize=1&sortTypes=-1&sortColumns=REPORT_DATE`)
    const row = (((f && f.result && f.result.data) || [])[0]) || {}
    if (row.REPORT_DATE) {
      out.fundamentals = {
        reportDate: row.REPORT_DATE ? String(row.REPORT_DATE).slice(0, 10) : null,
        eps: row.EPSJB != null ? Number(row.EPSJB) : null,
        bps: row.BPS != null ? Number(row.BPS) : null,
        revenue: row.TOTALOPERATEREVE != null ? Number(row.TOTALOPERATEREVE) : null,
        netProfit: row.PARENTNETPROFIT != null ? Number(row.PARENTNETPROFIT) : null,
        revenueYoy: row.TOTALOPERATEREVETZ != null ? Number(row.TOTALOPERATEREVETZ) : null,
        netProfitYoy: row.PARENTNETPROFITTZ != null ? Number(row.PARENTNETPROFITTZ) : null,
        roe: row.ROEJQ != null ? Number(row.ROEJQ) : null,
        grossMargin: row.XSMLL != null ? Number(row.XSMLL) : null,
        debtRatio: row.ZCFZL != null ? Number(row.ZCFZL) : null,
        ocfPerShare: row.MGJYXJJE != null ? Number(row.MGJYXJJE) : null,
      }
    }
  } catch { /* ignore */ }

  return out
}

/* ------------------------------------------------------------------------ */
/* 个股行情详情补充：K线（分时/日/月）、财报历史、公告资讯                    */
/* ------------------------------------------------------------------------ */

function parseKlineRaw(rawList) {
  return (rawList || []).map((l) => {
    const a = String(l).split(',')
    return { t: a[0], open: +a[1], close: +a[2], high: +a[3], low: +a[4], volume: +a[5], amount: +a[6] }
  })
}

/** 任一周期 K 线：klt=1 分时(分钟) / 101 日 / 102 周 / 103 月 */
export async function fetchKline(code, market, klt = 101, lmt = 120) {
  const secid = `${market}.${code}`
  const u = `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${secid}&klt=${klt}&fqt=1&lmt=${lmt}&end=20500101&fields1=f1,f2,f3&fields2=f51,f52,f53,f54,f55,f56,f57&_=${Date.now()}`
  const j = await getJson(u)
  return parseKlineRaw((j && j.data && j.data.klines) || [])
}

/** 分时（当日 1 分钟线） */
export async function fetchMinuteTrend(code, market) {
  return fetchKline(code, market, 1, 240)
}

/** 多期主要财务指标（近 count 期） */
export async function fetchFinancialHistory(code, market, count = 6) {
  const sc = String(code) + secuSuffix(market)
  try {
    const f = await getJson(`https://datacenter.eastmoney.com/securities/api/data/v1/get?reportName=RPT_F10_FINANCE_MAINFINADATA&columns=REPORT_DATE,EPSJB,TOTALOPERATEREVE,PARENTNETPROFIT,TOTALOPERATEREVETZ,PARENTNETPROFITTZ,ROEJQ&filter=(SECUCODE%3D%22${sc}%22)&pageNumber=1&pageSize=${count}&sortTypes=-1&sortColumns=REPORT_DATE`)
    return (((f && f.result && f.result.data) || [])).map((r) => ({
      date: r.REPORT_DATE ? String(r.REPORT_DATE).slice(0, 10) : null,
      eps: r.EPSJB != null ? Number(r.EPSJB) : null,
      revenue: r.TOTALOPERATEREVE != null ? Number(r.TOTALOPERATEREVE) : null,
      netProfit: r.PARENTNETPROFIT != null ? Number(r.PARENTNETPROFIT) : null,
      revenueYoy: r.TOTALOPERATEREVETZ != null ? Number(r.TOTALOPERATEREVETZ) : null,
      netProfitYoy: r.PARENTNETPROFITTZ != null ? Number(r.PARENTNETPROFITTZ) : null,
      roe: r.ROEJQ != null ? Number(r.ROEJQ) : null,
    }))
  } catch { return [] }
}

/** 公告 / 资讯 */
export async function fetchAnnouncements(code, count = 8) {
  try {
    const d = await getJson(`https://np-anotice-stock.eastmoney.com/api/security/ann?sr=-1&page_size=${count}&page_index=1&ann_type=A&client_source=web&stock_list=${code}`)
    const list = (d && d.data && d.data.list) || []
    return list.map((x) => ({ title: x.title || '', date: x.notice_date ? String(x.notice_date).slice(0, 10) : '' }))
  } catch { return [] }
}

/** 完整详情：在轻量 fetchStockDetail 基础上补充 K线/财报历史/公告 */
export async function fetchStockDetailFull(code, market) {
  const base = await fetchStockDetail(code, market)
  const [dailies, monthlies, minute, financials, announcements] = await Promise.all([
    fetchKline(code, market, 101, 120).catch(() => []),
    fetchKline(code, market, 103, 60).catch(() => []),
    fetchMinuteTrend(code, market).catch(() => []),
    fetchFinancialHistory(code, market, 6).catch(() => []),
    fetchAnnouncements(code, 8).catch(() => []),
  ])
  base.klines = dailies
  base.klinesMonth = monthlies
  base.minute = minute
  base.financialHistory = financials
  base.announcements = announcements
  return base
}