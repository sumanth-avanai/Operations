/**
 * The shape of the demo agency, as data.
 *
 * Deliberately built so every guardrail is observable without configuring anything:
 * part-time patterns, a contract ending mid-quarter and one that started mid-quarter,
 * two holiday calendars, all four leave types, a role whose budget is too tight, and
 * non-billable internal work alongside client work.
 */
import type {
  BillingMethodName, LeavePortion, LeaveTypeName, MemberRoleName, WorkingMinutes,
} from '@/lib/domain/types'

export const FULL: WorkingMinutes = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 480, sat: 0, sun: 0 }
export const FOUR_DAY: WorkingMinutes = { mon: 480, tue: 480, wed: 480, thu: 480, fri: 0, sat: 0, sun: 0 }
export const THREE_DAY: WorkingMinutes = { mon: 360, tue: 0, wed: 360, thu: 0, fri: 360, sat: 0, sun: 0 }
export const SHORT_WED: WorkingMinutes = { mon: 480, tue: 480, wed: 240, thu: 480, fri: 480, sat: 0, sun: 0 }

export type MemberSpec = {
  name: string
  email: string
  role: MemberRoleName
  workingMinutes: WorkingMinutes
  targetPct: number | null
  calendar: 'berlin' | 'england'
  color: string
  contractStartOffsetDays?: number
  contractEndOffsetDays?: number
  /** How reliably they fill in their week — produces realistic gaps. */
  diligence: number
}

export const MEMBER_SPECS: MemberSpec[] = [
  { name: 'Amara Okafor', email: 'amara@meridian.studio', role: 'owner_admin', workingMinutes: FULL, targetPct: 30, calendar: 'berlin', color: 'var(--hue-8)', diligence: 0.82 },
  { name: 'Jonas Feldt', email: 'jonas@meridian.studio', role: 'operations_lead', workingMinutes: FULL, targetPct: 45, calendar: 'berlin', color: 'var(--hue-1)', diligence: 0.95 },
  { name: 'Priya Raghavan', email: 'priya@meridian.studio', role: 'resource_manager', workingMinutes: FULL, targetPct: 50, calendar: 'berlin', color: 'var(--hue-2)', diligence: 0.93 },
  { name: 'Mara Lindqvist', email: 'mara@meridian.studio', role: 'project_manager', workingMinutes: FULL, targetPct: 65, calendar: 'berlin', color: 'var(--hue-3)', diligence: 0.9 },
  { name: 'Tobias Berger', email: 'tobias@meridian.studio', role: 'project_manager', workingMinutes: SHORT_WED, targetPct: 65, calendar: 'berlin', color: 'var(--hue-4)', diligence: 0.86 },
  { name: 'Ruben Castellanos', email: 'ruben@meridian.studio', role: 'finance', workingMinutes: FOUR_DAY, targetPct: 10, calendar: 'berlin', color: 'var(--hue-5)', diligence: 0.97 },
  { name: 'Lena Vogt', email: 'lena@meridian.studio', role: 'logger', workingMinutes: FOUR_DAY, targetPct: 80, calendar: 'berlin', color: 'var(--hue-6)', diligence: 0.94 },
  { name: 'Sam Hollis', email: 'sam@meridian.studio', role: 'logger', workingMinutes: FULL, targetPct: 85, calendar: 'england', color: 'var(--hue-7)', diligence: 0.88 },
  // Contract ends six weeks out: availability must fall to zero after it.
  { name: 'Nadia Cherif', email: 'nadia@meridian.studio', role: 'logger', workingMinutes: FULL, targetPct: 85, calendar: 'berlin', color: 'var(--hue-2)', contractEndOffsetDays: 42, diligence: 0.91 },
  // Started five weeks ago: availability must be zero before it.
  { name: 'Emeka Nwosu', email: 'emeka@meridian.studio', role: 'logger', workingMinutes: FULL, targetPct: 75, calendar: 'berlin', color: 'var(--hue-4)', contractStartOffsetDays: -35, diligence: 0.8 },
  { name: 'Ines Duarte', email: 'ines@meridian.studio', role: 'logger', workingMinutes: THREE_DAY, targetPct: 70, calendar: 'england', color: 'var(--hue-5)', diligence: 0.9 },
]

