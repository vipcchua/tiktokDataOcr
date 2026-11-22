export function formatPublicationTime(value) {
  const text = String(value || '').trim().normalize('NFKC')
  const match = text.match(/^(\d{4})\s*[-–—/.年]\s*(\d{1,2})\s*[-–—/.月]\s*(\d{1,2})\s*日?[T\s]+(\d{1,2})\s*:\s*(\d{1,2})(?::\d{2})?$/i)
  if (!match) return text
  const [, year, month, day, hour, minute] = match
  const date = new Date(Date.UTC(+year, +month - 1, +day, +hour, +minute))
  if (date.getUTCFullYear() !== +year || date.getUTCMonth() !== +month - 1 ||
    date.getUTCDate() !== +day || date.getUTCHours() !== +hour || date.getUTCMinutes() !== +minute) return text
  const pad = part => part.padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)} ${pad(hour)}:${pad(minute)}`
}

export function parseCount(value) {
  const text = String(value ?? '').normalize('NFKC').replace(/[,\s]/g, '')
  const match = text.match(/^(\d+(?:\.\d+)?)([万亿]?)$/)
  if (!match) return null
  const number = Number(match[1]) * ({ 万: 1e4, 亿: 1e8 }[match[2]] || 1)
  return Number.isFinite(number) ? number : null
}

export function summarizeRows(rows, columns) {
  const result = [{ label: '作品数', value: rows.length, samples: rows.length }]
  const assigned = rows.filter(row => row.account)
  result.push({ label: '发布账号数量', value: new Set(assigned.map(row => row.account)).size, samples: assigned.length })
  for (const label of ['播放量', '点赞量', '评论量', '分享量', '收藏量', '弹幕量']) {
    const index = columns.indexOf(label)
    const values = rows.map(row => parseCount(row.values[index])).filter(value => value !== null)
    result.push({ label: `总${label}`, value: values.length ? Math.round(values.reduce((a, b) => a + b, 0)) : null, samples: values.length })
  }
  const completion = columns.indexOf('完播率')
  const rates = rows.flatMap(row => {
    const text = String(row.values[completion] ?? '').normalize('NFKC').trim()
    return /^\d+(?:\.\d+)?\s*%$/.test(text) && parseFloat(text) <= 100 ? [parseFloat(text) / 100] : []
  })
  result.push({
    label: '平均完播率', percent: true, samples: rates.length,
    value: rates.length ? rates.reduce((a, b) => a + b, 0) / rates.length : null,
  })
  return result
}
