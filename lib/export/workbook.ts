import 'server-only'
import ExcelJS from 'exceljs'

/**
 * Spreadsheet export built from the SAME query function the page renders, so "the
 * export matches the screen" is true by construction rather than by discipline
 * (SC-010).
 */
export type SheetColumn = {
  header: string
  key: string
  width?: number
  /** money → workspace currency format, hours → 2dp, date → workspace date format. */
  type?: 'text' | 'money' | 'hours' | 'date' | 'percent' | 'number'
}

export type SheetSpec = {
  name: string
  columns: SheetColumn[]
  rows: Record<string, string | number | null>[]
  /** Rendered above the table, e.g. the period and filters the figures cover. */
  caption?: string[]
  totalsRow?: Record<string, string | number | null>
}

export async function buildWorkbook(opts: {
  title: string
  currency: string
  sheets: SheetSpec[]
}): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook()
  workbook.creator = 'Agency Operations'
  workbook.created = new Date()

  const moneyFormat = `#,##0.00 "${opts.currency}"`

  for (const spec of opts.sheets) {
    const sheet = workbook.addWorksheet(spec.name.slice(0, 31))

    let cursor = 1
    if (spec.caption && spec.caption.length > 0) {
      for (const line of spec.caption) {
        const cell = sheet.getCell(cursor, 1)
        cell.value = line
        cell.font = { size: 10, color: { argb: 'FF6B7280' } }
        cursor += 1
      }
      cursor += 1
    }

    const headerRow = sheet.getRow(cursor)
    spec.columns.forEach((column, index) => {
      const cell = headerRow.getCell(index + 1)
      cell.value = column.header
      cell.font = { bold: true, size: 10 }
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFF3F4F6' } }
      cell.border = { bottom: { style: 'thin', color: { argb: 'FFD1D5DB' } } }
      sheet.getColumn(index + 1).width = column.width ?? Math.max(12, column.header.length + 4)
    })
    headerRow.commit()
    cursor += 1

    const writeRow = (data: Record<string, string | number | null>, bold = false) => {
      const row = sheet.getRow(cursor)
      spec.columns.forEach((column, index) => {
        const cell = row.getCell(index + 1)
        const value = data[column.key] ?? null
        cell.value = value
        if (bold) cell.font = { bold: true }
        switch (column.type) {
          case 'money':
            cell.numFmt = moneyFormat
            break
          case 'hours':
            cell.numFmt = '#,##0.00'
            break
          case 'percent':
            cell.numFmt = '0"%"'
            break
          case 'number':
            cell.numFmt = '#,##0'
            break
          default:
            break
        }
        if (column.type && column.type !== 'text' && column.type !== 'date') {
          cell.alignment = { horizontal: 'right' }
        }
      })
      row.commit()
      cursor += 1
    }

    for (const row of spec.rows) writeRow(row)

    if (spec.totalsRow) {
      const row = sheet.getRow(cursor)
      spec.columns.forEach((_column, index) => {
        row.getCell(index + 1).border = { top: { style: 'thin', color: { argb: 'FF9CA3AF' } } }
      })
      row.commit()
      writeRow(spec.totalsRow, true)
    }

    sheet.views = [{ state: 'frozen', ySplit: cursor - spec.rows.length - (spec.totalsRow ? 2 : 1) }]
  }

  const buffer = await workbook.xlsx.writeBuffer()
  return Buffer.from(buffer)
}

export function centsToUnits(cents: number): number {
  return Math.round(cents) / 100
}

export function minutesToHoursValue(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100
}

export function downloadHeaders(filename: string): HeadersInit {
  return {
    'Content-Type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'Content-Disposition': `attachment; filename="${filename}"`,
    'Cache-Control': 'no-store',
  }
}