export const CLIENT_SPECS = [
  { name: 'Halden Bank', color: 'var(--hue-1)', contactEmail: 'operations@haldenbank.example', notes: null },
  { name: 'Novaterra Energy', color: 'var(--hue-3)', contactEmail: 'projects@novaterra.example', notes: null },
  { name: 'Kestrel Retail', color: 'var(--hue-5)', contactEmail: 'digital@kestrel.example', notes: null },
  { name: 'Meridian Studio', color: 'var(--hue-8)', contactEmail: null, notes: 'Internal, non-billable work' },
]

export type RoleSpec = { name: string; rateCents: number; budgetCents: number; members: string[] }
export type ProjectSpec = {
  client: string
  name: string
  code: string
  billable: boolean
  billingMethod: BillingMethodName
  owner: string
  color: string
  roles: RoleSpec[]
}

export const PROJECT_SPECS: ProjectSpec[] = [
  {
    client: 'Halden Bank', name: 'Onboarding Redesign', code: 'HB-ONB', billable: true,
    billingMethod: 'time_and_materials', owner: 'Mara Lindqvist', color: 'var(--hue-1)',
    roles: [
      { name: 'Engagement Lead', rateCents: 16_500, budgetCents: 2_970_000, members: ['Mara Lindqvist'] },
      { name: 'Senior Designer', rateCents: 13_500, budgetCents: 5_400_000, members: ['Lena Vogt', 'Ines Duarte'] },
      { name: 'Developer', rateCents: 12_000, budgetCents: 4_800_000, members: ['Sam Hollis', 'Nadia Cherif'] },
    ],
  },
  {
    client: 'Halden Bank', name: 'Mobile App Phase 2', code: 'HB-APP2', billable: true,
    billingMethod: 'fixed_fee', owner: 'Tobias Berger', color: 'var(--hue-2)',
    roles: [
      { name: 'Engagement Lead', rateCents: 16_500, budgetCents: 1_320_000, members: ['Tobias Berger'] },
      // Deliberately tight, so this role goes over budget in the demo data.
      { name: 'Developer', rateCents: 12_500, budgetCents: 1_150_000, members: ['Nadia Cherif', 'Sam Hollis'] },
      { name: 'QA', rateCents: 9_500, budgetCents: 760_000, members: ['Emeka Nwosu'] },
    ],
  },
  {
    client: 'Novaterra Energy', name: 'Brand System', code: 'NV-BRAND', billable: true,
    billingMethod: 'fixed_fee', owner: 'Mara Lindqvist', color: 'var(--hue-3)',
    roles: [
      { name: 'Creative Director', rateCents: 17_500, budgetCents: 1_400_000, members: ['Mara Lindqvist'] },
      { name: 'Senior Designer', rateCents: 13_500, budgetCents: 3_240_000, members: ['Lena Vogt'] },
      { name: 'Designer', rateCents: 10_500, budgetCents: 1_680_000, members: ['Ines Duarte'] },
    ],
  },
  {
    client: 'Novaterra Energy', name: 'Data Platform', code: 'NV-DATA', billable: true,
    billingMethod: 'time_and_materials', owner: 'Tobias Berger', color: 'var(--hue-4)',
    roles: [
      { name: 'Engagement Lead', rateCents: 16_500, budgetCents: 1_650_000, members: ['Tobias Berger'] },
      { name: 'Data Engineer', rateCents: 14_500, budgetCents: 6_960_000, members: ['Emeka Nwosu', 'Sam Hollis'] },
    ],
  },
  {
    client: 'Kestrel Retail', name: 'Loyalty Programme', code: 'KR-LOY', billable: true,
    billingMethod: 'retainer', owner: 'Mara Lindqvist', color: 'var(--hue-6)',
    roles: [
      { name: 'Engagement Lead', rateCents: 15_500, budgetCents: 1_860_000, members: ['Mara Lindqvist'] },
      { name: 'Developer', rateCents: 12_000, budgetCents: 3_840_000, members: ['Nadia Cherif'] },
      { name: 'Designer', rateCents: 10_500, budgetCents: 1_260_000, members: ['Ines Duarte'] },
    ],
  },
  {
    client: 'Kestrel Retail', name: 'Store Ops Dashboard', code: 'KR-OPS', billable: true,
    billingMethod: 'time_and_materials', owner: 'Tobias Berger', color: 'var(--hue-7)',
    roles: [
      { name: 'Data Engineer', rateCents: 14_500, budgetCents: 2_320_000, members: ['Emeka Nwosu'] },
      { name: 'Developer', rateCents: 12_000, budgetCents: 2_400_000, members: ['Sam Hollis'] },
    ],
  },
  {
    client: 'Meridian Studio', name: 'Internal Tooling', code: 'MS-TOOL', billable: false,
    billingMethod: 'time_and_materials', owner: 'Jonas Feldt', color: 'var(--hue-8)',
    roles: [
      { name: 'Developer', rateCents: 12_000, budgetCents: 960_000, members: ['Sam Hollis', 'Emeka Nwosu'] },
      { name: 'Operations', rateCents: 11_000, budgetCents: 660_000, members: ['Jonas Feldt', 'Priya Raghavan'] },
    ],
  },
  {
    client: 'Meridian Studio', name: 'Studio & Admin', code: 'MS-ADMIN', billable: false,
    billingMethod: 'time_and_materials', owner: 'Amara Okafor', color: 'var(--hue-1)',
    roles: [
      { name: 'Leadership', rateCents: 0, budgetCents: 0, members: ['Amara Okafor', 'Jonas Feldt'] },
      { name: 'Finance', rateCents: 0, budgetCents: 0, members: ['Ruben Castellanos'] },
      { name: 'Resourcing', rateCents: 0, budgetCents: 0, members: ['Priya Raghavan'] },
    ],
  },
]

