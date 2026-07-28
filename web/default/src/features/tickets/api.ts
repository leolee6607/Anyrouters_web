/*
Copyright (C) 2023-2026 QuantumNous

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program. If not, see <https://www.gnu.org/licenses/>.

For commercial licensing, please contact support@quantumnous.com
*/
import { api } from '@/lib/api'
import type { Ticket } from './types'

// ---- User (self) ----

export async function listSelfTickets(archived = false): Promise<Ticket[]> {
  const res = await api.get('/api/ticket/self', {
    params: archived ? { archived: 1 } : {},
  } as Record<string, unknown>)
  return res.data?.data ?? []
}

export async function archiveSelfTicket(
  id: number,
  archived: boolean
): Promise<void> {
  await api.post(`/api/ticket/self/${id}/archive`, { archived })
}

export async function deleteSelfTicket(id: number): Promise<void> {
  await api.delete(`/api/ticket/self/${id}`)
}

export async function getSelfTicket(id: number): Promise<Ticket> {
  const res = await api.get(`/api/ticket/self/${id}`)
  if (!res.data?.success) throw new Error(res.data?.message || 'failed')
  return res.data.data
}

export async function createTicket(
  title: string,
  content: string
): Promise<Ticket> {
  const res = await api.post('/api/ticket/self', { title, content })
  if (!res.data?.success) throw new Error(res.data?.message || 'failed')
  return res.data.data
}

export async function replySelfTicket(
  id: number,
  content: string
): Promise<Ticket> {
  const res = await api.post(`/api/ticket/self/${id}/reply`, { content })
  if (!res.data?.success) throw new Error(res.data?.message || 'failed')
  return res.data.data
}

export async function closeSelfTicket(id: number): Promise<void> {
  await api.post(`/api/ticket/self/${id}/close`, {})
}

export async function getSelfUnreadCount(): Promise<number> {
  const res = await api.get('/api/ticket/self/unread', {
    skipErrorHandler: true,
  })
  return res.data?.data ?? 0
}

// ---- Admin (staff) ----

export interface AdminTicketList {
  items: Ticket[]
  total: number
  admin_unread: number
}

export async function getAdminUnreadCount(): Promise<number> {
  const res = await api.get('/api/ticket/admin/unread', {
    skipErrorHandler: true,
  })
  return res.data?.data ?? 0
}

export async function listAdminTickets(
  status = '',
  page = 1,
  pageSize = 20
): Promise<AdminTicketList> {
  const res = await api.get('/api/ticket/admin', {
    params: { status, p: page, page_size: pageSize },
  } as Record<string, unknown>)
  const d = res.data?.data ?? {}
  return {
    items: d.items ?? [],
    total: d.total ?? 0,
    admin_unread: d.admin_unread ?? 0,
  }
}

export async function getAdminTicket(id: number): Promise<Ticket> {
  const res = await api.get(`/api/ticket/admin/${id}`)
  if (!res.data?.success) throw new Error(res.data?.message || 'failed')
  return res.data.data
}

export async function replyAdminTicket(
  id: number,
  content: string
): Promise<Ticket> {
  const res = await api.post(`/api/ticket/admin/${id}/reply`, { content })
  if (!res.data?.success) throw new Error(res.data?.message || 'failed')
  return res.data.data
}

export async function setAdminTicketStatus(
  id: number,
  status: 'open' | 'closed'
): Promise<void> {
  await api.post(`/api/ticket/admin/${id}/status`, { status })
}

export async function archiveAdminTicket(
  id: number,
  archived: boolean
): Promise<void> {
  await api.post(`/api/ticket/admin/${id}/archive`, { archived })
}

export async function deleteAdminTicket(id: number): Promise<void> {
  await api.delete(`/api/ticket/admin/${id}`)
}
