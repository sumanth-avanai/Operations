import { describe, expect, it } from 'vitest'
import {
  availabilityByDay, availableMinutes, bookedMinutesByDay, dayAvailability,
  effectiveBookedMinutes, isDayLocked, weeklyCapacityMinutes,
  type CapacityMember, type LeaveSpan,
} from '@/lib/domain/capacity'
import { LEAVE_PORTIONS, type ISODate, type WorkingMinutes } from '@/lib/domain/types'

const FULL_TIME: WorkingMinutes = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0, sun: 0 }
const PART_TIME: WorkingMinutes = { mon: 480, tue: 480, wed: 240, thu: 480, fri: 0, sat: 0, sun: 0 }

const fullTimer: CapacityMember = {
  workingMinutes: FULL_TIME,
  contractStart: '2026-01-01',
  contractEnd: null,
}

// Week under test: Mon 2026-09-14 .. Sun 2026-09-20
const WEEK = { from: '2026-09-14', to: '2026-09-20' }

describe('weeklyCapacityMinutes', () => {
  it('is the sum of the pattern, so the total can never disagree with it', () => {
    expect(weeklyCapacityMinutes(FULL_TIME)).toBe(2400)
    expect(weeklyCapacityMinutes(PART_TIME)).toBe(1680)
    expect(weeklyCapacityMinutes({ ...FULL_TIME, sat: 240 })).toBe(2640)
  })
})

describe('working pattern', () => {
  it('gives a full-timer 40 hours and nothing at the weekend', () => {
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to)).toBe(2400)
    expect(isDayLocked(fullTimer, '2026-09-19')).toBe(true) // Saturday
    expect(isDayLocked(fullTimer, '2026-09-18')).toBe(false) // Friday
    expect(dayAvailability(fullTimer, '2026-09-19').reason).toBe('non_working_day')
  })

  it('respects a part-time pattern including a short Wednesday', () => {
    const partTimer: CapacityMember = { ...fullTimer, workingMinutes: PART_TIME }
    expect(availableMinutes(partTimer, WEEK.from, WEEK.to)).toBe(1680)
    expect(dayAvailability(partTimer, '2026-09-16').minutes).toBe(240) // Wednesday
    expect(dayAvailability(partTimer, '2026-09-18').minutes).toBe(0) // Friday off
    expect(dayAvailability(partTimer, '2026-09-18').reason).toBe('non_working_day')
  })
})

describe('contract dates', () => {
  it('gives zero capacity before the contract starts', () => {
    const member: CapacityMember = { ...fullTimer, contractStart: '2026-09-16' }
    const day = dayAvailability(member, '2026-09-15')
    expect(day.minutes).toBe(0)
    expect(day.reason).toBe('before_contract')
    // Wed, Thu, Fri only
    expect(availableMinutes(member, WEEK.from, WEEK.to)).toBe(1440)
  })

  it('gives zero capacity after the contract ends, on the boundary day inclusive', () => {
    const member: CapacityMember = { ...fullTimer, contractEnd: '2026-09-16' }
    expect(dayAvailability(member, '2026-09-16').minutes).toBe(480) // last day still counts
    expect(dayAvailability(member, '2026-09-17').minutes).toBe(0)
    expect(dayAvailability(member, '2026-09-17').reason).toBe('after_contract')
    expect(availableMinutes(member, WEEK.from, WEEK.to)).toBe(1440)
  })

  it('outranks a holiday, because you cannot be off from a job you have left', () => {
    const member: CapacityMember = { ...fullTimer, contractEnd: '2026-09-15' }
    const holidays = new Map([['2026-09-16', 'Some Holiday']])
    expect(dayAvailability(member, '2026-09-16', holidays).reason).toBe('after_contract')
  })

  it('handles a mid-quarter start and end in the same range', () => {
    const member: CapacityMember = {
      ...fullTimer,
      contractStart: '2026-09-15',
      contractEnd: '2026-09-17',
    }
    expect(availableMinutes(member, WEEK.from, WEEK.to)).toBe(1440)
  })
})