export type LeaveSpec = {
  member: string
  leaveType: LeaveTypeName
  fromOffset: number
  days: number
  portion: LeavePortion
  note: string
}

export const LEAVE_SPECS: LeaveSpec[] = [
  { member: 'Lena Vogt', leaveType: 'vacation', fromOffset: -38, days: 9, portion: 'full', note: 'Summer break' },
  { member: 'Sam Hollis', leaveType: 'sick', fromOffset: -12, days: 2, portion: 'full', note: '' },
  { member: 'Nadia Cherif', leaveType: 'unpaid', fromOffset: -25, days: 1, portion: 'full', note: 'Personal day' },
  { member: 'Emeka Nwosu', leaveType: 'other', fromOffset: -8, days: 1, portion: 'half', note: 'Training, half day' },
  // Future leave that overlaps a confirmed booking — the planner has to flag it.
  { member: 'Priya Raghavan', leaveType: 'vacation', fromOffset: 12, days: 5, portion: 'full', note: 'Booked before the project landed' },
  { member: 'Ines Duarte', leaveType: 'vacation', fromOffset: 26, days: 10, portion: 'full', note: 'Autumn holiday' },
]

/** memberName, projectName, roleName, offset from next Monday, days, hours/day, status, note */
export type BookingSpec = [string, string, string, number, number, number, 'tentative' | 'confirmed', string?]

