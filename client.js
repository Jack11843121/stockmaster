/* Client half: a single A-share market dashboard page. */
window.__ModuleLoader__.load({
  id: '@local/dsh-stock-dashboard',
  factory(require) {
    const React = require('react')
    const h = React.createElement
    const { useState, useEffect, useMemo } = React

    const PANEL_ID = 'stock-dashboard'

    const zh = { panel: '股票大师' }
    const en = { panel: 'StockMaster' }

    const C = {
      bg: 'var(--dsw-alias-bg-base)',
      surface: 'var(--dsw-alias-bg-layer-1)',
      surface2: 'var(--dsw-alias-bg-layer-2)',
      overlay: 'var(--dsw-alias-bg-overlay)',
      border: 'var(--dsw-alias-border-l1)',
      border2: 'var(--dsw-alias-border-l2)',
      brand: 'var(--dsw-alias-brand-primary)',
      text: 'var(--dsw-alias-label-primary)',
      text2: 'var(--dsw-alias-label-secondary)',
      up: 'var(--dsw-alias-state-error-primary)',
      down: 'var(--dsw-alias-state-success-primary)',
      warn: 'var(--dsw-alias-state-warn-primary)',
    }

    // A 股传统配色：红涨绿跌
    function pctColor(v) {
      if (v == null) return C.text2
      return v > 0 ? C.up : v < 0 ? C.down : C.text2
    }
    function pctText(v) {
      if (v == null) return '—'
      const n = Number(v)
      return (n > 0 ? '+' : '') + n.toFixed(2) + '%'
    }

    function PanelIcon(props) {
      const s = props.size || 20
      return h('svg', { viewBox: '0 0 64 64', width: s, height: s, 'aria-hidden': true, style: { display: 'block' } },
        h('rect', { x: 6, y: 8, width: 52, height: 48, rx: 8, fill: '#1a5c8f' }),
        h('path', { d: 'M10 42 L22 34 L30 40 L44 22 L54 28', stroke: '#fff', strokeWidth: 4, fill: 'none', strokeLinecap: 'round', strokeLinejoin: 'round' }),
        h('circle', { cx: 44, cy: 22, r: 3, fill: '#e88a1a' }),
      )
    }

    class Boundary extends React.Component {
      constructor(props) { super(props); this.state = { error: null } }
      static getDerivedStateFromError(error) { return { error } }
      render() {
        if (this.state.error) {
          const msg = this.state.error && (this.state.error.message || String(this.state.error))
          return h('div', { style: { padding: 24, color: C.up, fontSize: 13, fontFamily: 'monospace', whiteSpace: 'pre-wrap' } }, '股市看板渲染出错：\n' + msg)
        }
        return this.props.children
      }
    }

    /* ---- helpers ---------------------------------------------------------- */
    function fmtYi(v) { return v == null ? '—' : (v / 1e8).toFixed(0) + '亿' }
    function fmtPrice(v) { return v == null ? '—' : Number(v).toFixed(2) }
    function fmtNum(v) { return v == null ? '—' : Number(v).toLocaleString('zh-CN') }

    /* ---- SVG line chart --------------------------------------------------- */
    function LineChart(props) {
      const { data = [], width = 320, height = 88, color = C.brand, labels = [] } = props
      const pad = { l: 4, r: 4, t: 6, b: 14 }
      const vals = data.map(Number).filter((n) => Number.isFinite(n))
      if (!vals.length) return h('div', { style: { height, color: C.text2, fontSize: 12, display: 'flex', alignItems: 'center' } }, '暂无数据')
      let min = Math.min(...vals), max = Math.max(...vals)
      if (min === max) { min -= 1; max += 1 }
      const w = width - pad.l - pad.r, hh = height - pad.t - pad.b
      const px = (i) => pad.l + (w * i) / Math.max(1, vals.length - 1)
      const py = (v) => pad.t + hh - ((v - min) * hh) / (max - min)
      const pts = vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ')
      const area = `${pad.l},${py(min)} ` + vals.map((v, i) => `${px(i).toFixed(1)},${py(v).toFixed(1)}`).join(' ') + ` ${pad.l + w},${py(min)}`
      const up = vals[vals.length - 1] >= vals[0]
      const line = up ? '#e0483e' : '#2ea06a'
      const lastLabel = labels[labels.length - 1]
      return h('svg', { viewBox: `0 0 ${width} ${height}`, width: '100%', height, preserveAspectRatio: 'none', style: { display: 'block' } },
        h('polygon', { points: area, fill: line, opacity: 0.10 }),
        h('polyline', { points: pts, fill: 'none', stroke: line, strokeWidth: 1.6, strokeLinejoin: 'round' }),
        lastLabel ? h('text', { x: pad.l, y: height - 3, fontSize: 9, fill: C.text2 }, lastLabel) : null,
        h('text', { x: width - pad.r, y: pad.t + 6, fontSize: 9, fill: line, textAnchor: 'end' }, (up ? '+' : '') + (vals[vals.length - 1] - vals[0]).toFixed(2)),
      )
    }

    /* ---- markdown-lite renderer ------------------------------------------ */
    function renderMd(text) {
      if (!text) return null
      const lines = String(text).split('\n')
      const out = []
      let list = null
      const flushList = () => { if (list) { out.push(h('ul', { key: out.length, style: { margin: '4px 0 10px', paddingLeft: 20 } }, list)); list = null } }
      lines.forEach((ln, i) => {
        const line = ln.trimEnd()
        if (/^###\s+/.test(line)) { flushList(); out.push(h('h3', { key: i, style: { fontSize: 14, margin: '14px 0 4px', color: C.text } }, inline(line.replace(/^###\s+/, '')))) }
        else if (/^##\s+/.test(line)) { flushList(); out.push(h('h2', { key: i, style: { fontSize: 16, margin: '16px 0 6px', color: C.text, borderBottom: `1px solid ${C.border2}`, paddingBottom: 4 } }, inline(line.replace(/^##\s+/, '')))) }
        else if (/^#\s+/.test(line)) { flushList(); out.push(h('h1', { key: i, style: { fontSize: 18, margin: '4px 0 8px', color: C.text } }, inline(line.replace(/^#\s+/, '')))) }
        else if (/^[-*]\s+/.test(line)) { list = list || []; list.push(h('li', { key: list.length, style: { margin: '2px 0', lineHeight: 1.7 } }, inline(line.replace(/^[-*]\s+/, '')))) }
        else if (line.trim() === '') { flushList() }
        else { flushList(); out.push(h('p', { key: i, style: { margin: '0 0 8px', lineHeight: 1.8 } }, inline(line))) }
      })
      flushList()
      return out
    }
    function inline(text) {
      const parts = String(text).split(/\*\*(.+?)\*\*/g)
      return parts.map((p, i) => i % 2 === 1 ? h('strong', { key: i, style: { color: C.text } }, p) : p)
    }

    /* ---- section / ui ----------------------------------------------------- */
    function Section(props) {
      return h('section', { style: { background: C.overlay, border: `1px solid ${C.border2}`, borderRadius: 12, padding: '14px 16px', marginBottom: 12 } },
        h('div', { style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10, display: 'flex', alignItems: 'center', gap: 8 } }, props.title, props.extra),
        props.children)
    }
    const th = { textAlign: 'left', fontSize: 12, color: C.text2, fontWeight: 600, padding: '4px 8px', borderBottom: `1px solid ${C.border2}`, whiteSpace: 'nowrap' }
    const td = { fontSize: 12.5, color: C.text, padding: '5px 8px', borderBottom: `1px solid ${C.border}`, whiteSpace: 'nowrap' }
    function Table(props) {
      return h('div', { style: { overflowX: 'auto' } },
        h('table', { style: { borderCollapse: 'collapse', width: '100%', minWidth: props.minWidth || 560 } },
          h('thead', null, h('tr', null, props.cols.map((c, i) => h('th', { key: i, style: th }, c)))),
          h('tbody', null, props.rows.map((r, i) => h('tr', { key: i, style: { background: i % 2 ? 'transparent' : C.surface } }, r.map((cell, j) => h('td', { key: j, style: td }, cell)))))))
    }
    function Tag(props) {
      const bg = props.kind === 'hot' ? 'rgba(224,72,62,0.12)' : 'rgba(46,160,106,0.12)'
      const c = props.kind === 'hot' ? C.up : C.down
      return h('span', { style: { display: 'inline-block', padding: '1px 7px', borderRadius: 20, fontSize: 11, fontWeight: 600, background: bg, color: c } }, props.children)
    }
    function Button(props) {
      return h('button', { onClick: props.onClick, disabled: props.disabled,
        style: { fontFamily: 'inherit', borderRadius: 6, padding: '6px 12px', fontSize: 13, cursor: props.disabled ? 'default' : 'pointer', background: props.primary ? C.brand : C.surface2, color: props.primary ? '#fff' : C.text, border: props.primary ? '1px solid transparent' : `1px solid ${C.border}`, opacity: props.disabled ? 0.5 : 1, ...(props.style || {}) } }, props.children)
    }

    /* ---- dashboard -------------------------------------------------------- */
    function Dashboard() {
      const [state, setState] = useState(null)
      const [loading, setLoading] = useState(true)
      const [err, setErr] = useState('')
      const [refreshing, setRefreshing] = useState(false)
      const [refreshingSwing, setRefreshingSwing] = useState(false)
      const [copied, setCopied] = useState(false)
      const [showConfig, setShowConfig] = useState(false)
      const [showModel, setShowModel] = useState(false)
      const [detailStock, setDetailStock] = useState(null)
      const [details, setDetails] = useState({})
      const tradingRef = React.useRef(false)
      const [histList, setHistList] = useState([])
      const [histDate, setHistDate] = useState('')
      const histModeRef = React.useRef(false)

      async function load() {
        try {
          const r = await fetch('/stock-dashboard/state', { credentials: 'include' })
          const j = await r.json()
          tradingRef.current = !!j.trading
          setState(j); setErr('')
        } catch (e) { setErr(String(e && e.message || e)) } finally { setLoading(false) }
      }
      useEffect(() => { load() }, [])

      // 历史看板：日期列表 + 切换
      useEffect(() => {
        fetch('/stock-dashboard/history', { credentials: 'include' })
          .then((r) => r.json()).then((j) => { if (j.ok && Array.isArray(j.list)) setHistList(j.list) }).catch(() => {})
      }, [])
      async function selectDate(v) {
        if (!v) {
          histModeRef.current = false
          setHistDate('')
          await load()
          return
        }
        try {
          const r = await fetch('/stock-dashboard/history?date=' + encodeURIComponent(v), { credentials: 'include' })
          const j = await r.json()
          if (j.ok) {
            histModeRef.current = true
            setHistDate(v)
            setState({ ...j, historyMode: true })
            setErr('')
          } else setErr(j.error || '加载历史失败')
        } catch (e) { setErr(String(e && e.message || e)) }
      }

      // 盘中每 60 秒快速刷新行情（跳过全市场分页），休市仅低开销轮询最新状态；查看历史时不自动刷新
      useEffect(() => {
        const tick = async () => {
          if (histModeRef.current) return
          if (tradingRef.current) {
            try { await fetch('/stock-dashboard/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ quick: true }), credentials: 'include' }) } catch { /* ignore */ }
          }
          await load()
        }
        const id = setInterval(tick, 60000)
        return () => clearInterval(id)
      }, [])

      // 拉取公司介绍与基本面（批量、去重、服务端缓存 5 分钟），用于表格内联展示
      const lastCodesRef = React.useRef('')
      useEffect(() => {
        if (!state) return
        const codes = []
        const seen = new Set()
        const push = (arr) => (arr || []).forEach((x) => {
          if (x && x.code && !seen.has(x.code)) { seen.add(x.code); codes.push({ code: x.code, market: x.market }) }
        })
        push(state.snapshot && state.snapshot.holdings)
        push(state.report && state.report.limitUp)
        push(state.report && state.report.limitDown)
        push(state.swing && state.swing.oversold)
        push(state.swing && state.swing.trend)
        const key = codes.map((c) => c.market + '.' + c.code).sort().join('|')
        if (!key || key === lastCodesRef.current) return
        lastCodesRef.current = key
        fetch('/stock-dashboard/stock-details', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stocks: codes }) })
          .then((r) => r.json())
          .then((j) => { if (j.ok && j.details) setDetails((prev) => ({ ...prev, ...j.details })) })
          .catch(() => {})
      }, [state])

      async function onRefresh() {
        if (histModeRef.current) return
        setRefreshing(true)
        try {
          const r = await fetch('/stock-dashboard/refresh', { method: 'POST', credentials: 'include' })
          const j = await r.json()
          if (j.ok) { setState((s) => ({ ...(s || {}), snapshot: j.snapshot })) } else setErr(j.error || '刷新失败')
        } catch (e) { setErr(String(e && e.message || e)) } finally { setRefreshing(false) }
      }

      async function onRefreshSwing() {
        if (histModeRef.current) return
        setRefreshingSwing(true)
        try {
          await fetch('/stock-dashboard/screen', { method: 'POST', credentials: 'include' })
          await load()
        } catch (e) { setErr('刷新右侧机会失败：' + String(e && e.message || e)) } finally { setRefreshingSwing(false) }
      }

      async function onCopy() {
        const art = state && state.report && (state.report.article || '')
        if (!art) return
        try { await navigator.clipboard.writeText(art); setCopied(true); setTimeout(() => setCopied(false), 2000) } catch { /* ignore */ }
      }

      const snap = state && state.snapshot
      const rep = state && state.report
      const swing = state && state.swing
      const trading = state && state.trading
      const portfolio = state && state.portfolio
      const backtest = state && state.backtest
      const strategy = state && state.strategy
      const macro = state && state.macro

      return h('div', { style: { height: '100%', overflow: 'auto', padding: '20px 22px', background: C.bg, color: C.text, boxSizing: 'border-box' } },
        h('div', { style: { width: '100%', maxWidth: 1380, margin: '0 auto', paddingBottom: 40 } },
          // header
          h('div', { style: { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap', marginBottom: 4 } },
            h('div', null,
              h('h1', { style: { fontSize: 20, margin: '0 0 4px', color: C.text } }, rep && rep.title ? rep.title : '股市看板'),
              h('div', { style: { fontSize: 12, color: C.text2 } },
                '交易日 ' + (snap && snap.tradingDay ? snap.tradingDay : '—') +
                (snap ? ' · 行情 ' + new Date(snap.fetchedAt).toLocaleString('zh-CN') : '') +
                (rep && rep.updatedAt ? ' · 分析 ' + new Date(rep.updatedAt).toLocaleString('zh-CN') : ''))),
            h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' } },
              trading ? h(Tag, { kind: 'hot' }, '盘中实时') : h(Tag, { kind: 'cold' }, '休市 · 最新数据'),
              h('select', { value: histDate, onChange: (e) => selectDate(e.target.value), style: { fontFamily: 'inherit', padding: '6px 8px', fontSize: 12.5, background: C.surface2, color: C.text, border: '1px solid ' + C.border, borderRadius: 6, cursor: 'pointer', outline: 'none', maxWidth: 260 } },
                h('option', { value: '' }, '最新看板'),
                histList.map((d) => h('option', { key: d.date, value: d.date }, d.date + (d.title ? ' · ' + d.title.slice(0, 16) : '')))),
              h(Button, { onClick: () => setShowConfig((v) => !v) }, showConfig ? '关闭持仓设置' : '持仓设置'),
              h(Button, { onClick: () => setShowModel((v) => !v) }, showModel ? '关闭模型配置' : '模型配置'),
              h(Button, { onClick: onRefresh, disabled: refreshing }, refreshing ? '刷新中…' : '刷新行情'),
              h(Button, { primary: true, onClick: onCopy, disabled: !(rep && rep.article) }, copied ? '已复制' : '复制成文')),
          ),
          histDate && h('div', { style: { display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12, padding: '9px 13px', background: C.overlay, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 12.5, color: C.text } },
            h('span', { style: { color: C.text2 } }, '正在查看历史看板：' + histDate + '（数据为当日收盘快照）'),
            h('span', { onClick: () => selectDate(''), style: { color: C.brand, cursor: 'pointer', fontWeight: 600 } }, '回到最新')),
          h(InsightsPanel, { strategy, macro, onRefreshMacro: load }),
          h(AIAnalyst),
          detailStock && h(StockDetailModal, { stock: detailStock, onClose: () => setDetailStock(null) }),
          showConfig && h(ConfigPanel, { portfolio, onSaved: load }),
          showModel && h(ModelPanel),
          err && h('div', { style: { color: C.warn, fontSize: 13, margin: '10px 0' } }, err),
          loading && h('div', { style: { color: C.text2, fontSize: 13, padding: '40px 0' } }, '加载中…'),

          snap && h('div', null,
            h(Section, { title: '市场概览', extra: sentimentBadge(rep && rep.sentiment) },
              indexGrid(snap.indices), breadthRow(snap)),
            h(Section, { title: '关键指数趋势' },
              indexCharts(snap.indices)),
            h(Section, { title: '我的持仓' },
              holdingsTable(snap.holdings, (s) => setDetailStock(s))),
            h(Section, { title: '涨停股分析（连板/封单为盘中实时，概率为盘后AI）' },
              limitUpTable(mergeAnalysis(snap.limitUp, rep && rep.limitUp), (s) => setDetailStock(s), details)),
            h(Section, { title: '跌停股分析（连跌为盘中实时，反转概率为盘后AI）' },
              limitDownTable(mergeAnalysis(snap.limitDown, rep && rep.limitDown), (s) => setDetailStock(s), details)),
          ),

          backtestSection(backtest, (s) => setDetailStock(s)),
          swingSection(swing, (s) => setDetailStock(s), onRefreshSwing, refreshingSwing),
          (rep && rep.recommend) && recommendBlock(rep.recommend),
          rep && h('div', null,
            rep.market && rep.market.review && h(Section, { title: '当日复盘' }, h('div', { style: { fontSize: 13, lineHeight: 1.8, color: C.text } }, rep.market.review)),
            rep.tomorrow && h(Section, { title: '次日预判与建议' }, h('div', { style: { fontSize: 13, lineHeight: 1.8, color: C.text } }, rep.tomorrow)),
            rep.article && h(Section, { title: '成文（可直接发社区）', extra: h(Tag, { kind: 'hot' }, 'Markdown') },
              h('div', { style: { fontSize: 13, color: C.text } }, renderMd(rep.article)))),
        ),
      )
    }

    function sentimentBadge(sent) {
      if (!sent) return null
      const { label, score } = sent
      const tone = score >= 60 ? C.up : score <= 40 ? C.down : C.warn
      return h('span', { style: { fontSize: 12, padding: '2px 10px', borderRadius: 20, background: 'transparent', border: `1px solid ${tone}`, color: tone } }, (label || '情绪') + (score != null ? ' ' + score : ''))
    }

    function indexGrid(indices) {
      const items = (indices || []).slice(0, 6)
      return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 10 } },
        items.map((ix) => h('div', { key: ix.code + ix.market, style: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: '10px 12px' } },
          h('div', { style: { fontSize: 12, color: C.text2 } }, ix.name),
          h('div', { style: { fontSize: 18, fontWeight: 700, color: C.text, margin: '4px 0 2px' } }, fmtPrice(ix.price)),
          h('div', { style: { fontSize: 12, color: pctColor(ix.changePct), fontWeight: 600 } }, pctText(ix.changePct)))))
    }

    function breadthRow(snap) {
      const b = snap.breadth || {}
      const s = snap.sentiment || {}
      const items = []
      if (b && !b.error) {
        items.push({ k: '上涨', v: fmtNum(b.up), color: C.up })
        items.push({ k: '下跌', v: fmtNum(b.down), color: C.down })
        items.push({ k: '平盘', v: fmtNum(b.flat), color: C.text2 })
      }
      items.push({ k: '涨停', v: s.limitUpCount, color: C.up })
      items.push({ k: '跌停', v: s.limitDownCount, color: C.down })
      items.push({ k: '连板高度', v: (s.maxLbc || 0) + ' 板', color: C.text })
      if (s.totalAmountYi) items.push({ k: '两市成交', v: s.totalAmountYi + ' 亿', color: C.text })
      return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(110px, 1fr))', gap: 8, marginTop: 12 } },
        items.map((x) => h('div', { key: x.k, style: { background: C.surface2, border: '1px solid ' + C.border, borderRadius: 8, padding: '9px 10px', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 2 } },
          h('div', { style: { fontSize: 11, color: C.text2 } }, x.k),
          h('div', { style: { fontSize: 15, fontWeight: 700, color: x.color } }, x.v))))
    }

    function indexCharts(indices) {
      const items = (indices || []).filter((i) => (i.klines || []).length > 3)
      if (!items.length) return h('div', { style: { color: C.text2, fontSize: 12.5 } }, '暂无指数数据')
      return h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(300px,1fr))', gap: 12 } },
        items.map((ix) => {
          const closes = ix.klines.map((k) => k.close)
          const labels = ix.klines.map((k) => String(k.date).slice(5))
          return h('div', { key: ix.code + ix.market, style: { background: C.surface, border: `1px solid ${C.border}`, borderRadius: 10, padding: 10 } },
            h('div', { style: { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 6 } },
              h('span', { style: { fontSize: 12.5, fontWeight: 600, color: C.text } }, ix.name),
              h('span', { style: { fontSize: 12, color: pctColor(ix.changePct) } }, pctText(ix.changePct))),
            h(LineChart, { data: closes, labels, height: 96 }))
        }))
    }

    function nameCell(stock, onStock) {
      return h('span', { onClick: () => onStock && onStock(stock), title: '查看公司介绍与基本面', style: { color: C.brand, cursor: onStock ? 'pointer' : 'default' } }, stock.name)
    }
    function signed(v) { return (v > 0 ? '+' : '') + Number(v).toFixed(1) }
    function sign(v) { return (v > 0 ? '+' : '') }
    function fmtAmount(yuan) {
      if (yuan == null) return '—'
      const yi = yuan / 1e8
      if (yi >= 10) return yi.toFixed(2) + ' 亿'
      const wan = yuan / 1e4
      return wan.toFixed(2).replace(/\.?0+$/, '') + ' 万'
    }
    function fundLine(d) {
      if (!d) return null
      const f = d.fundamentals
      const bits = []
      if (d.mainBusiness) bits.push('主营 ' + String(d.mainBusiness).slice(0, 36))
      if (d.pe != null) bits.push('PE ' + d.pe.toFixed(1))
      if (d.totalMv != null) bits.push('市值 ' + (d.totalMv / 1e8).toFixed(0) + '亿')
      if (f && f.revenue != null) bits.push('营收 ' + fmtAmount(f.revenue) + (f.revenueYoy != null ? '(' + signed(f.revenueYoy) + '%)' : ''))
      if (f && f.netProfit != null) bits.push('净利 ' + fmtAmount(f.netProfit) + (f.netProfitYoy != null ? '(' + signed(f.netProfitYoy) + '%)' : ''))
      if (f && f.roe != null) bits.push('ROE ' + f.roe.toFixed(1) + '%')
      return bits.join(' · ')
    }

    function holdingsTable(holdings, onStock) {
      const rows = (holdings || []).map((x) => [
        nameCell(x, onStock), x.code, txt(fmtPrice(x.price), C.text, 'monospace'),
        txt(pctText(x.changePct), pctColor(x.changePct), undefined, 600),
        txt(x.change == null ? '—' : (x.change > 0 ? '+' : '') + x.change.toFixed(2), pctColor(x.changePct), 'monospace'),
      ])
      return h(Table, { cols: ['名称', '代码', '最新价', '涨跌幅', '涨跌额'], minWidth: 560, rows })
    }

    // 事实数据（连板/封单/行业等）取实时快照，AI 观点（概率/分析文字）按代码叠加旧报告
    function mergeAnalysis(snapList, repList) {
      const byCode = new Map((repList || []).map((x) => [x.code, x]))
      return (snapList || []).map((x) => {
        const r = byCode.get(x.code)
        if (!r) return x
        return { ...x, againProb: r.againProb, reversalProb: r.reversalProb, score: r.score, analysis: r.analysis, reason: r.reason, fundamentals: r.fundamentals }
      })
    }

    function limitUpTable(list, onStock, details) {
      if (!list || !list.length) return h('div', { style: { fontSize: 12.5, color: C.text2 } }, '今日无涨停记录')
      const rows = list.map((x) => {
        const d = details && details[x.code]
        return [
          nameCell(x, onStock), x.code, h(Tag, { kind: 'hot' }, (x.lbc ?? 1) + ' 连板'), x.industry || '—',
          txt(x.againProb != null ? x.againProb + '%' : '—', probColor(x.againProb), undefined, 700),
          h('div', { style: { minWidth: 240, whiteSpace: 'normal', lineHeight: 1.55 } },
            x.analysis || x.reason || '',
            d ? h('div', { style: { fontSize: 11, color: C.text2, marginTop: 5, lineHeight: 1.55 } }, '🏢 ' + fundLine(d)) : null),
        ]
      })
      return h('div', null,
        h(Table, { cols: ['名称', '代码', '连板', '行业', '再板概率', '分析（含公司·基本面）'], minWidth: 720, rows }),
        h('div', { style: { fontSize: 11.5, color: C.text2, marginTop: 8, lineHeight: 1.6 } }, '点击股票名查看完整公司介绍。「再板概率」为 AI 综合封单强度、连板高度、题材热度与基本面给出的主观估计，仅供参考，不构成投资建议。'))
    }

    function limitDownTable(list, onStock, details) {
      if (!list || !list.length) return h('div', { style: { fontSize: 12.5, color: C.text2 } }, '今日无跌停记录')
      const rows = list.map((x) => {
        const d = details && details[x.code]
        return [
          nameCell(x, onStock), x.code, h(Tag, { kind: 'cold' }, (x.days ?? 1) + ' 连跌'), x.industry || '—',
          txt(x.reversalProb != null ? x.reversalProb + '%' : '—', revColor(x.reversalProb), undefined, 700),
          h('div', { style: { minWidth: 240, whiteSpace: 'normal', lineHeight: 1.55 } },
            x.analysis || x.reason || '',
            d ? h('div', { style: { fontSize: 11, color: C.text2, marginTop: 5, lineHeight: 1.55 } }, '🏢 ' + fundLine(d)) : null),
        ]
      })
      return h('div', null,
        h(Table, { cols: ['名称', '代码', '连跌', '行业', '反转概率', '分析（含公司·基本面）'], minWidth: 720, rows }),
        h('div', { style: { fontSize: 11.5, color: C.text2, marginTop: 8, lineHeight: 1.6 } }, '点击股票名查看完整公司介绍。「反转概率」为 AI 综合超跌程度、量能、封单与行业景气给出的主观估计，仅供参考，不构成投资建议。'))
    }

    function probColor(v) { if (v == null) return C.text2; return v >= 60 ? C.up : v >= 40 ? C.warn : C.text2 }
    function revColor(v) { if (v == null) return C.text2; return v >= 60 ? C.down : v >= 40 ? C.warn : C.text2 }
    function txt(str, color, fam, weight) {
      return h('span', { style: { color, fontFamily: fam, fontWeight: weight } }, str)
    }

    function InsightsPanel(props) {
      const { strategy, macro, onRefreshMacro } = props
      const [tab, setTab] = useState('strategy')
      const [busy, setBusy] = useState(false)
      const [err, setErr] = useState('')

      async function runMacro() {
        setBusy(true); setErr('')
        try {
          const r = await fetch('/stock-dashboard/macro', { method: 'POST', credentials: 'include' })
          const j = await r.json()
          if (!j.ok) setErr(j.error || '分析失败')
          onRefreshMacro && onRefreshMacro()
        } catch (e) { setErr(String(e && e.message || e)) } finally { setBusy(false) }
      }

      const tabBtn = (active) => ({
        flex: 1, padding: '9px 0', cursor: 'pointer', fontFamily: 'inherit', fontSize: 13.5, fontWeight: active ? 700 : 500,
        color: active ? C.text : C.text2, background: 'transparent', border: 'none',
        borderBottom: active ? '2px solid ' + C.brand : '2px solid transparent',
      })

      const lr = strategy && strategy.latestReflection
      const liRow = (idx, text, numbered) => h('div', { style: { display: 'flex', gap: 8, marginBottom: 2 } },
        h('div', { style: { flexShrink: 0, width: numbered ? 18 : 12, color: C.text2 } }, numbered ? (idx + 1) + '.' : '·'),
        h('div', { style: { flex: 1, fontSize: 12.5, color: C.text, lineHeight: 1.7 } }, text))
      const strategyBody = h('div', null,
        strategy && h('div', { style: { fontSize: 11.5, color: C.text2, marginBottom: 10 } }, '当前版本 v' + (strategy.version || '1') + ' · 每日反思迭代，逐步稳定'),
        strategy && strategy.summary && h('div', { style: { fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 12, lineHeight: 1.7 } }, strategy.summary),
        strategy && (strategy.principles || []).length > 0 && h('div', { style: { marginBottom: 12 } },
          h('div', { style: { fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 6 } }, '核心原则'),
          (strategy.principles || []).map((p, i) => liRow(i, p, true))),
        strategy && (strategy.rules || []).length > 0 && h('div', { style: { marginBottom: 6 } },
          h('div', { style: { fontSize: 12, fontWeight: 600, color: C.text2, marginBottom: 6 } }, '交易规则'),
          (strategy.rules || []).map((p, i) => liRow(i, p, false))),
        lr && lr.note && h('div', { style: { fontSize: 12, color: C.text2, lineHeight: 1.8, borderTop: '1px solid ' + C.border2, paddingTop: 10, marginTop: 12 } }, '最新反思（' + (lr.date || '') + '）：' + lr.note))

      const macroBody = h('div', null,
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 } },
          h(Button, { primary: true, onClick: runMacro, disabled: busy }, busy ? '正在抓取分析…' : '实时抓取分析'),
          macro && macro.generatedAt && h('span', { style: { fontSize: 12, color: C.text2 } }, '更新于 ' + new Date(macro.generatedAt).toLocaleString('zh-CN'))),
        err && h('div', { style: { color: C.warn, fontSize: 12.5, marginBottom: 8 } }, err),
        macro && macro.content
          ? h('div', { style: { fontSize: 13, color: C.text } }, renderMd(macro.content))
          : h('div', { style: { fontSize: 12.5, color: C.text2, lineHeight: 1.7 } }, '暂无分析。点击「实时抓取分析」，会用当前 Agent 模型抓取最新政策/行业/大环境资讯并给出深度研判。'))

      return h(Section, { title: '研判中心', extra: h(Tag, { kind: 'hot' }, '策略 · 宏观') },
        h('div', { style: { display: 'flex', borderBottom: '1px solid ' + C.border2, marginBottom: 14 } },
          h('button', { onClick: () => setTab('strategy'), style: tabBtn(tab === 'strategy') }, '交易系统'),
          h('button', { onClick: () => setTab('macro'), style: tabBtn(tab === 'macro') }, '宏观动态')),
        tab === 'strategy' ? strategyBody : macroBody)
    }

    function backtestSection(bt, onStock) {
      if (!bt) return null
      const st = bt.stats || {}
      const r = bt.rules || {}
      const c = (v, ref) => v != null && ref != null ? (ref > 0 ? C.up : ref < 0 ? C.down : C.text2) : C.text
      const cards = [
        { k: '回测笔数', v: st.totalTrades },
        { k: '胜率', v: st.winRate + '%', ref: st.winRate - 50 },
        { k: '平均收益', v: sign(st.avgRetPct) + st.avgRetPct + '%', ref: st.avgRetPct },
        { k: '累计收益', v: sign(st.totalRetPct) + st.totalRetPct + '%', ref: st.totalRetPct },
        { k: '累计盈亏(每只1万)', v: sign(st.totalPnlYuan) + st.totalPnlYuan + ' 元', ref: st.totalPnlYuan },
        { k: '最好 / 最差', v: '+' + st.bestPct + '% / ' + st.worstPct + '%' },
        { k: '止盈/止损/到期', v: st.takeCount + ' / ' + st.stopCount + ' / ' + st.timeCount },
        { k: '平均持有', v: st.avgHoldDays + ' 日' },
      ]
      const tradeRows = (bt.trades || []).slice(0, 40).map((t) => [
        t.buyDate, nameCell(t, onStock), t.entry, t.sellDate, t.exit,
        txt(sign(t.retPct) + t.retPct + '%', t.retPct > 0 ? C.up : t.retPct < 0 ? C.down : C.text2, undefined, 700),
        h(Tag, { kind: t.rule === '止盈' ? 'hot' : 'cold' }, t.rule + ' · 持' + t.held + '日'),
      ])
      return h(Section, { title: '模拟交易 · 涨停板次日策略', extra: h(Tag, { kind: 'hot' }, '回测') },
        h('div', { style: { fontSize: 12, color: C.text2, lineHeight: 1.9, marginBottom: 12 } },
          Object.keys(r).map((k) => h('div', { key: k }, '· ' + k + '：' + r[k]))),
        h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(140px,1fr))', gap: 8, marginBottom: 12 } },
          cards.map((x) => h('div', { key: x.k, style: { background: C.surface2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 10px' } },
            h('div', { style: { fontSize: 11, color: C.text2, marginBottom: 2 } }, x.k),
            h('div', { style: { fontSize: 15, fontWeight: 700, color: c(1, x.ref) } }, x.v)))),
        h('div', { style: { fontSize: 13, fontWeight: 700, color: C.text, margin: '4px 0 6px' } }, '近期模拟成交（近 40 笔）'),
        tradeRows.length
          ? h(Table, { cols: ['买入日', '名称', '买入价', '卖出日', '卖出价', '收益率', '结果'], minWidth: 700, rows: tradeRows })
          : h('div', { style: { fontSize: 12.5, color: C.text2 } }, '暂无成交记录'),
        h('div', { style: { fontSize: 11.5, color: C.text2, marginTop: 8, lineHeight: 1.6 } }, '策略由确定性规则驱动（基因止损/止盈/时间止损），回测为历史数据模拟，不构成对未来收益的承诺，仅供参考。'))
    }

    function swingSection(swing, onStock, onRefresh, busy) {
      if (!swing) return null
      const s = swing.summary || {}
      const oversold = swing.oversold || []
      const trend = swing.trend || []
      const head = h('div', { style: { fontSize: 12, color: C.text2, lineHeight: 1.7, marginBottom: 10 } },
        '全市场 ' + (s.totalStocks || '—') + ' 只 · 今日上涨 ' + (s.upToday ?? '—') + ' / 下跌 ' + (s.downToday ?? '—') +
        ' · 60日平均 ' + (s.avg60dPct != null ? s.avg60dPct + '%' : '—') +
        (s.oversoldCount != null ? ' · 超跌反转池 ' + s.oversoldCount + ' 只 · 右侧趋势池 ' + s.trendCount + ' 只' : '') +
        (swing.computedAt ? ' · 计算于 ' + new Date(swing.computedAt).toLocaleString('zh-CN') : ''))
      const oversoldRows = oversold.map((x) => [
        nameCell(x, onStock), x.code,
        txt(x.change60d + '%', x.change60d < 0 ? C.down : C.up, undefined, 600),
        txt(x.change20d + '%', x.change20d < 0 ? C.down : C.up),
        x.downStreak ? x.downStreak + ' 天' : '—',
        h(Tag, { kind: 'cold' }, x.reversalProb + '%'),
        h('div', { style: { minWidth: 190, whiteSpace: 'normal', lineHeight: 1.5 } }, x.reason || ''),
      ])
      const trendRows = trend.map((x) => [
        nameCell(x, onStock), x.code,
        txt(x.change60d + '%', x.change60d > 0 ? C.up : C.down, undefined, 600),
        txt(x.change20d + '%', x.change20d > 0 ? C.up : C.down),
        x.bullAlign ? '多头' : x.aboveMA20 ? '站上20线' : '—',
        h(Tag, { kind: 'hot' }, x.rightProb + '%'),
        h('div', { style: { minWidth: 190, whiteSpace: 'normal', lineHeight: 1.5 } }, x.reason || ''),
      ])
      return h(Section, { title: '右侧机会 · 跌后反转候选池', extra: h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 8 } }, h(Tag, { kind: 'hot' }, '全市场扫描'), h(Button, { onClick: onRefresh, disabled: busy }, busy ? '扫描中…' : '刷新机会')) },
        head,
        h('div', { style: { fontSize: 13, fontWeight: 700, color: C.text, margin: '4px 0 6px' } }, '超跌反转候选（连续下跌后的右侧反弹）'),
        oversold.length ? h(Table, { cols: ['名称', '代码', '60日', '20日', '连跌', '反转概率', '信号'], minWidth: 720, rows: oversoldRows }) : h('div', { style: { fontSize: 12.5, color: C.text2 } }, '暂无候选'),
        h('div', { style: { fontSize: 13, fontWeight: 700, color: C.text, margin: '14px 0 6px' } }, '右侧趋势候选（均线走好 + 放量延续）'),
        trend.length ? h(Table, { cols: ['名称', '代码', '60日', '20日', '结构', '右侧概率', '信号'], minWidth: 720, rows: trendRows }) : h('div', { style: { fontSize: 12.5, color: C.text2 } }, '暂无候选'),
        h('div', { style: { fontSize: 11.5, color: C.text2, marginTop: 8, lineHeight: 1.6 } }, '反转/右侧概率为基于均线、量能与超跌程度的量化分数，仅供参考，不构成投资建议。'))
    }

    function recommendBlock(text) {
      if (!text) return null
      return h(Section, { title: '投资诊断与建议', extra: h(Tag, { kind: 'hot' }, 'AI 诊断') },
        h('div', { style: { fontSize: 13, color: C.text } }, renderMd(text)))
    }

    /* ---- AI 分析（悬浮按钮 + 弹窗） ---------------------------------------- */
    const QUICK_ASKS = ['点评我的持仓', '今天市场整体情绪如何？', '有哪些值得关注的反转机会？', '明天该怎么操作？']

    function AIAnalyst() {
      const [open, setOpen] = useState(false)
      const [msgs, setMsgs] = useState([])
      const [input, setInput] = useState('')
      const [busy, setBusy] = useState(false)
      const listRef = React.useRef(null)
      const inputRef = React.useRef(null)
      const AVATAR_COLORS = ['#e0744c', '#4c8fe0', '#5aa06a', '#9a6be0', '#d06a8e', '#3fa3a3']
      const [userColor] = useState(() => AVATAR_COLORS[Math.floor(Math.random() * AVATAR_COLORS.length)])

      const jackAvatar = h('img', { src: '/stock-dashboard/avatar', alt: '杰克观潮', style: { width: 30, height: 30, borderRadius: '50%', objectFit: 'cover', flexShrink: 0, background: C.surface2, border: '1px solid ' + C.border } })
      const meAvatar = h('div', { style: { width: 30, height: 30, borderRadius: '50%', background: userColor, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 } }, '我')

      useEffect(() => {
        if (open && listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      }, [msgs, open])
      useEffect(() => {
        if (!open) return
        const onKey = (e) => { if (e.key === 'Escape') setOpen(false) }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [open])

      const LS_KEY = 'dsh-stock-chat'
      useEffect(() => {
        try {
          const s = JSON.parse(localStorage.getItem(LS_KEY) || '[]')
          if (Array.isArray(s) && s.length) setMsgs(s.slice(-40))
        } catch { /* ignore */ }
      }, [])
      useEffect(() => {
        try { localStorage.setItem(LS_KEY, JSON.stringify(msgs.slice(-40))) } catch { /* ignore */ }
      }, [msgs])

      async function send(text) {
        const q = String(text != null ? text : input).trim()
        if (!q || busy) return
        setMsgs((m) => m.concat([{ role: 'user', text: q }]))
        setInput('')
        setBusy(true)
        try {
          const r = await fetch('/stock-dashboard/ask', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ question: q, history: msgs.slice(-16).map((m) => ({ role: m.role, content: m.text })) }) })
          const j = await r.json()
          setMsgs((m) => m.concat([{ role: 'assistant', text: j.answer || j.error || '（暂无回复）' }]))
        } catch (e) { setMsgs((m) => m.concat([{ role: 'assistant', text: String(e && e.message || e) }])) }
        finally { setBusy(false) }
      }
      function clearAll() {
        setMsgs([])
        try { localStorage.removeItem(LS_KEY) } catch { /* ignore */ }
      }

      const bubble = (isUser) => ({
        padding: '9px 12px', borderRadius: 12, fontSize: 13.5, lineHeight: 1.75,
        whiteSpace: 'pre-wrap', wordBreak: 'break-word',
        background: isUser ? C.brand : C.surface2, color: isUser ? '#fff' : C.text,
      })
      const msgRow = (m, i, isAI) => {
        const name = isAI ? '杰克' : '我'
        const body = h('div', { style: { display: 'flex', flexDirection: 'column', maxWidth: '85%', minWidth: 0, alignItems: isAI ? 'flex-start' : 'flex-end' } },
          h('div', { style: { fontSize: 11, color: C.text2, marginBottom: 4 } }, name),
          h('div', { style: bubble(!isAI) }, isAI ? renderMd(m.text) : m.text))
        return isAI
          ? h('div', { key: i, style: { display: 'flex', gap: 9, alignItems: 'flex-start' } }, jackAvatar, body)
          : h('div', { key: i, style: { display: 'flex', gap: 9, alignItems: 'flex-start', justifyContent: 'flex-end' } }, body, meAvatar)
      }

      return h('div', null,
        h('button', {
          onClick: () => { setOpen(true); setTimeout(() => inputRef.current && inputRef.current.focus(), 60) },
          style: {
            position: 'fixed', right: 26, bottom: 26, zIndex: 9000, fontFamily: 'inherit',
            display: 'flex', alignItems: 'center', gap: 8, padding: '13px 20px', borderRadius: 999,
            background: C.brand, color: '#fff', border: 'none', cursor: 'pointer',
            fontSize: 14, fontWeight: 600, boxShadow: '0 8px 24px rgba(0,0,0,0.28)',
          },
        }, '✨ AI 分析'),

        open && h('div', {
          onClick: () => setOpen(false),
          style: { position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
        },
          h('div', {
            onClick: (e) => e.stopPropagation(),
            style: {
              width: 'min(960px, calc(100vw - 44px))', height: 'min(700px, calc(100vh - 80px))',
              maxWidth: '100%', background: C.surface, border: '1px solid ' + C.border, borderRadius: 16,
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              color: C.text, boxShadow: '0 24px 72px rgba(0,0,0,0.45)',
            },
          },
            h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid ' + C.border2 } },
              h('div', null,
                h('div', { style: { fontSize: 16, fontWeight: 700, color: C.text } }, 'AI 分析'),
                h('div', { style: { fontSize: 12, color: C.text2, marginTop: 2 } }, '有记忆的投研顾问「杰克」· 结合看板数据与我们的对话')),
              h('div', { style: { display: 'flex', alignItems: 'center', gap: 14 } },
                msgs.length > 0 && h('span', { onClick: clearAll, style: { cursor: 'pointer', fontSize: 12, color: C.text2 } }, '清空对话'),
                h('span', { onClick: () => setOpen(false), style: { cursor: 'pointer', fontSize: 22, lineHeight: 1, color: C.text2, padding: '0 4px' } }, '✕'))),
            h('div', { ref: listRef, style: { flex: 1, overflowY: 'auto', padding: '18px 20px', display: 'flex', flexDirection: 'column', gap: 10 } },
              msgs.length === 0 && h('div', { style: { fontSize: 13.5, color: C.text2, lineHeight: 1.8 } }, '问我任何关于今日市场或个股的问题，例如：工业富联为什么大跌？盛美上海能买吗？我该不该减仓？'),
              msgs.map((m, i) => msgRow(m, i, m.role === 'assistant')),
              busy && h('div', { style: { display: 'flex', gap: 9, alignItems: 'center' } },
                jackAvatar,
                h('div', null,
                  h('div', { style: { fontSize: 11, color: C.text2, marginBottom: 3 } }, '杰克'),
                  h('div', { style: { fontSize: 12.5, color: C.text2, padding: '2px 0' } }, '正在分析…')))),
            h('div', { style: { padding: '14px 20px', borderTop: '1px solid ' + C.border2 } },
              h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 } },
                QUICK_ASKS.map((q) => h('button', { key: q, onClick: () => send(q), style: { fontFamily: 'inherit', fontSize: 12.5, padding: '6px 12px', borderRadius: 20, cursor: 'pointer', background: C.surface2, color: C.text, border: '1px solid ' + C.border } }, q))),
              h('div', { style: { display: 'flex', gap: 10 } },
                h('input', { ref: inputRef, value: input, onChange: (e) => setInput(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') send() }, placeholder: '针对看板数据提问，Enter 发送…', style: { fontFamily: 'inherit', flex: 1, boxSizing: 'border-box', padding: '11px 14px', background: C.surface2, color: C.text, border: '1px solid ' + C.border, borderRadius: 10, fontSize: 14, outline: 'none' } }),
                h(Button, { primary: true, onClick: () => send(), disabled: busy, style: { padding: '11px 22px', fontSize: 14 } }, busy ? '思考中…' : '发送'))),
          ),
        ),
      )
    }

    /* ---- 持仓配置面板 ------------------------------------------------------ */
    function ConfigPanel(props) {
      const portfolio = props.portfolio || []
      const [list, setList] = useState(portfolio.map((s) => ({ code: s.code, market: s.market, name: s.name })))
      const [kw, setKw] = useState('')
      const [hits, setHits] = useState([])
      const [busy, setBusy] = useState(false)
      const [saved, setSaved] = useState(false)
      const [saving, setSaving] = useState(false)

      async function search() {
        const q = kw.trim()
        if (!q) return
        setBusy(true)
        try {
          const r = await fetch('/stock-dashboard/stock-search?kw=' + encodeURIComponent(q), { credentials: 'include' })
          const j = await r.json()
          setHits(j.hits || [])
        } catch { setHits([]) } finally { setBusy(false) }
      }
      async function save() {
        setSaving(true)
        try {
          const r = await fetch('/stock-dashboard/portfolio', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ stocks: list }) })
          const j = await r.json()
          if (j.ok) { setSaved(true); setTimeout(() => setSaved(false), 2000); props.onSaved && props.onSaved() }
        } catch { /* ignore */ } finally { setSaving(false) }
      }
      function add(hit) { if (!list.some((s) => s.code === hit.code)) setList((l) => l.concat([{ code: hit.code, market: hit.market, name: hit.name }])) }
      function remove(code) { setList((l) => l.filter((s) => s.code !== code)) }

      return h(Section, { title: '配置我的持仓', extra: h(Tag, { kind: 'hot' }, '个性化') },
        h('div', { style: { fontSize: 12, color: C.text2, marginBottom: 10 } }, '添加/移除你跟踪的股票，保存后「我的持仓」与实时刷新都会按此列表展示。支持 A 股与港股代码。'),
        h('div', { style: { display: 'flex', gap: 8, marginBottom: 8 } },
          h('input', { value: kw, onChange: (e) => setKw(e.target.value), onKeyDown: (e) => { if (e.key === 'Enter') search() }, placeholder: '代码或名称，如 600036 / 招商银行 / 00700', style: { fontFamily: 'inherit', flex: 1, boxSizing: 'border-box', padding: '7px 10px', background: C.surface2, color: C.text, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 13, outline: 'none' } }),
          h(Button, { onClick: search, disabled: busy }, busy ? '搜索中…' : '搜索')),
        hits.length > 0 && h('div', { style: { border: '1px solid ' + C.border, borderRadius: 8, marginBottom: 10, overflow: 'hidden' } },
          hits.map((hx) => h('div', { key: hx.code, onClick: () => add(hx), style: { display: 'flex', justifyContent: 'space-between', padding: '7px 10px', cursor: 'pointer', fontSize: 13, color: C.text, borderBottom: '1px solid ' + C.border } },
            h('span', null, hx.name, ' （', hx.code, '）'),
            h('span', { style: { color: C.brand } }, '＋ 添加')))),
        h('div', { style: { display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 } },
          list.map((s) => h('span', { key: s.code, style: { display: 'inline-flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 20, background: C.surface2, border: '1px solid ' + C.border, fontSize: 12.5, color: C.text } },
            s.name + ' ' + s.code,
            h('span', { onClick: () => remove(s.code), style: { cursor: 'pointer', color: C.text2 } }, '✕')))),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(Button, { primary: true, onClick: save, disabled: saving }, saving ? '保存中…' : '保存持仓'),
          saved && h('span', { style: { fontSize: 12.5, color: C.success || '#2ea06a' } }, '已保存，刷新后生效')))
    }

    /* ---- 个股详情弹窗（公司介绍 + 基本面） -------------------------------- */
    function kv(k, v, color) {
      return h('div', { style: { background: C.surface2, border: '1px solid ' + C.border, borderRadius: 8, padding: '8px 10px' } },
        h('div', { style: { fontSize: 11, color: C.text2, marginBottom: 3 } }, k),
        h('div', { style: { fontSize: 14, fontWeight: 600, color: color || C.text } }, v == null ? '—' : v))
    }

    function CandleChart(props) {
      const data = (props.data || []).slice(-80)
      const height = props.height || 220
      if (data.length < 2) return h('div', { style: { height, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.text2, fontSize: 12 } }, '暂无K线数据')
      const W = 760, padL = 4, padR = 4, padT = 10, padB = 14
      const iw = W - padL - padR, ih = height - padT - padB
      const lo = Math.min(...data.map((b) => b.low)), hi = Math.max(...data.map((b) => b.high))
      const min = lo === hi ? lo - 1 : lo, max = lo === hi ? hi + 1 : hi
      const n = data.length
      const x = (i) => padL + (iw * (i + 0.5)) / n
      const y = (v) => padT + ih - ((v - min) * ih) / (max - min)
      const bodyW = Math.max(2, (iw / n) * 0.62)
      return h('svg', { viewBox: '0 0 ' + W + ' ' + height, width: '100%', height, preserveAspectRatio: 'none', style: { display: 'block' } },
        data.map((b, i) => {
          const up = b.close >= b.open
          const c = up ? '#e0483e' : '#2ea06a'
          const cx = x(i)
          const top = Math.min(y(b.open), y(b.close))
          const hh = Math.max(1, Math.abs(y(b.close) - y(b.open)))
          return h('g', { key: i },
            h('line', { x1: cx, y1: y(b.high), x2: cx, y2: y(b.low), stroke: c, strokeWidth: 1 }),
            h('rect', { x: cx - bodyW / 2, y: top, width: bodyW, height: hh, fill: c }))
        }),
        h('text', { x: padL, y: height - 3, fontSize: 9, fill: C.text2 }, data[0].t + ' ~ ' + data[n - 1].t))
    }

    function StockCharts(props) {
      const d = props.d || {}
      const [k, setK] = useState('day')
      const tab = (v, label) => h('button', { onClick: () => setK(v), style: { fontFamily: 'inherit', padding: '5px 12px', cursor: 'pointer', fontSize: 12.5, fontWeight: k === v ? 700 : 500, color: k === v ? C.text : C.text2, background: k === v ? C.surface2 : 'transparent', border: '1px solid ' + (k === v ? C.border : 'transparent'), borderRadius: 6 } }, label)
      const minute = (d.minute || []).map((b) => b.close)
      const mlabels = d.minute && d.minute.length ? [String(d.minute[0].t || '').slice(5), String(d.minute[d.minute.length - 1].t || '').slice(5, 16)] : []
      return h('div', { style: { marginTop: 20 } },
        h('div', { style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 } }, 'K线走势'),
        h('div', { style: { display: 'flex', gap: 6, marginBottom: 10 } }, tab('intraday', '分时'), tab('day', '日K'), tab('month', '月K')),
        k === 'intraday'
          ? (minute.length > 2 ? h(LineChart, { data: minute, labels: mlabels, height: 220 }) : h('div', { style: { color: C.text2, fontSize: 12 } }, '暂无分时数据'))
          : h(CandleChart, { data: k === 'day' ? (d.klines || []) : (d.klinesMonth || []), height: 220 }))
    }

    function ModelPanel(props) {
      const [baseUrl, setBaseUrl] = useState('https://api.deepseek.com')
      const [apiKey, setApiKey] = useState('')
      const [model, setModel] = useState('deepseek-chat')
      const [hasKey, setHasKey] = useState(false)
      const [saving, setSaving] = useState(false)
      const [msg, setMsg] = useState('')

      useEffect(() => {
        fetch('/stock-dashboard/llm-config', { credentials: 'include' }).then((r) => r.json())
          .then((j) => { if (j.baseUrl) setBaseUrl(j.baseUrl); if (j.model) setModel(j.model); setHasKey(!!j.hasKey) })
          .catch(() => {})
      }, [])

      async function save() {
        if (!baseUrl.trim() || !model.trim()) { setMsg('请填写 API 地址和模型名'); return }
        if (!apiKey.trim() && !hasKey) { setMsg('请填写 API Key'); return }
        setSaving(true); setMsg('')
        try {
          const r = await fetch('/stock-dashboard/llm-config', { method: 'POST', credentials: 'include', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim(), model: model.trim() }) })
          const j = await r.json()
          if (j.ok) { setHasKey(true); setApiKey(''); setMsg('已保存，AI 分析将使用你的模型') } else setMsg(j.error || '保存失败')
        } catch (e) { setMsg(String(e && e.message || e)) } finally { setSaving(false) }
      }

      const input = (v, set, ph, type) => h('input', { value: v, onChange: (e) => set(e.target.value), placeholder: ph, type: type || 'text', style: { fontFamily: 'inherit', flex: 1, minWidth: 200, boxSizing: 'border-box', padding: '8px 10px', background: C.surface2, color: C.text, border: '1px solid ' + C.border, borderRadius: 8, fontSize: 13, outline: 'none' } })

      return h(Section, { title: 'AI 大模型配置', extra: hasKey ? h(Tag, { kind: 'hot' }, '自定义 Key') : h(Tag, { kind: 'cold' }, '内置模型') },
        h('div', { style: { fontSize: 12, color: C.text2, marginBottom: 10, lineHeight: 1.7 } }, '可接入 OpenAI 兼容接口（DeepSeek / 通义 / OpenAI / Moonshot 等），填入你的 Key 后，AI 分析与宏观研判将走你自己的模型；留空则使用内置 Agent 模型。'),
        h('div', { style: { display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 8 } },
          h('label', { style: { flex: 1, minWidth: 200, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.text2 } }, 'API 地址', input(baseUrl, setBaseUrl, 'https://api.deepseek.com')),
          h('label', { style: { flex: 1, minWidth: 120, display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.text2 } }, '模型名', input(model, setModel, 'deepseek-chat'))),
        h('label', { style: { display: 'flex', flexDirection: 'column', gap: 3, fontSize: 11, color: C.text2, marginBottom: 10 } }, 'API Key', input(apiKey, setApiKey, hasKey ? '留空表示不修改' : 'sk-...', 'password')),
        h('div', { style: { display: 'flex', gap: 8, alignItems: 'center' } },
          h(Button, { primary: true, onClick: save, disabled: saving }, saving ? '保存中…' : '保存配置'),
          msg && h('span', { style: { fontSize: 12.5, color: msg.indexOf('失败') >= 0 || msg.indexOf('请') >= 0 ? C.warn : C.down } }, msg)))
    }

    function StockDetailModal(props) {
      const stock = props.stock || {}
      const [d, setD] = useState(null)
      const [err, setErr] = useState('')
      const [loading, setLoading] = useState(true)

      useEffect(() => {
        let alive = true
        setLoading(true); setD(null); setErr('')
        fetch(`/stock-dashboard/stock-detail?code=${encodeURIComponent(stock.code)}&market=${encodeURIComponent(stock.market)}`, { credentials: 'include' })
          .then((r) => r.json())
          .then((j) => { if (!alive) return; if (j.ok) setD(j); else setErr(j.error || '加载失败') })
          .catch((e) => { if (alive) setErr(String(e && e.message || e)) })
          .finally(() => { if (alive) setLoading(false) })
        return () => { alive = false }
      }, [stock.code, stock.market])

      useEffect(() => {
        const onKey = (e) => { if (e.key === 'Escape') props.onClose() }
        window.addEventListener('keydown', onKey)
        return () => window.removeEventListener('keydown', onKey)
      }, [props.onClose])

      const f = d && d.fundamentals
      return h('div', {
        onClick: () => props.onClose(),
        style: { position: 'fixed', inset: 0, zIndex: 9500, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center' },
      },
        h('div', {
          onClick: (e) => e.stopPropagation(),
          style: { width: 'min(860px, calc(100vw - 44px))', maxHeight: 'calc(100vh - 80px)', overflow: 'auto', background: C.surface, border: '1px solid ' + C.border, borderRadius: 16, color: C.text, boxShadow: '0 24px 72px rgba(0,0,0,0.45)' },
        },
          h('div', { style: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid ' + C.border2 } },
            h('div', null,
              h('div', { style: { display: 'flex', alignItems: 'baseline', gap: 8 } },
                h('span', { style: { fontSize: 17, fontWeight: 700, color: C.text } }, stock.name || ''),
                h('span', { style: { fontSize: 12, color: C.text2, fontFamily: 'monospace' } }, stock.code),
                stock.changePct != null && h('span', { style: { fontSize: 13, fontWeight: 600, color: pctColor(stock.changePct) } }, pctText(stock.changePct)),
                stock.industry && h(Tag, { kind: 'hot' }, stock.industry)),
              h('div', { style: { fontSize: 12, color: C.text2, marginTop: 3 } }, loading ? '加载公司资料中…' : err ? err : '公司介绍与基本面（东财数据，仅供参考）')),
            h('span', { onClick: () => props.onClose(), style: { cursor: 'pointer', fontSize: 22, lineHeight: 1, color: C.text2, padding: '0 4px' } }, '✕')),

          h('div', { style: { padding: '18px 20px' } },
            d && h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(130px,1fr))', gap: 8, marginBottom: 16 } },
              kv('最新价', d.price != null ? d.price.toFixed(2) : null, pctColor(d.changePct)),
              kv('市盈率', d.pe != null ? d.pe.toFixed(2) : null),
              kv('市净率', d.pb != null ? d.pb.toFixed(2) : null),
              kv('总市值', d.totalMv != null ? (d.totalMv / 1e8).toFixed(2) + ' 亿' : null)),

            d && d.profile && h('div', null,
              h('div', { style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 8 } }, '公司介绍'),
              h('div', { style: { fontSize: 13, lineHeight: 1.8, color: C.text, whiteSpace: 'pre-wrap' } }, String(d.profile).trim()),
              d.mainBusiness && h('div', { style: { marginTop: 12 } },
                h('div', { style: { fontSize: 13, fontWeight: 600, color: C.text, marginBottom: 4 } }, '主营业务'),
                h('div', { style: { fontSize: 13, lineHeight: 1.7, color: C.text2, whiteSpace: 'pre-wrap' } }, String(d.mainBusiness).trim())),
              d.province && h('div', { style: { fontSize: 12, color: C.text2, marginTop: 8 } }, '所在地：' + d.province)),

            f && h('div', { style: { marginTop: d && d.profile ? 18 : 0 } },
              h('div', { style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 } }, '基本面指标' + (f.reportDate ? '（' + f.reportDate + '）' : '')),
              h('div', { style: { display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: 8 } },
                kv('营业总收入', fmtAmount(f.revenue)),
                kv('归母净利润', fmtAmount(f.netProfit)),
                kv('营收同比', f.revenueYoy != null ? f.revenueYoy.toFixed(2) + '%' : null, pctColor(f.revenueYoy)),
                kv('净利同比', f.netProfitYoy != null ? f.netProfitYoy.toFixed(2) + '%' : null, pctColor(f.netProfitYoy)),
                kv('ROE', f.roe != null ? f.roe.toFixed(2) + '%' : null),
                kv('毛利率', f.grossMargin != null ? f.grossMargin.toFixed(2) + '%' : null),
                kv('资产负债率', f.debtRatio != null ? f.debtRatio.toFixed(2) + '%' : null),
                kv('EPS', f.eps != null ? f.eps.toFixed(2) : null),
                kv('每股净资产', f.bps != null ? f.bps.toFixed(2) : null),
                kv('每股现金流', f.ocfPerShare != null ? f.ocfPerShare.toFixed(2) : null))),

            d && h(StockCharts, { d }),

            d && (d.financialHistory || []).length > 0 && h('div', { style: { marginTop: 20 } },
              h('div', { style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 } }, '财报趋势'),
              h(Table, { cols: ['报告期', '营收', '净利润', '营收同比', '净利同比', 'ROE', 'EPS'], minWidth: 640, rows: d.financialHistory.map((r) => [
                r.date || '—',
                txt(fmtAmount(r.revenue), C.text),
                txt(fmtAmount(r.netProfit), C.text),
                txt(r.revenueYoy != null ? signed(r.revenueYoy) + '%' : '—', pctColor(r.revenueYoy)),
                txt(r.netProfitYoy != null ? signed(r.netProfitYoy) + '%' : '—', pctColor(r.netProfitYoy)),
                txt(r.roe != null ? r.roe.toFixed(2) + '%' : '—', C.text),
                txt(r.eps != null ? r.eps.toFixed(2) : '—', C.text),
              ]) })),

            d && (d.announcements || []).length > 0 && h('div', { style: { marginTop: 20 } },
              h('div', { style: { fontSize: 14, fontWeight: 700, color: C.text, marginBottom: 10 } }, '公告资讯'),
              d.announcements.map((a, i) => h('div', { key: i, style: { fontSize: 12.5, color: C.text, lineHeight: 1.6, padding: '5px 0', borderBottom: '1px solid ' + C.border } },
                h('span', { style: { color: C.text2, marginRight: 8, fontSize: 11.5 } }, a.date || ''), a.title))),

            !d && !loading && !err && h('div', { style: { fontSize: 13, color: C.text2, padding: '20px 0' } }, '暂无该公司资料'),
            d && !d.profile && !f && h('div', { style: { fontSize: 13, color: C.text2, marginTop: 4 } }, '该公司暂无公司简介与财务数据（可能为新股或港股）。'),
          ),
        ),
      )
    }

    return {
      inject: ['slots', 'locale'],
      apply(ctx) {
        ctx.effect(() => ctx.locale.register('stockDashboard', { zh, en }), 'dsh-stock-dashboard: dictionaries')
        const t = ctx.locale.bind('stockDashboard')
        ctx.slots.inject('sidebar.panellist', () => ctx.slots.register({ name: 'sidebar.panellist', id: PANEL_ID, order: 50, label: () => t('panel'), locale: 'stockDashboard' }, PanelIcon))
        ctx.slots.inject('main', () => ctx.slots.register({ name: 'main', key: PANEL_ID }, function App(props) { return h(Boundary, null, h(Dashboard, props)) }))
      },
    }
  },
})