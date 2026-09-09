import { describe, expect, it } from 'vitest'
import { englandHolidays, germanBerlinHolidays } from '@/lib/db/seed-holidays'
import { dayOfWeek } from '@/lib/domain/dates'

describe('computed public holidays', () => {
  it('places Easter-derived German holidays correctly for 2026', () => {
    // Easter Sunday 2026 is 5 April.
    const byName = new Map(germanBerlinHolidays(2026).map((h) => [h.name, h.holidayDate]))
    expect(byName.get('Karfreitag')).toBe('2026-04-03')
    expect(byName.get('Ostermontag')).toBe('2026-04-06')
    expect(byName.get('Christi Himmelfahrt')).toBe('2026-05-14')
    expect(byName.get('Pfingstmontag')).toBe('2026-05-25')
    expect(byName.get('Tag der Deutschen Einheit')).toBe('2026-10-03')
  })

  it('places Easter correctly in a different year', () => {
    // Easter Sunday 2027 is 28 March.
    const byName = new Map(germanBerlinHolidays(2027).map((h) => [h.name, h.holidayDate]))
    expect(byName.get('Karfreitag')).toBe('2027-03-26')
    expect(byName.get('Ostermontag')).toBe('2027-03-29')
  })

  it('puts every England bank holiday on a weekday', () => {
    for (const year of [2025, 2026, 2027]) {
      for (const holiday of englandHolidays(year)) {
        const dow = dayOfWeek(holiday.holidayDate)
        expect(dow, `${holiday.name} ${holiday.holidayDate}`).toBeGreaterThan(0)
        expect(dow, `${holiday.name} ${holiday.holidayDate}`).toBeLessThan(6)
      }
    }
  })

  it('finds the first and last Monday of the right months', () => {
    const byName = new Map(englandHolidays(2026).map((h) => [h.name, h.holidayDate]))
    expect(byName.get('Early May bank holiday')).toBe('2026-05-04')
    expect(byName.get('Spring bank holiday')).toBe('2026-05-25')
    expect(byName.get('Summer bank holiday')).toBe('2026-08-31')
  })

  it('never emits duplicate dates within a calendar', () => {
    for (const year of [2025, 2026, 2027]) {
      const dates = germanBerlinHolidays(year).map((h) => h.holidayDate)
      expect(new Set(dates).size).toBe(dates.length)
    }
  })
})