export const BOOKING_SPECS: BookingSpec[] = [
  ['Lena Vogt', 'Onboarding Redesign', 'Senior Designer', 0, 12, 6, 'confirmed'],
  ['Sam Hollis', 'Onboarding Redesign', 'Developer', 0, 19, 7, 'confirmed'],
  ['Nadia Cherif', 'Mobile App Phase 2', 'Developer', 0, 26, 8, 'confirmed', 'Through to contract end'],
  ['Emeka Nwosu', 'Data Platform', 'Data Engineer', 0, 19, 6, 'confirmed'],
  ['Ines Duarte', 'Brand System', 'Designer', 5, 10, 6, 'confirmed'],
  ['Mara Lindqvist', 'Loyalty Programme', 'Engagement Lead', 0, 26, 2, 'confirmed'],
  ['Tobias Berger', 'Data Platform', 'Engagement Lead', 0, 26, 3, 'confirmed'],
  // Overlaps approved leave: those days must resolve to zero booked minutes.
  ['Priya Raghavan', 'Internal Tooling', 'Operations', 5, 12, 4, 'confirmed', 'Overlaps approved leave'],
  // Tentative while the deal is unconfirmed: excluded from committed budget.
  ['Lena Vogt', 'Loyalty Programme', 'Designer', 19, 15, 6, 'tentative', 'Pending client sign-off'],
  ['Sam Hollis', 'Store Ops Dashboard', 'Developer', 26, 20, 5, 'tentative', 'Awaiting purchase order'],
  // Over-commits the deliberately tight Developer role on Mobile App Phase 2.
  ['Sam Hollis', 'Mobile App Phase 2', 'Developer', 12, 15, 6, 'confirmed', 'Budget already committed — review'],
  // Ended before today with less logged than planned: slipped work.
  ['Ines Duarte', 'Onboarding Redesign', 'Senior Designer', -33, 10, 7, 'confirmed', 'Ran late'],
]

export type HealthSpec = {
  status: 'on_track' | 'at_risk' | 'on_hold' | 'done'
  risk: 'low' | 'medium' | 'high'
  satisfaction: number
  comment: string
}

export const HEALTH_SCRIPT: Record<string, HealthSpec[]> = {
  'Onboarding Redesign': [
    { status: 'on_track', risk: 'low', satisfaction: 4, comment: 'Discovery signed off, design sprint underway.' },
    { status: 'on_track', risk: 'medium', satisfaction: 4, comment: 'Client legal review is slower than planned; no schedule impact yet.' },
    { status: 'at_risk', risk: 'medium', satisfaction: 3, comment: 'Two design weeks slipped. Rebalancing the team next week.' },
  ],
  'Mobile App Phase 2': [
    { status: 'on_track', risk: 'medium', satisfaction: 4, comment: 'Fixed fee, scope holding so far.' },
    { status: 'at_risk', risk: 'high', satisfaction: 3, comment: 'Developer budget consumed faster than planned — commercial conversation needed.' },
  ],
  'Brand System': [
    { status: 'on_track', risk: 'low', satisfaction: 5, comment: 'Client delighted with the first territory.' },
    { status: 'done', risk: 'low', satisfaction: 5, comment: 'Delivered and handed over. Guidelines published.' },
  ],
  'Data Platform': [
    { status: 'on_track', risk: 'low', satisfaction: 4, comment: 'Ingestion pipeline live in staging.' },
    { status: 'on_track', risk: 'medium', satisfaction: 4, comment: 'Waiting on client access for two data sources.' },
  ],
  'Loyalty Programme': [
    { status: 'on_track', risk: 'low', satisfaction: 4, comment: 'Retainer steady, the monthly rhythm is working well.' },
  ],
  'Store Ops Dashboard': [
    { status: 'on_hold', risk: 'medium', satisfaction: 3, comment: 'Paused pending their budget cycle. Team released.' },
  ],
  'Internal Tooling': [
    { status: 'on_track', risk: 'low', satisfaction: 5, comment: 'Timesheet reminders shipped.' },
  ],
}

export const ENTRY_NOTES = [
  'Workshop prep and follow-up notes',
  'Design review with the client',
  'Pairing on the migration script',
  'Stakeholder interviews',
  'Accessibility pass',
  'Sprint planning',
  'Data model review',
  'Handover documentation',
]