describe('holidays', () => {
  const holidays = new Map([['2026-09-16', 'Day of German Unity (observed)']])

  it('removes the day and names the holiday', () => {
    const day = dayAvailability(fullTimer, '2026-09-16', holidays)
    expect(day.minutes).toBe(0)
    expect(day.reason).toBe('holiday')
    expect(day.label).toBe('Day of German Unity (observed)')
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, holidays)).toBe(1920)
  })

  it('changes availability when a member moves to a different calendar', () => {
    const bavaria = new Map([['2026-09-16', 'Regional holiday']])
    const berlin = new Map<string, string>()
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, bavaria)).toBe(1920)
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, berlin)).toBe(2400)
  })
})

describe('leave', () => {
  const vacation: LeaveSpan = {
    leaveType: 'vacation',
    startDate: '2026-09-17',
    endDate: '2026-09-18',
    portion: 'full',
  }

  it('removes whole days for full-day leave', () => {
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, undefined, [vacation])).toBe(1440)
    const day = dayAvailability(fullTimer, '2026-09-17', undefined, [vacation])
    expect(day.minutes).toBe(0)
    expect(day.reason).toBe('leave')
    expect(day.label).toBe('Vacation')
  })

  it('halves a day for half-day leave and keeps the remainder loggable', () => {
    const halfDay: LeaveSpan = {
      leaveType: 'sick',
      startDate: '2026-09-17',
      endDate: '2026-09-17',
      portion: 'half',
    }
    const day = dayAvailability(fullTimer, '2026-09-17', undefined, [halfDay])
    expect(day.minutes).toBe(240)
    expect(day.reason).toBe('leave')
    expect(day.label).toBe('Sick (half day)')
    expect(isDayLocked(fullTimer, '2026-09-17', undefined, [halfDay])).toBe(false)
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, undefined, [halfDay])).toBe(2160)
  })

  it('halves the day pattern, not a fixed four hours', () => {
    // Wednesday is a 4h day for the part-timer, so half of it is 2h. A fixed minutes
    // value could not express this, which is why the record stores a portion.
    const partTimer: CapacityMember = { ...fullTimer, workingMinutes: PART_TIME }
    const halfDay: LeaveSpan = {
      leaveType: 'other',
      startDate: '2026-09-16',
      endDate: '2026-09-16',
      portion: 'half',
    }
    expect(dayAvailability(partTimer, '2026-09-16').minutes).toBe(240)
    expect(dayAvailability(partTimer, '2026-09-16', undefined, [halfDay]).minutes).toBe(120)
  })

  it('resolves an overlap to the most absorbing record, never leaving phantom capacity', () => {
    // upsertLeave refuses overlapping records, so this state should not reach the domain.
    // If it ever does — a hand-inserted row, a legacy import — a full day has to win, or
    // the day keeps capacity a booking would silently fill.
    const overlap: LeaveSpan[] = [
      { leaveType: 'other', startDate: '2026-09-17', endDate: '2026-09-17', portion: 'half' },
      { leaveType: 'sick', startDate: '2026-09-17', endDate: '2026-09-17', portion: 'full' },
    ]
    expect(dayAvailability(fullTimer, '2026-09-17', undefined, overlap).minutes).toBe(0)
    expect(dayAvailability(fullTimer, '2026-09-17', undefined, [...overlap].reverse()).minutes).toBe(0)
  })

  it('does not double-remove a day that is both a holiday and leave', () => {
    const holidays = new Map([['2026-09-17', 'Public holiday']])
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, holidays, [vacation])).toBe(1440)
    // the holiday wins the label, since it applies to everyone
    expect(dayAvailability(fullTimer, '2026-09-17', holidays, [vacation]).reason).toBe('holiday')
  })

  it('ignores leave that falls on a non-working day', () => {
    const weekendLeave: LeaveSpan = {
      leaveType: 'vacation',
      startDate: '2026-09-19',
      endDate: '2026-09-20',
      portion: 'full',
    }
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, undefined, [weekendLeave])).toBe(2400)
    expect(dayAvailability(fullTimer, '2026-09-19', undefined, [weekendLeave]).reason).toBe(
      'non_working_day',
    )
  })

  it('applies every overlapping leave span in a range', () => {
    const spans: LeaveSpan[] = [
      vacation,
      { leaveType: 'unpaid', startDate: '2026-09-14', endDate: '2026-09-14', portion: 'full' },
    ]
    expect(availableMinutes(fullTimer, WEEK.from, WEEK.to, undefined, spans)).toBe(960)
  })
})

