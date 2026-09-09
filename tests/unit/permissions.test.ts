import { describe, expect, it } from 'vitest'
import { CAPABILITIES, can, canTouchProject, capabilitiesFor, isProjectScoped } from '@/lib/auth/permissions'
import { MEMBER_ROLES } from '@/lib/domain/types'

describe('role matrix', () => {
  it('gives Owner/Admin everything', () => {
    for (const capability of CAPABILITIES) expect(can('owner_admin', capability)).toBe(true)
  })

  it('withholds only workspace security from the Operations Lead', () => {
    expect(can('operations_lead', 'manage_security')).toBe(false)
    expect(can('operations_lead', 'manage_settings')).toBe(true)
    expect(can('operations_lead', 'manage_billing')).toBe(true)
    expect(can('operations_lead', 'log_time_for_others')).toBe(true)
  })

  it('stops the Resource Manager at the money', () => {
    expect(can('resource_manager', 'manage_bookings')).toBe(true)
    expect(can('resource_manager', 'manage_assignments')).toBe(true)
    expect(can('resource_manager', 'manage_billing')).toBe(false)
    expect(can('resource_manager', 'view_billing')).toBe(false)
    expect(can('resource_manager', 'manage_settings')).toBe(false)
  })

  it('stops Finance at scope and staffing', () => {
    expect(can('finance', 'manage_billing')).toBe(true)
    expect(can('finance', 'view_reports')).toBe(true)
    expect(can('finance', 'manage_projects')).toBe(false)
    expect(can('finance', 'manage_assignments')).toBe(false)
    expect(can('finance', 'manage_bookings')).toBe(false)
  })

  it('gives a logger no workspace capability whatsoever', () => {
    expect(capabilitiesFor('logger')).toHaveLength(0)
    for (const capability of CAPABILITIES) expect(can('logger', capability)).toBe(false)
  })

  it('covers every role', () => {
    for (const role of MEMBER_ROLES) expect(Array.isArray(capabilitiesFor(role))).toBe(true)
  })
})

describe('project scoping', () => {
  const mine = { ownerMemberId: 'me' }
  const theirs = { ownerMemberId: 'someone-else' }
  const unowned = { ownerMemberId: null }

  it('limits a Project Manager to the engagements they own', () => {
    expect(isProjectScoped('project_manager')).toBe(true)
    expect(canTouchProject('project_manager', 'me', mine)).toBe(true)
    expect(canTouchProject('project_manager', 'me', theirs)).toBe(false)
    expect(canTouchProject('project_manager', 'me', unowned)).toBe(false)
  })

  it('does not scope anyone else', () => {
    expect(canTouchProject('operations_lead', 'me', theirs)).toBe(true)
    expect(canTouchProject('owner_admin', 'me', unowned)).toBe(true)
  })
})
