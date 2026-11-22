import { formatPublicationTime } from './analysis'

export async function exportExcel(columns, rows, spans = [], accountColumns = [], analysis = null, screenshots = null, onPack = () => {}) {
  const { default: ExcelJS } = await import('exceljs')
  const workbook = new ExcelJS.Workbook()
  const sheet = workbook.addWorksheet('识别结果')
  const columnWidths = { 标题: 15.5, 链接: 16, 发布时间: 19 }
  sheet.columns = (screenshots ? [...columns, '截图'] : columns).map(header => ({
    header,
    width: columnWidths[header] ?? [...header].reduce((width, character) => width + (/[^\x00-\x7F]/.test(character) ? 2 : 1), 2),
  }))
  sheet.getRow(1).font = { bold: true }
  const dateColumn = columns.indexOf('发布时间')
  for (const row of rows) {
    const values = [...row.values]
    if (dateColumn >= 0) {
      const formatted = formatPublicationTime(values[dateColumn])
      const date = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/.test(formatted)
        ? new Date(formatted.replace(' ', 'T') + ':00Z') : null
      values[dateColumn] = date && !Number.isNaN(date.valueOf()) ? date : formatted
    }
    const line = sheet.addRow(values)
    if (dateColumn >= 0 && values[dateColumn] instanceof Date) line.getCell(dateColumn + 1).numFmt = 'yyyy-mm-dd hh:mm'
    line.alignment = { vertical: 'middle', wrapText: true }
    if (!screenshots || !row.url) continue
    let image
    try {
      image = await screenshots(row)
    } catch {
      line.getCell(columns.length + 1).value = row.name
      continue
    }
    line.height = 72
    const column = columns.length
    const rowIndex = line.number - 1
    const columnPixels = sheet.getColumn(column + 1).width * 7 + 5
    const rowPixels = line.height * 4 / 3
    const fit = Math.min((columnPixels - 4) / image.width, (rowPixels - 4) / image.height)
    const width = image.width * fit
    const height = image.height * fit
    const x = (columnPixels - width) / 2
    const y = (rowPixels - height) / 2
    const anchor = (left, top) => ({
      nativeCol: column, nativeRow: rowIndex,
      nativeColOff: Math.round(left * 9525), nativeRowOff: Math.round(top * 9525),
    })
    const id = workbook.addImage({ base64: image.base64, extension: 'jpeg' })
    sheet.addImage(id, { tl: anchor(x, y), br: anchor(x + width, y + height), editAs: 'twoCell' })
  }
  for (const [index, span] of spans.entries()) {
    if (span < 2) continue
    for (const column of accountColumns) sheet.mergeCells(index + 2, column + 1, index + span + 1, column + 1)
  }
  if (analysis) {
    const summary = workbook.addWorksheet('数据分析')
    summary.columns = [{ header: '统计项', width: 15 }, { header: '结果', width: 13 }, { header: '参与统计作品数', width: 17 }]
    summary.getRow(1).font = { bold: true }
    for (const item of analysis) {
      const line = summary.addRow([item.label, item.value, item.samples])
      if (item.percent) line.getCell(2).numFmt = '0.00%'
    }
  }
  onPack()
  const buffer = await workbook.xlsx.writeBuffer()
  const url = URL.createObjectURL(new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  }))
  const link = document.createElement('a')
  link.href = url
  link.download = '作品识别结果.xlsx'
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
