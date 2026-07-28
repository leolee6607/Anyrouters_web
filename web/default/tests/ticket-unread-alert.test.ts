import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const apiSource = readFileSync(
  new URL('../src/features/tickets/api.ts', import.meta.url),
  'utf8'
)
const providerSource = readFileSync(
  new URL(
    '../src/features/tickets/ticket-unread-provider.tsx',
    import.meta.url
  ),
  'utf8'
)
const sidebarSource = readFileSync(
  new URL('../src/hooks/use-sidebar-data.ts', import.meta.url),
  'utf8'
)
const layoutSource = readFileSync(
  new URL(
    '../src/components/layout/components/authenticated-layout.tsx',
    import.meta.url
  ),
  'utf8'
)

test('ticket unread polling is global, role-aware, and quiet on transport errors', () => {
  expect(apiSource).toContain("'/api/ticket/admin/unread'")
  expect(apiSource).toContain('skipErrorHandler: true')
  expect(providerSource).toContain('POLL_INTERVAL_MS = 30_000')
  expect(providerSource).toContain('document.visibilityState')
  expect(providerSource).toContain('refreshInFlight')
  expect(providerSource).toContain('ROLE.ADMIN')
  expect(providerSource).toContain('getAdminUnreadCount')
  expect(providerSource).toContain('toast.warning')
  expect(layoutSource).toContain('<TicketUnreadProvider>')
})

test('user and admin ticket links expose unread badges', () => {
  expect(sidebarSource).toContain('badge: badge(userUnread)')
  expect(sidebarSource).toContain('badge: badge(adminUnread)')
  expect(sidebarSource).toContain("count > 99 ? '99+'")
})