describe('a leave day is whole or half, never a free-form slice', () => {
  // The old record carried arbitrary `minutesPerDay`, so two part-days could land on one
  // date and the availability gate could only apply one of them — leaving capacity that a
  // booking would then silently fill. Two states, and one record per day, remove that.
  const day: ISODate = '2026-09-17'

  it('leaves exactly half the day when the record is half', () => {
    const half: LeaveSpan[] = [
      { leaveType: 'vacation', startDate: day, endDate: day, portion: 'half' },
    ]
    expect(dayAvailability(fullTimer, day, undefined, half).minutes).toBe(240)
  })

  it('leaves nothing when the record is full', () => {
    const full: LeaveSpan[] = [
      { leaveType: 'vacation', startDate: day, endDate: day, portion: 'full' },
    ]
    expect(dayAvailability(fullTimer, day, undefined, full).minutes).toBe(0)
  })

  it('has no third state: every portion resolves to the full day or half of it', () => {
    for (const portion of LEAVE_PORTIONS) {
      const minutes = dayAvailability(fullTimer, day, undefined, [
        { leaveType: 'other', startDate: day, endDate: day, portion },
      ]).minutes
      expect([0, 240], `portion ${portion}`).toContain(minutes)
    }
  })
})

describe('availabilityByDay', () => {
  it('returns one entry per day with reasons attached', () => {
    const holidays = new Map([['2026-09-16', 'Holiday']])
    const days = availabilityByDay(fullTimer, WEEK.from, WEEK.to, holidays)
    expect(days).toHaveLength(7)
    expect(days.map((d) => d.minutes)).toEqual([480, 480, 0, 480, 480, 0, 0])
    expect(days[2]?.label).toBe('Holiday')
  })
})

describe('effectiveBookedMinutes', () => {
  const booking = { startDate: '2026-09-14', endDate: '2026-09-20', minutesPerDay: 480 }

  it('only consumes days the member is genuinely available', () => {
    expect(effectiveBookedMinutes(fullTimer, booking, WEEK.from, WEEK.to)).toBe(2400)
  })

  it('contributes zero on holidays, leave and non-working days', () => {
    const holidays = new Map([['2026-09-16', 'Holiday']])
    const leave: LeaveSpan[] = [
      { leaveType: 'vacation', startDate: '2026-09-18', endDate: '2026-09-18', portion: 'full' },
    ]
    expect(effectiveBookedMinutes(fullTimer, booking, WEEK.from, WEEK.to, holidays, leave)).toBe(1440)
  })

  it('is capped by the day, so a 10h booking on an 8h day books 8h', () => {
    const heavy = { ...booking, minutesPerDay: 600 }
    expect(effectiveBookedMinutes(fullTimer, heavy, WEEK.from, WEEK.to)).toBe(2400)
  })

  it('clips to the window, not to the booking', () => {
    const long = { startDate: '2026-09-01', endDate: '2026-12-31', minutesPerDay: 480 }
    expect(effectiveBookedMinutes(fullTimer, long, WEEK.from, WEEK.to)).toBe(2400)
  })

  it('reports per-day minutes for the planner', () => {
    const holidays = new Map([['2026-09-16', 'Holiday']])
    const byDay = bookedMinutesByDay(fullTimer, booking, WEEK.from, WEEK.to, holidays)
    expect(byDay.get('2026-09-14')).toBe(480)
    expect(byDay.has('2026-09-16')).toBe(false)
    expect(byDay.has('2026-09-19')).toBe(false)
    expect([...byDay.values()].reduce((a, b) => a + b, 0)).toBe(1920)
  })
})
