import React, { useCallback, useEffect, useRef, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { columns, createRecognizer } from './ocr'
import { formatPublicationTime, summarizeRows } from './analysis'
import { ProjectFooter } from './project-footer'
import wechatQr from './img/IMG_7174..JPG'
import { PlayShareChart } from './play-share-chart'
import { splitScreenshot } from './split'
import { prepareScreenshot } from './screenshot-preview'
import { accountFields, accountSpans, AccountPresets, AccountSelect } from './accounts'
import './style.css'

const allFields = [
  ...accountFields.map(field => ({ ...field, account: true })),
  ...columns.flatMap((label, index) => [
    { key: label, label, index },
    ...(index === 0 ? [{ key: 'workLink', label: '链接', manual: true }] : []),
  ]),
]
const disabledByDefault = new Set(['followers', '完播率', '跳出率', '作品状态'])
const defaultFields = () => allFields.map(({ key }) => ({ key, enabled: !disabledByDefault.has(key) }))

function SettingsDialog({ title, close, save, children }) {
  const ref = useRef(null)
  useEffect(() => {
    ref.current.showModal()
  }, [])
  return <dialog ref={ref} className="settings-dialog" aria-label={title} onClose={close}>
    <div className="toolbar dialog-heading">
      <h2>{title}</h2>
      <div className="actions">
        <button className="secondary" onClick={() => ref.current.close()}>{save ? '取消' : '关闭'}</button>
        {save && <button onClick={() => { save(); ref.current.close() }}>保存</button>}
      </div>
    </div>
    {children}
  </dialog>
}

function DuplicateDialog({ rows, resolve }) {
  const ref = useRef(null)
  const [checked, setChecked] = useState([])
  useEffect(() => { ref.current.showModal() }, [])
  const chosen = rows.filter(row => checked.includes(row.id))
  const overlappingTargets = new Set(chosen.map(row => row.target.id)).size !== chosen.length
  function finish(ids, mode = 'add') {
    ref.current.close()
    resolve({ ids, mode })
  }
  return <dialog ref={ref} className="settings-dialog duplicate-dialog" aria-labelledby="duplicates-heading"
    onCancel={event => { event.preventDefault(); finish([]) }}>
    <div className="toolbar dialog-heading">
      <h2 id="duplicates-heading">发现 {rows.length} 条重复作品</h2>
    </div>
    <p>勾选要添加或替换的作品。</p>
    <ul className="duplicates-list">{rows.map(row => <li key={row.id}>
      <label>
        <input type="checkbox" checked={checked.includes(row.id)} onChange={event => {
          const enabled = event.target.checked
          setChecked(current => enabled ? [...current, row.id] : current.filter(id => id !== row.id))
        }}/>
        <span><strong>{row.values[0]}</strong><small>{[row.values[1], row.name].filter(Boolean).join(' · ')}</small></span>
      </label>
    </li>)}</ul>
    {overlappingTargets && <p>多条选中记录对应同一行，请只选其中一条进行替换。</p>}
    <div className="actions duplicate-actions">
      <button className="secondary" onClick={() => finish([])}>跳过重复项</button>
      <button className="secondary" disabled={!checked.length || overlappingTargets} onClick={() => finish(checked, 'replace')}>替换选中</button>
      <button disabled={!checked.length} onClick={() => finish(checked)}>添加选中（{checked.length}）</button>
    </div>
  </dialog>
}

function savedSettings() {
  try {
    return JSON.parse(localStorage.getItem('matrix-ocr-settings')) || {}
  } catch {
    return {}
  }
}

function App() {
  const [settings] = useState(savedSettings)
  const [dialog, setDialog] = useState('')
  const [duplicates, setDuplicates] = useState(null)
  const [draftAccounts, setDraftAccounts] = useState([])
  const [draftDefault, setDraftDefault] = useState('')
  const [draftFields, setDraftFields] = useState([])
  const [accounts, setAccounts] = useState(settings.accounts || [])
  const [defaultAccount, setDefaultAccount] = useState(settings.defaultAccount || '')
  const activeAccount = useRef(defaultAccount)
  const [fieldSettings, setFieldSettings] = useState(() => {
    const known = new Set(allFields.map(field => field.key))
    const previous = (settings.fields || []).filter(field => known.has(field.key))
    const migrateDefaults = !settings.version && previous.length === allFields.length - 1 && previous.every(field => field.enabled)
    const saved = migrateDefaults ? previous.map(field => ({ ...field, enabled: !disabledByDefault.has(field.key) })) : previous
    const ordered = [...saved, ...allFields.filter(field => field.key !== 'workLink' && !saved.some(item => item.key === field.key))
      .map(field => ({ key: field.key, enabled: !disabledByDefault.has(field.key) }))]
    if (!ordered.some(field => field.key === 'workLink')) {
      ordered.splice(ordered.findIndex(field => field.key === '标题') + 1, 0, { key: 'workLink', enabled: true })
    }
    return ordered
  })
  const [selected, setSelected] = useState([])
  const [batchAccount, setBatchAccount] = useState('')
  const [mergeAccounts, setMergeAccounts] = useState(false)
  const [includeAnalysis, setIncludeAnalysis] = useState(Boolean(settings.includeAnalysis))
  const [keepScreenshots, setKeepScreenshots] = useState(Boolean(settings.keepScreenshots))
  const [previews, setPreviews] = useState({})
  const [model, setModel] = useState({ progress: 0, label: '准备加载 OCR 模型' })
  const [recognition, setRecognition] = useState(null)
  const [editing, setEditing] = useState(null)
  const [rowDrag, setRowDrag] = useState(null)
  const [rows, setRows] = useState([])
  const [view, setView] = useState('excel')
  const [exporting, setExporting] = useState(false)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [status, setStatus] = useState('')
  const picker = useRef(null)
  const excelTable = useRef(null)
  const processing = useRef(false)
  const engine = useRef(null)
  const preparedImages = useRef(new Map())
  const nextId = useRef(0)
  const dragDepth = useRef(0)
  const rowPointer = useRef(null)
  const skipRowClick = useRef(false)
  const fields = fieldSettings.filter(field => field.enabled)
    .map(field => allFields.find(item => item.key === field.key))
  const headings = ['序号', ...fields.map(field => field.label)]
  const accountColumns = fields.flatMap((field, index) => field.account ? [index + 1] : [])
  const analysis = summarizeRows(rows, columns)
  const spans = accountSpans(rows, mergeAccounts)
  const accountsByKey = new Map(accounts.map(account => [account.key, account]))
  const valueFor = (row, field) => field.account
    ? accountsByKey.get(row.account)?.[field.key] || ''
    : field.manual ? row.workLink || '' : row.values[field.index] || ''

  useEffect(() => {
    try {
      localStorage.setItem('matrix-ocr-settings', JSON.stringify({ version: 2, accounts, defaultAccount, fields: fieldSettings, includeAnalysis, keepScreenshots }))
    } catch {
      // The current session remains usable when browser storage is unavailable.
    }
  }, [accounts, defaultAccount, fieldSettings, includeAnalysis, keepScreenshots])

  const loadModel = useCallback(() => {
    if (!engine.current) {
      setModel({ progress: 0, label: '正在加载 OCR 模型' })
      engine.current = createRecognizer((progress, label, indeterminate = false) => {
        setModel(current => ({ progress: Math.max(current.progress, progress), label, indeterminate }))
      }).then(recognizer => {
        setModel({ progress: 1, label: 'OCR 模型已就绪' })
        return recognizer
      }).catch(error => {
        engine.current = null
        setModel({ progress: 0, label: 'OCR 模型加载失败', error: true })
        throw error
      })
    }
    return engine.current
  }, [])

  useEffect(() => {
    loadModel().catch(console.error)
    return () => { engine.current?.then(recognizer => recognizer.close()).catch(() => {}) }
  }, [loadModel])

  function prepareImage(row) {
    const cache = preparedImages.current
    if (!cache.has(row.url)) cache.set(row.url, prepareScreenshot(row.url))
    return cache.get(row.url)
  }

  useEffect(() => {
    if (!keepScreenshots || busy || exporting) return
    const pending = rows.filter(row => row.url && !(row.id in previews))
    if (!pending.length) return
    let cancelled = false
    const schedule = window.requestIdleCallback
      ? callback => window.requestIdleCallback(callback, { timeout: 700 })
      : callback => window.setTimeout(callback, 30)
    const cancel = window.cancelIdleCallback
      ? id => window.cancelIdleCallback(id)
      : id => window.clearTimeout(id)
    const task = schedule(async () => {
      const row = pending[0]
      const image = await prepareImage(row).catch(() => null)
      if (!cancelled) setPreviews(current => ({ ...current, [row.id]: image?.preview || null }))
    })
    return () => { cancelled = true; cancel(task) }
  }, [busy, exporting, keepScreenshots, previews, rows])

  function releaseScreenshots() {
    for (const row of rows) if (row.url) URL.revokeObjectURL(row.url)
    preparedImages.current.clear()
    setPreviews({})
  }

  function deleteRow(row) {
    if (row.url) {
      URL.revokeObjectURL(row.url)
      preparedImages.current.delete(row.url)
    }
    setPreviews(current => {
      const next = { ...current }
      delete next[row.id]
      return next
    })
    setSelected(current => current.filter(id => id !== row.id))
    setRows(current => current.filter(item => item.id !== row.id))
    setStatus('已删除 1 条结果。')
  }

  function moveRow(id, targetId, after) {
    if (id === targetId) return
    setRows(current => {
      const dragged = current.find(row => row.id === id)
      if (!dragged) return current
      const next = current.filter(row => row.id !== id)
      const target = next.findIndex(row => row.id === targetId)
      if (target < 0) return current
      next.splice(target + Number(after), 0, dragged)
      return next
    })
  }

  function rowDestination(event, source) {
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest('tr[data-row-id]')
    if (!target || target.closest('table') !== source.closest('table')) return null
    const bounds = target.getBoundingClientRect()
    return { targetId: Number(target.dataset.rowId), after: event.clientY > bounds.top + bounds.height / 2 }
  }

  function trackRowDrag(event) {
    const drag = rowPointer.current
    if (drag?.pointer !== event.pointerId) return
    const dx = event.clientX - drag.startX
    const dy = event.clientY - drag.startY
    if (!drag.mode) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < 7) return
      if (Math.abs(dx) >= Math.abs(dy) && drag.wrapper.scrollWidth > drag.wrapper.clientWidth) {
        drag.mode = 'scroll'
        drag.wrapper.classList.add('table-dragging')
      } else if (Math.abs(dy) > Math.abs(dx) && drag.canReorder) {
        drag.mode = 'reorder'
      } else return
      drag.source.setPointerCapture(event.pointerId)
      skipRowClick.current = true
    }
    if (drag.mode === 'scroll') {
      drag.wrapper.scrollLeft = drag.startScroll - dx
      return
    }
    const edge = 42
    if (event.clientY < edge) window.scrollBy(0, -16)
    else if (event.clientY > window.innerHeight - edge) window.scrollBy(0, 16)
    setRowDrag({ id: drag.id, ...rowDestination(event, drag.source) })
  }

  function finishRowDrag(event) {
    const drag = rowPointer.current
    if (drag?.pointer !== event.pointerId) return
    if (event.type === 'lostpointercapture' && event.target !== drag.source) return
    rowPointer.current = null
    drag.wrapper.classList.remove('table-dragging')
    if (drag.mode !== 'reorder') return
    const destination = event.type === 'pointerup' ? rowDestination(event, drag.source) : null
    if (destination) moveRow(drag.id, destination.targetId, destination.after)
    setRowDrag(null)
  }

  const dragEvents = {
    onPointerMove: trackRowDrag,
    onPointerUp: finishRowDrag,
    onPointerCancel: finishRowDrag,
    onLostPointerCapture: finishRowDrag,
  }

  function rowActions(row) {
    const label = row.values[0] || row.name
    return <td data-controls className="delete-column" onClick={event => event.stopPropagation()}>
      <div className="row-actions">
        <button className="secondary delete-row" disabled={busy || exporting} title="删除"
          aria-label={`删除 ${label}`} onClick={() => deleteRow(row)}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 3v7m4-7v7"/>
          </svg>
        </button>
      </div>
    </td>
  }

  function changeValue(rowId, field, value) {
    if (field.account) {
      const assigned = rows.find(row => row.id === rowId)?.account
      if (assigned) setAccounts(current => current.map(account => account.key === assigned
        ? { ...account, [field.key]: value } : account))
      return
    }
    setRows(current => current.map(row => {
      if (row.id !== rowId) return row
      if (field.manual) return { ...row, workLink: value }
      return { ...row, values: row.values.map((old, index) => index === field.index ? value : old) }
    }))
  }

  function excelValue(row, field) {
    if (editing?.rowId !== row.id || editing.key !== field.key) return valueFor(row, field)
    const finish = event => {
      const value = field.label === '发布时间' ? formatPublicationTime(event.target.value) : event.target.value
      changeValue(row.id, field, value)
      setEditing(null)
    }
    return <input autoFocus defaultValue={valueFor(row, field)} aria-label={`编辑 ${field.label}`}
      onClick={event => event.stopPropagation()} onBlur={finish} onKeyDown={event => {
        if (event.key === 'Enter') event.currentTarget.blur()
        if (event.key === 'Escape') {
          event.preventDefault()
          setEditing(null)
        }
      }}/>
  }

  function changeScreenshotRetention(enabled) {
    setKeepScreenshots(enabled)
    if (enabled) return
    releaseScreenshots()
    setRows(current => current.map(row => ({ ...row, url: null })))
  }

  function selectDefault(account) {
    activeAccount.current = account
    setDefaultAccount(account)
    if (account) setRows(current => current.map(row => row.account ? row : { ...row, account }))
  }

  function assign(ids, account) {
    const targets = new Set(ids)
    setRows(current => current.map(row => targets.has(row.id) ? { ...row, account } : row))
  }

  function saveAccounts() {
    const remaining = new Set(draftAccounts.map(account => account.key))
    setAccounts(draftAccounts)
    if (batchAccount && !remaining.has(batchAccount)) setBatchAccount('')
    setRows(current => current.map(row => row.account && !remaining.has(row.account)
      ? { ...row, account: '' } : row))
    if (draftDefault !== defaultAccount) selectDefault(draftDefault)
  }

  function moveField(index, offset) {
    setDraftFields(current => {
      const next = [...current]
      const [field] = next.splice(index, 1)
      next.splice(index + offset, 0, field)
      return next
    })
  }

  function rowControls(row) {
    return <div className="row-controls" onClick={event => event.stopPropagation()}>
      <AccountSelect accounts={accounts} value={row.account || ''} change={account => assign([row.id], account)}
        label={`分配账号 · ${row.name}`}/>
    </div>
  }

  function rowSelection(row) {
    const isSelected = selected.includes(row.id)
    const toggle = () => setSelected(current => current.includes(row.id)
      ? current.filter(id => id !== row.id) : [...current, row.id])
    const classes = ['selectable-row']
    const canDrag = !busy && !exporting && rows.length > 1
    if (isSelected) classes.push('selected-row')
    if (rowDrag?.id === row.id) classes.push('dragging-row')
    else if (rowDrag?.targetId === row.id) classes.push(rowDrag.after ? 'drop-after' : 'drop-before')
    return {
      className: classes.join(' '),
      'data-row-id': row.id,
      tabIndex: 0,
      'aria-selected': isSelected,
      onPointerDown: event => {
        skipRowClick.current = false
        if (event.button !== 0 || event.target.closest('input, button, select, a, textarea')) return
        const wrapper = event.currentTarget.closest('.table-wrap')
        if (!wrapper) return
        rowPointer.current = {
          id: row.id, pointer: event.pointerId, source: event.currentTarget, wrapper,
          startX: event.clientX, startY: event.clientY, startScroll: wrapper.scrollLeft, canReorder: canDrag,
        }
      },
      onClick: event => {
        if (event.detail && skipRowClick.current) return
        toggle()
      },
      onKeyDown: event => {
        if (event.target !== event.currentTarget) return
        if ([' ', 'Enter'].includes(event.key)) {
          event.preventDefault()
          toggle()
        } else if (canDrag && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
          event.preventDefault()
          const offset = event.key === 'ArrowUp' ? -1 : 1
          const target = rows[rows.indexOf(row) + offset]
          if (target) moveRow(row.id, target.id, offset > 0)
        }
      },
    }
  }

  async function run(selection) {
    if (processing.current) return
    const files = [...selection].filter(file => file?.type.startsWith('image/'))
    if (!files.length) return
    processing.current = true
    setBusy(true)
    setRecognition({ done: 0, total: files.length, stage: '准备识别' })
    setStatus(`已接收 ${files.length} 张截图。`)
    try {
      const recognizer = await loadModel()
      let failed = 0
      let foundMultiple = false
      const additions = []
      const duplicateRows = []
      const firstBatchId = nextId.current
      const titleKey = value => (value || '').normalize('NFKC').replace(/\s+/g, '').toLowerCase()
      const titles = new Map()
      for (const row of rows) {
        const key = titleKey(row.values[0])
        if (key) titles.set(key, [...(titles.get(key) || []), row])
      }
      for (const [index, file] of files.entries()) {
        const name = file.name
        let entries = []
        const url = URL.createObjectURL(file)
        setRecognition({ done: index, total: files.length, stage: `读取第 ${index + 1} 张` })
        setStatus(`正在读取第 ${index + 1}/${files.length} 张 · ${name}`)
        let values = columns.map(column => column === '作品状态' ? '未知' : '')
        let error = false
        try {
          const progress = (count, retry) => {
            const found = entries.length > 1 ? ` · 已识别到 ${entries.length} 条作品` : ''
            const stage = retry ? '正在补识别' : count ? '正在读取字段' : '正在定位文字'
            setRecognition(current => ({
              done: index, total: files.length, stage,
              fraction: Math.max(current?.done === index ? current.fraction || 0 : 0, count / columns.length * 0.88),
            }))
            setStatus(`第 ${index + 1}/${files.length} 张 · ${name} · ${stage}${count ? ` ${count}/${columns.length}` : ''}${found}`)
          }
          const crops = await splitScreenshot(url)
          for (const blob of crops.filter(Boolean)) {
            const cropUrl = URL.createObjectURL(blob)
            try {
              const values = await recognizer.recognize(cropUrl, progress, { quick: true })
              if (values[1] && values.slice(2, -1).filter(Boolean).length >= 3) {
                entries.push({ values, url: cropUrl, local: true })
                if (entries.length > 1) setStatus(`第 ${index + 1}/${files.length} 张 · 已识别到多个结果（${entries.length} 条）`)
              } else URL.revokeObjectURL(cropUrl)
            } catch {
              URL.revokeObjectURL(cropUrl)
            }
          }
          if (entries.length < 2) {
            for (const entry of entries) URL.revokeObjectURL(entry.url)
            entries = []
            values = await recognizer.recognize(url, progress)
          } else URL.revokeObjectURL(url)
        } catch (cause) {
          console.error(cause)
          failed++
          error = true
        }
        if (entries.length > 1) foundMultiple = true
        const batchRows = (entries.length ? entries : [{ values, error, url }])
          .map((entry, position) => ({
            ...entry,
            id: nextId.current++,
            account: activeAccount.current,
            name: entries.length ? `${name} · 第 ${position + 1} 条` : name,
          }))
        const ready = []
        for (const row of batchRows) {
          if (!keepScreenshots) {
            URL.revokeObjectURL(row.url)
            row.url = null
          }
          const key = titleKey(row.values[0])
          const matches = titles.get(key)
          if (matches) {
            const target = matches.find(item => row.values[1] && item.values[1] === row.values[1]) || matches[0]
            duplicateRows.push({ ...row, target })
          } else {
            ready.push(row)
            if (key) titles.set(key, [row])
          }
        }
        additions.push(...ready)
        if (ready.length) setRows(current => [...current, ...ready])
        setRecognition({ done: index + 1, total: files.length, stage: '已完成识别' })
        setStatus(`已识别 ${index + 1}/${files.length} 张，已添加 ${additions.length} 条结果。`)
      }
      let decision = { ids: [], mode: 'add' }
      if (duplicateRows.length) {
        setStatus(`已识别到 ${duplicateRows.length} 条重复作品，等待选择。`)
        decision = await new Promise(resolve => setDuplicates({ rows: duplicateRows, resolve }))
      }
      const accepted = duplicateRows.filter(row => {
        if (decision.ids.includes(row.id)) return true
        if (row.url) URL.revokeObjectURL(row.url)
        return false
      })
      const replacements = decision.mode === 'replace' ? accepted : []
      if (replacements.length) {
        const byId = new Map(replacements.map(({ target, ...row }) => [target.id, row]))
        for (const { target } of replacements) {
          if (target.url) URL.revokeObjectURL(target.url)
          preparedImages.current.delete(target.url)
        }
        setPreviews(current => Object.fromEntries(Object.entries(current).filter(([id]) => !byId.has(Number(id)))))
        setRows(current => current.map(row => {
          const replacement = byId.get(row.id)
          return replacement ? { ...row, values: replacement.values, url: replacement.url, error: replacement.error, name: replacement.name } : row
        }))
      } else if (accepted.length) {
        const newRows = accepted.map(({ target, ...row }) => row)
        additions.push(...newRows)
        setRows(current => [
          ...current.filter(row => row.id < firstBatchId),
          ...[...current.filter(row => row.id >= firstBatchId), ...newRows].sort((a, b) => a.id - b.id),
        ])
      }
      const skipped = duplicateRows.length - accepted.length
      const incomplete = additions.filter(row => !row.error && row.values.some(value => !value)).length
      setStatus(`本批处理 ${files.length} 张，添加 ${additions.length} 条结果。${replacements.length ? `已替换 ${replacements.length} 条重复作品。` : ''}${foundMultiple ? '已识别到多作品截图。' : ''}${skipped ? `已跳过 ${skipped} 条重复作品。` : ''}${failed ? `${failed} 张读取失败。` : ''}${incomplete ? `${incomplete} 条有字段待补填。` : ''}`)
    } catch (error) {
      console.error(error)
      setStatus('OCR 模型启动失败，请通过启动脚本重新打开页面。')
    } finally {
      processing.current = false
      setBusy(false)
    }
  }

  useEffect(() => {
    function receivePaste(event) {
      if (dialog || duplicates || processing.current) return
      const images = [...(event.clipboardData?.items || [])]
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile()).filter(Boolean)
      if (!images.length) return
      event.preventDefault()
      run(images.map((image, index) => clipboardFile(image, index)))
    }
    document.addEventListener('paste', receivePaste)
    return () => document.removeEventListener('paste', receivePaste)
  })

  function clipboardFile(image, index) {
    const extension = image.type.split('/')[1]?.replace('jpeg', 'jpg').replace(/[^a-z0-9]/gi, '') || 'png'
    return new File([image], `剪贴板截图-${Date.now()}-${index + 1}.${extension}`, { type: image.type })
  }

  async function pasteImages() {
    try {
      const items = await navigator.clipboard.read()
      const images = []
      for (const item of items) {
        const type = item.types.find(type => type.startsWith('image/'))
        if (type) images.push(await item.getType(type))
      }
      if (!images.length) {
        setStatus('剪贴板里没有图片，请先复制截图。')
        return
      }
      run(images.map((image, index) => clipboardFile(image, index)))
    } catch {
      setStatus('浏览器无法读取剪贴板图片，请在页面按 Ctrl+V 粘贴。')
    }
  }

  async function copy() {
    const values = rows.map((row, index) => [index + 1, ...fields.map(field => valueFor(row, field).replace(/[\t\r\n]+/g, ' '))])
    try {
      if (view === 'excel') {
        const html = (async () => {
          const table = excelTable.current.cloneNode(true)
          table.querySelectorAll('[data-controls]').forEach(cell => cell.remove())
          await Promise.all([...table.querySelectorAll('[data-screenshot]')].map(async (cell, index) => {
            const row = rows[index]
            const image = row.url ? await prepareImage(row).catch(() => null) : null
            cell.replaceChildren()
            if (image) {
              const thumbnail = document.createElement('img')
              thumbnail.src = image.base64
              thumbnail.alt = row.name
              thumbnail.width = 120
              cell.append(thumbnail)
            }
          }))
          return new Blob([table.outerHTML], { type: 'text/html' })
        })()
        const tsv = keepScreenshots ? [[...headings, '截图'],
          ...values.map((row, index) => [...row, rows[index].url ? rows[index].name : ''])] : [headings, ...values]
        const plain = tsv
          .map(line => line.join('\t')).join('\r\n')
        await navigator.clipboard.write([new ClipboardItem({
          'text/html': html,
          'text/plain': new Blob([plain], { type: 'text/plain' }),
        })])
      } else {
        await navigator.clipboard.writeText([headings, ...values].map(line => line.join('\t')).join('\r\n'))
      }
      setStatus(`已复制 ${rows.length} 行和表头，可直接粘贴到 Excel。`)
    } catch {
      setStatus('复制失败，请检查浏览器的剪贴板权限。')
    }
  }

  async function download() {
    setExporting(true)
    setStatus('正在准备 Excel 工作簿…')
    try {
      const { exportExcel } = await import('./excel')
      const totalImages = rows.filter(row => row.url).length
      let processedImages = 0
      await exportExcel(headings, rows.map((row, index) => ({ ...row, values: [index + 1, ...fields.map(field => valueFor(row, field))] })),
        spans, accountColumns, includeAnalysis ? analysis : null, keepScreenshots ? async row => {
          setStatus(`正在处理 Excel 截图 ${++processedImages}/${totalImages}…`)
          return prepareImage(row)
        } : null, () => setStatus('正在打包 Excel 工作簿…'))
      setStatus('已生成 Excel 工作簿。')
    } catch (error) {
      console.error(error)
      setStatus('Excel 导出失败，请重试。')
    } finally {
      setExporting(false)
    }
  }

  return <main>
    <header>
      <h1>抖音数据分析</h1>
      <p>批量提取作品数据截图里的标题、发布时间和流量指标。</p>
      <p className="contact-line">
        美拍、矩阵、拍照找我拍
        <button type="button" className="secondary contact-icon" title="查看微信二维码" aria-label="查看微信二维码"
          onClick={() => setDialog('wechat')}>
          <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round">
            <path d="M3 3h6v6H3zm12 0h6v6h-6zM3 15h6v6H3zm12 0h3v3h3v3h-6zM12 3v3m0 6h3m-9 0h3m3 6v3m9-9v3"/>
          </svg>
        </button>
      </p>
    </header>
    {dialog === 'wechat' && <SettingsDialog title="微信二维码" close={() => setDialog('')}>
      <img className="wechat-qr" src={wechatQr} alt="Cchua 的微信二维码"/>
    </SettingsDialog>}
    <section className="card">
      <div className="toolbar">
        <h2>截图</h2>
        <div className="actions">
          <button className="secondary" onClick={() => {
            setDraftAccounts(accounts)
            setDraftDefault(defaultAccount)
            setDialog('accounts')
          }}>账号预设</button>
        </div>
      </div>
      <div
        className={dragging ? 'drop active' : 'drop'}
        onDragEnter={event => {
          event.preventDefault()
          if (!event.dataTransfer.types.includes('Files')) return
          dragDepth.current++
          if (!busy) setDragging(true)
        }}
        onDragOver={event => {
          event.preventDefault()
          event.dataTransfer.dropEffect = busy ? 'none' : 'copy'
        }}
        onDragLeave={() => {
          dragDepth.current = Math.max(0, dragDepth.current - 1)
          if (!dragDepth.current) setDragging(false)
        }}
        onDrop={event => {
          event.preventDefault()
          dragDepth.current = 0
          setDragging(false)
          const images = [...event.dataTransfer.files].filter(file => file.type.startsWith('image/'))
          if (busy) return
          if (images.length) run(images)
          else if (event.dataTransfer.files.length) setStatus('请拖入截图图片。')
        }}
      >
        <strong>{dragging ? '松开鼠标开始识别' : '把截图拖到这里'}</strong>
        <p>{busy ? '当前批次识别完成后，可继续添加截图。' : '可拖入多张截图，也可按 Ctrl+V 粘贴。'}</p>
      </div>
      <div className="actions upload-actions">
          <button disabled={busy} onClick={() => picker.current.click()}>选择图片（可多选）</button>
          <button disabled={busy} className="secondary" onClick={pasteImages}>粘贴图片</button>
      </div>
      <div className="ocr-progress">
        <label htmlFor="model-progress">{model.label}{model.progress === 1 && <span className="model-ready-check" aria-hidden="true">✓</span>}</label>
        <progress id="model-progress" value={model.indeterminate ? undefined : model.progress} max="1"/>
        {model.error && <button className="secondary" onClick={() => loadModel().catch(console.error)}>重试加载</button>}
        <small className="model-loading-note">首次加载需要一定时间</small>
      </div>
      <input ref={picker} type="file" accept="image/*" multiple hidden onChange={event => {
        run(event.target.files)
        event.target.value = ''
      }}/>
    </section>
    {dialog === 'accounts' && <SettingsDialog title="账号预设" close={() => setDialog('')} save={saveAccounts}>
      <AccountPresets accounts={draftAccounts} update={setDraftAccounts} active={draftDefault} selectDefault={setDraftDefault}
        remove={account => {
          setDraftAccounts(current => current.filter(item => item.key !== account.key))
          if (draftDefault === account.key) setDraftDefault('')
        }}/>
    </SettingsDialog>}
    {duplicates && <DuplicateDialog rows={duplicates.rows} resolve={ids => {
      duplicates.resolve(ids)
      setDuplicates(null)
    }}/>}
    {dialog === 'fields' && <SettingsDialog title="信息选定" close={() => setDialog('')} save={() => setFieldSettings(draftFields)}>
      <p>勾选要显示和导出的字段，用箭头调整列顺序。开启「保留截图」后，截图在 Excel 的最后一列。</p>
      <ol className="field-list">{draftFields.map(({ key, enabled }, index) => {
        const field = allFields.find(item => item.key === key)
        return <li key={key}>
          <label><input type="checkbox" checked={enabled} onChange={event => {
            const checked = event.target.checked
            setDraftFields(current => current.map(item => item.key === key ? { ...item, enabled: checked } : item))
          }}/>{field.label}</label>
          <button className="secondary" disabled={!index} aria-label={`上移 ${field.label}`} onClick={() => moveField(index, -1)}>↑</button>
          <button className="secondary" disabled={index === draftFields.length - 1} aria-label={`下移 ${field.label}`} onClick={() => moveField(index, 1)}>↓</button>
        </li>
      })}</ol>
      <button className="secondary restore-fields" onClick={() => setDraftFields(defaultFields())}>恢复默认预设</button>
    </SettingsDialog>}
    <section className="card" aria-busy={busy}>
      <div className="actions view-switch" aria-label="结果视图">
        <button aria-pressed={view === 'excel'} className={view === 'excel' ? '' : 'secondary'} onClick={() => setView('excel')}>Excel版本</button>
        <button aria-pressed={view === 'results'} className={view === 'results' ? '' : 'secondary'} onClick={() => setView('results')}>识别结果</button>
      </div>
      <div className={view === 'excel' ? 'toolbar excel-toolbar' : 'toolbar'}>
        <h2>{view === 'excel' ? 'Excel版本' : '识别结果'}{rows.length ? `（${rows.length} 行）` : ''}</h2>
        <div className="actions">
          <button className="secondary" onClick={() => {
            setDraftFields(fieldSettings)
            setDialog('fields')
          }}>信息选定</button>
          <button className="secondary" disabled={!rows.length || busy || exporting} onClick={() => {
            releaseScreenshots()
            setRows([])
            setSelected([])
            setStatus('')
          }}>清空表格</button>
          <button disabled={!rows.length || busy} onClick={copy}>复制整表</button>
          {view === 'excel' && <button disabled={!rows.length || busy || exporting} onClick={download}>
            {exporting ? '正在导出…' : '下载 Excel'}
          </button>}
        </div>
      </div>
      <p role="status">{status || '选择图片后，每张截图生成一行，结果可直接编辑。'}</p>
      {recognition && <div className="ocr-progress">
        <label htmlFor="recognition-progress">识别进度 · {recognition.done}/{recognition.total} 张</label>
        <progress id="recognition-progress" value={recognition.done + (recognition.fraction || 0)} max={recognition.total}/>
      </div>}
      <div className="actions assignment">
        <h3>添加作品信息</h3>
        <label><input type="checkbox" checked={keepScreenshots} disabled={busy || exporting}
          onChange={event => changeScreenshotRetention(event.target.checked)}/> 保留截图</label>
        {rows.length > 0 && accounts.length > 0 && <>
        <button className="secondary" onClick={() => setSelected(selected.length === rows.length ? [] : rows.map(row => row.id))}>
          {selected.length === rows.length ? '取消全选' : '全选作品'}
        </button>
        <AccountSelect accounts={accounts} value={batchAccount} change={setBatchAccount} label="批量分配账号"/>
        <button disabled={!selected.length} onClick={() => {
          assign(selected, batchAccount)
          setSelected([])
        }}>应用到选中作品（{selected.length}）</button>
        </>}
        {rows.length > 0 && view === 'excel' && <label><input type="checkbox" checked={mergeAccounts}
          onChange={event => setMergeAccounts(event.target.checked)}/> 合并连续同账号单元格</label>}
        {rows.length > 0 && view === 'excel' && <label><input type="checkbox" checked={includeAnalysis}
          onChange={event => setIncludeAnalysis(event.target.checked)}/> 数据分析保留</label>}
      </div>
      {rows.length > 0 && <p className="selection-hint">左右拖动查看其他列，上下拖动作品行可排序。点击作品行可多选。{view === 'excel' && '双击数据可编辑，修改账号字段会同步到该账号预设。'}</p>}
      {rows.length > 0 && view === 'excel' && <div className="table-wrap">
        <table ref={excelTable} className="excel-table">
          <thead><tr>{accounts.length > 0 && <th data-controls className="account-column">分配账号</th>}{(keepScreenshots ? [...headings, '截图'] : headings).map(column => <th key={column} scope="col">{column}</th>)}<th data-controls scope="col" className="delete-column">操作</th></tr></thead>
          <tbody {...dragEvents}>{rows.map((row, index) => <tr key={row.id} {...rowSelection(row)}>
            {accounts.length > 0 && <td data-controls className="account-column">{rowControls(row)}</td>}
            <td>{index + 1}</td>
            {fields.map(field => (!field.account || spans[index] > 0) &&
              <td key={field.key} rowSpan={field.account ? spans[index] : undefined}
                className={field.index === 0 || field.index === 1 ? 'single-line-value' : undefined}
                onDoubleClick={field.account && !row.account ? undefined : () => setEditing({ rowId: row.id, key: field.key })}>
                {excelValue(row, field)}
              </td>)}
            {keepScreenshots && <td data-screenshot>{row.url && <a href={row.url} target="_blank" rel="noopener noreferrer"
              onClick={event => event.stopPropagation()}>
              {previews[row.id] ? <img src={previews[row.id]} alt={row.name} width="120" loading="lazy" decoding="async"/> : '查看原图'}
            </a>}</td>}
            {rowActions(row)}
          </tr>)}</tbody>
        </table>
      </div>}
      {rows.length > 0 && view === 'results' && <div className="table-wrap">
        <table className="results-table">
          <thead><tr><th scope="col" className="source">来源图片</th>{accounts.length > 0 && <th scope="col" className="account-column">分配账号</th>}{headings.map(column => <th key={column} scope="col">{column}</th>)}<th scope="col" className="delete-column">操作</th></tr></thead>
          <tbody {...dragEvents}>{rows.map((row, index) => <tr key={row.id} {...rowSelection(row)}>
            <th scope="row" className="source" title={row.name}>{row.name}{row.error && <small>读取失败</small>}</th>
            {accounts.length > 0 && <td className="account-column">{rowControls(row)}</td>}
            <td>{index + 1}</td>
            {fields.map(field => <td key={field.key}>
              {field.account ? valueFor(row, field) : <input className={field.manual ? 'link-value' : field.index === 0 ? 'title-value' : field.index === 1 ? 'date-value' : undefined}
                aria-label={`${row.name} · ${field.label}`} value={valueFor(row, field)} placeholder={field.manual ? '' : '待补填'}
                onBlur={field.label === '发布时间' ? event => {
                  const formatted = formatPublicationTime(event.target.value)
                  changeValue(row.id, field, formatted)
                } : undefined} onChange={event => {
                const edited = event.target.value
                changeValue(row.id, field, edited)
              }}/>}
            </td>)}
            {rowActions(row)}
          </tr>)}</tbody>
        </table>
      </div>}
    </section>
    <section className="card analysis-card">
      <h2>数据分析</h2>
      <p>合计按已识别的数值计算。平均完播率按有完播率的作品等权计算。</p>
      <table>
        <thead><tr><th scope="col">统计项</th><th scope="col">结果</th><th scope="col">参与统计作品数</th></tr></thead>
        <tbody>{analysis.map(item => <tr key={item.label}>
          <th scope="row">{item.label}</th>
          <td>{item.value == null ? '—' : item.percent ? (item.value * 100).toFixed(2) + '%' : item.value.toLocaleString('zh-CN')}</td>
          <td>{item.samples}</td>
        </tr>)}</tbody>
      </table>
      <PlayShareChart rows={rows} playIndex={columns.indexOf('播放量')}/>
    </section>
    <ProjectFooter/>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
