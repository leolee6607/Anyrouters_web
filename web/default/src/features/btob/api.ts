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

// B2B pricing lives behind an admin-only (role=10) endpoint that exposes just
// the GroupRatio + GroupModelRatio options — the generic /api/option surface is
// Root-only. See controller/btob.go.

export type B2BPricingResponse = {
  success: boolean
  message?: string
  data: {
    /** JSON string: { group: scalarRatio } */
    group_ratio: string
    /** JSON string: { group: { model_name: multiplier } } */
    group_model_ratio: string
    /** JSON string: { group: "display name" } — cosmetic labels only. */
    group_labels: string
  }
}

export async function getB2BPricing(): Promise<B2BPricingResponse> {
  const res = await api.get('/api/btob/pricing')
  return res.data
}

export async function updateB2BPricing(payload: {
  group_ratio?: string
  group_model_ratio?: string
}): Promise<{ success: boolean; message?: string }> {
  const res = await api.put('/api/btob/pricing', payload)
  return res.data
}

// Provision makes the B2B group usable end-to-end: it ensures the group exists
// and appends it to every serving channel (rebuilding abilities), so B2B users
// can actually call models. Idempotent — safe to call repeatedly.
export async function provisionB2BGroup(group = 'btob'): Promise<{
  success: boolean
  message?: string
  data?: { group: string; channels_updated: number }
}> {
  const res = await api.post('/api/btob/provision', { group })
  return res.data
}

// One B2B customer, flattened for the admin table. `group` is the group they
// bill under: "btob" (shared default tier), "b2b_<id>" (dedicated), or any
// shared tier group.
export type B2BCustomer = {
  id: number
  username: string
  display_name: string
  email: string
  group: string
  remark: string
  quota: number
  used_quota: number
}

// List every B2B customer (shared btob group + all dedicated b2b_<id> groups).
export async function getB2BCustomers(): Promise<{
  success: boolean
  message?: string
  data: B2BCustomer[]
}> {
  const res = await api.get('/api/btob/customers')
  return res.data
}

// Move a customer between groups. group === '' auto-creates/uses their dedicated
// group b2b_<id>; 'default' drops them out of B2B; any other name moves them
// into that existing/shared group. Target B2B groups are auto-provisioned.
export async function moveB2BCustomer(payload: {
  user_id: number
  group: string
}): Promise<{ success: boolean; message?: string }> {
  const res = await api.post('/api/btob/customers/move', payload)
  return res.data
}

// Replace ONE group's per-model discount table (other groups untouched). Pass an
// empty models map to clear this group's overrides. Multipliers are the raw
// group_model_ratio values (override on top of the group ratio).
export async function updateB2BGroupPricing(payload: {
  group: string
  models: Record<string, number>
}): Promise<{ success: boolean; message?: string }> {
  const res = await api.put('/api/btob/group-pricing', payload)
  return res.data
}

// Set (or clear, with an empty label) ONE group's display name. Cosmetic only —
// the real group name (billing key) is never changed.
export async function updateB2BGroupLabel(payload: {
  group: string
  label: string
}): Promise<{ success: boolean; message?: string }> {
  const res = await api.put('/api/btob/group-label', payload)
  return res.data
}

export type B2BBalanceAlertInput = {
  group: string
  user_id: number
  enabled: boolean
  threshold_quota: number
  recipients: string[]
  revision: number
}

export type B2BBalanceAlert = B2BBalanceAlertInput & {
  last_checked_at: number
  last_notified_at: number
  delivery_failed: boolean
}

export type B2BAlertTestResult = { sent: string[]; failed: string[] }

export async function getB2BBalanceAlerts(
  group: string
): Promise<{ success: boolean; data: B2BBalanceAlert[] }> {
  const response = await api.get('/api/btob/balance-alerts', {
    params: { group },
  })
  return response.data
}

export async function saveB2BBalanceAlert(
  payload: B2BBalanceAlertInput
): Promise<{ success: boolean }> {
  const response = await api.put('/api/btob/balance-alerts', payload)
  return response.data
}

export async function testB2BBalanceAlert(
  payload: B2BBalanceAlertInput
): Promise<{ success: boolean; data: B2BAlertTestResult }> {
  const response = await api.post('/api/btob/balance-alerts/test', payload)
  return response.data
}
