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
import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Pencil } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { formatUserCode, parseUserCode } from '@/lib/user-code'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import { Spinner } from '@/components/ui/spinner'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import {
  sideDrawerContentClassName,
  sideDrawerHeaderClassName,
} from '@/components/drawer-layout'
import { getPricing } from '@/features/pricing/api'
import type { PricingModel, PricingVendor } from '@/features/pricing/types'
import { getUser, searchUsers, updateUser } from '@/features/users/api'
import type { User } from '@/features/users/types'
import {
  getB2BCustomers,
  getB2BPricing,
  moveB2BCustomer,
  updateB2BGroupLabel,
  type B2BCustomer,
} from '../api'
import {
  B2B_GROUP,
  formatDiscount,
  getCEndDiscount,
  groupVendorDiscounts,
  isDedicatedB2BGroup,
} from '../lib'
import { B2BBalanceAlertPanel } from './balance-alert-panel'
import { B2BPricingPanel } from './pricing-panel'

// $1 of quota = 500000 internal units (project invariant).
const QUOTA_PER_DOLLAR = 500000

function usd(quota: number): string {
  return `$${(quota / QUOTA_PER_DOLLAR).toFixed(2)}`
}

// Built-in C-end groups that are never B2B move targets.
const C_END_GROUPS = new Set(['default', 'vip', 'svip'])

const NEW_DEDICATED = '__new__'
const MOVE_OUT = 'default'

export function B2BCustomersPanel() {
  const { t, i18n } = useTranslation()
  const zh = i18n.language?.startsWith('zh') ?? false
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [keyword, setKeyword] = useState('')
  const [pricingGroup, setPricingGroup] = useState<string | null>(null)
  const [alertGroup, setAlertGroup] = useState<string | null>(null)

  const customersQuery = useQuery({
    queryKey: ['btob-customers'],
    queryFn: getB2BCustomers,
  })
  const customers = useMemo(
    () => customersQuery.data?.data ?? [],
    [customersQuery.data]
  )

  const b2bQuery = useQuery({
    queryKey: ['btob-pricing'],
    queryFn: getB2BPricing,
  })
  const pricingQuery = useQuery({ queryKey: ['pricing'], queryFn: getPricing })

  // group -> per-model override map (for discount summaries).
  const overridesByGroup = useMemo<
    Record<string, Record<string, number>>
  >(() => {
    try {
      return JSON.parse(b2bQuery.data?.data.group_model_ratio || '{}')
    } catch {
      return {}
    }
  }, [b2bQuery.data])

  // group -> display label (cosmetic).
  const labels = useMemo<Record<string, string>>(() => {
    try {
      return JSON.parse(b2bQuery.data?.data.group_labels || '{}')
    } catch {
      return {}
    }
  }, [b2bQuery.data])

  const pricingModels = useMemo<PricingModel[]>(
    () =>
      (pricingQuery.data?.data ?? []).filter((m) => getCEndDiscount(m) != null),
    [pricingQuery.data]
  )
  const pricingVendors = useMemo<PricingVendor[]>(
    () => pricingQuery.data?.vendors ?? [],
    [pricingQuery.data]
  )

  // Every B2B group that should appear as a card: btob + all dedicated/shared
  // groups from the ratio table AND groups customers actually sit in (so empty
  // shared tiers still show). C-end groups excluded. Order: btob, dedicated, shared.
  const groups = useMemo<string[]>(() => {
    const set = new Set<string>([B2B_GROUP])
    try {
      const ratios = JSON.parse(b2bQuery.data?.data.group_ratio || '{}')
      for (const g of Object.keys(ratios)) if (!C_END_GROUPS.has(g)) set.add(g)
    } catch {
      /* ignore */
    }
    for (const g of Object.keys(overridesByGroup))
      if (!C_END_GROUPS.has(g)) set.add(g)
    for (const c of customers) if (!C_END_GROUPS.has(c.group)) set.add(c.group)
    return Array.from(set).sort((a, b) => {
      if (a === B2B_GROUP) return -1
      if (b === B2B_GROUP) return 1
      const ad = isDedicatedB2BGroup(a)
      const bd = isDedicatedB2BGroup(b)
      if (ad !== bd) return ad ? -1 : 1
      return a.localeCompare(b)
    })
  }, [b2bQuery.data, overridesByGroup, customers])

  // Customers bucketed by group.
  const byGroup = useMemo<Record<string, B2BCustomer[]>>(() => {
    const kw = keyword.trim()
    const kwUpper = kw.toUpperCase()
    const match = (u: B2BCustomer) =>
      !kw ||
      u.username.includes(kw) ||
      u.display_name.includes(kw) ||
      String(u.id) === kw ||
      formatUserCode(u.id).includes(kwUpper)
    const out: Record<string, B2BCustomer[]> = {}
    for (const c of customers) {
      if (!match(c)) continue
      ;(out[c.group] ||= []).push(c)
    }
    return out
  }, [customers, keyword])

  // Default display name for a group (falls back to a sensible auto label).
  const defaultGroupName = (g: string): string => {
    if (g === B2B_GROUP) return t('Overall default tier')
    if (isDedicatedB2BGroup(g)) return t('Dedicated group')
    return g
  }

  const moveMutation = useMutation({
    mutationFn: async ({ id, target }: { id: number; target: string }) => {
      const group = target === NEW_DEDICATED ? '' : target
      const res = await moveB2BCustomer({ user_id: id, group })
      if (!res.success) throw new Error(res.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Customer updated'))
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
      queryClient.invalidateQueries({ queryKey: ['btob-pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const labelMutation = useMutation({
    mutationFn: async ({ group, label }: { group: string; label: string }) => {
      const res = await updateB2BGroupLabel({ group, label })
      if (!res.success) throw new Error(res.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Group name saved'))
      queryClient.invalidateQueries({ queryKey: ['btob-pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  // Add a user to B2B by AR code / numeric id / username, into a chosen group.
  const [addInput, setAddInput] = useState('')
  const [addTarget, setAddTarget] = useState<string>(B2B_GROUP)
  const addMutation = useMutation({
    mutationFn: async (identifier: string) => {
      const id = parseUserCode(identifier)
      let target: User | undefined
      if (id != null) {
        const res = await getUser(id)
        if (res.success && res.data) target = res.data
      }
      if (!target) {
        const res = await searchUsers({ keyword: identifier, page_size: 10 })
        target = res.data?.items?.find(
          (u) => u.username === identifier || u.display_name === identifier
        )
      }
      if (!target) throw new Error(t('User not found'))
      const group = addTarget === NEW_DEDICATED ? '' : addTarget
      const res = await moveB2BCustomer({ user_id: target.id, group })
      if (!res.success) throw new Error(res.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Customer added'))
      setAddInput('')
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
      queryClient.invalidateQueries({ queryKey: ['btob-pricing'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const groupSelectLabel = (g: string, ownerId?: number): string => {
    const custom = labels[g]
    if (custom) return custom
    if (g === B2B_GROUP) return t('Overall default tier')
    if (isDedicatedB2BGroup(g)) {
      if (ownerId != null && g === `b2b_${ownerId}`) return t('Dedicated group')
      return `${t('Dedicated group')} (${g})`
    }
    return g
  }

  const loading =
    customersQuery.isLoading || b2bQuery.isLoading || pricingQuery.isLoading

  return (
    <div className='space-y-4'>
      <Card>
        <CardHeader>
          <CardTitle>{t('Add B2B customer')}</CardTitle>
          <CardDescription>
            {t(
              'Enter a username or user ID and pick the group to move them into.'
            )}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className='flex flex-wrap items-center gap-2'>
            <Input
              className='max-w-xs'
              placeholder={t('Username or ID')}
              value={addInput}
              onChange={(e) => setAddInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && addInput.trim())
                  addMutation.mutate(addInput.trim())
              }}
            />
            <Select
              value={addTarget}
              onValueChange={(target) => {
                if (target) setAddTarget(target)
              }}
            >
              <SelectTrigger className='w-52'>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={B2B_GROUP}>
                  {t('Overall default tier')}
                </SelectItem>
                <SelectItem value={NEW_DEDICATED}>
                  {t('New dedicated group')}
                </SelectItem>
                {groups
                  .filter((g) => g !== B2B_GROUP)
                  .map((g) => (
                    <SelectItem key={g} value={g}>
                      {groupSelectLabel(g)}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            <Button
              onClick={() =>
                addInput.trim() && addMutation.mutate(addInput.trim())
              }
              disabled={addMutation.isPending || !addInput.trim()}
            >
              {addMutation.isPending && <Spinner className='mr-2 size-4' />}
              {t('Add')}
            </Button>
          </div>
        </CardContent>
      </Card>

      <div className='flex items-center justify-between'>
        <p className='text-muted-foreground text-sm'>
          {t('{{count}} B2B customers across {{groups}} groups', {
            count: customers.length,
            groups: groups.length,
          })}
        </p>
        <Input
          className='max-w-xs'
          placeholder={t('Filter by name / ID')}
          value={keyword}
          onChange={(e) => setKeyword(e.target.value)}
        />
      </div>

      {loading ? (
        <div className='flex justify-center py-12'>
          <Spinner />
        </div>
      ) : (
        // One card per group. btob first (overall default tier), then dedicated
        // groups, then shared tiers.
        groups.map((g) => {
          const rows = byGroup[g] ?? []
          const summary = groupVendorDiscounts(
            pricingModels,
            pricingVendors,
            overridesByGroup[g] ?? {}
          )
          return (
            <Card key={g}>
              <CardHeader>
                <div className='flex flex-wrap items-start justify-between gap-3'>
                  <div className='space-y-1'>
                    <GroupTitle
                      group={g}
                      label={labels[g] ?? ''}
                      fallback={defaultGroupName(g)}
                      editable={g !== B2B_GROUP}
                      saving={
                        labelMutation.isPending &&
                        labelMutation.variables?.group === g
                      }
                      onSave={(label) =>
                        labelMutation.mutate({ group: g, label })
                      }
                    />
                    <div className='text-muted-foreground flex flex-wrap items-center gap-x-3 gap-y-1 text-xs'>
                      <span className='font-mono'>{g}</span>
                      <span>·</span>
                      <span>
                        {t('{{count}} customers', { count: rows.length })}
                      </span>
                      {summary.length > 0 && <span>·</span>}
                      {summary.map((s) => (
                        <span key={s.vendorName}>
                          {s.vendorName} {formatDiscount(s.discount, zh)}
                        </span>
                      ))}
                    </div>
                  </div>
                  <div className='flex flex-wrap gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={
                        !customers.some((customer) => customer.group === g)
                      }
                      onClick={() => setAlertGroup(g)}
                    >
                      {t('Usage reminder')}
                    </Button>
                    <Button
                      variant='outline'
                      size='sm'
                      onClick={() => setPricingGroup(g)}
                    >
                      {t('Edit discount')}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                {rows.length === 0 ? (
                  <p className='text-muted-foreground py-4 text-center text-sm'>
                    {t('No customers in this group yet.')}
                  </p>
                ) : (
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('User Code')}</TableHead>
                        <TableHead>{t('User')}</TableHead>
                        <TableHead>{t('Balance')}</TableHead>
                        <TableHead>{t('Used')}</TableHead>
                        <TableHead>{t('Remark')}</TableHead>
                        <TableHead>{t('Move to group')}</TableHead>
                        <TableHead className='text-right'>
                          {t('Actions')}
                        </TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {rows.map((u) => (
                        <TableRow key={u.id}>
                          <TableCell className='font-mono'>
                            {formatUserCode(u.id)}
                          </TableCell>
                          <TableCell>
                            <div className='font-medium'>{u.display_name}</div>
                            <div className='text-muted-foreground text-xs'>
                              {u.username}
                            </div>
                          </TableCell>
                          <TableCell>{usd(u.quota)}</TableCell>
                          <TableCell>{usd(u.used_quota)}</TableCell>
                          <TableCell>
                            <RemarkCell userId={u.id} value={u.remark ?? ''} />
                          </TableCell>
                          <TableCell>
                            <Select
                              value={u.group}
                              onValueChange={(target) => {
                                if (target && target !== u.group)
                                  moveMutation.mutate({ id: u.id, target })
                              }}
                              disabled={moveMutation.isPending}
                            >
                              <SelectTrigger className='h-7 w-40 text-xs'>
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                <SelectGroup>
                                  <SelectLabel>
                                    {t('Move to group')}
                                  </SelectLabel>
                                  {groups.map((gg) => (
                                    <SelectItem key={gg} value={gg}>
                                      {groupSelectLabel(gg, u.id)}
                                    </SelectItem>
                                  ))}
                                  {!groups.includes(`b2b_${u.id}`) && (
                                    <SelectItem value={NEW_DEDICATED}>
                                      {t('New dedicated group')}
                                    </SelectItem>
                                  )}
                                </SelectGroup>
                                <SelectSeparator />
                                <SelectItem value={MOVE_OUT}>
                                  {t('Remove from B2B')}
                                </SelectItem>
                              </SelectContent>
                            </Select>
                          </TableCell>
                          <TableCell className='space-x-2 text-right'>
                            <Button
                              variant='ghost'
                              size='sm'
                              onClick={() =>
                                navigate({
                                  to: '/usage-logs/$section',
                                  params: { section: 'common' },
                                  search: {
                                    username: formatUserCode(u.id),
                                    type: [2],
                                  } as never,
                                })
                              }
                            >
                              {t('View usage')}
                            </Button>
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                )}
              </CardContent>
            </Card>
          )
        })
      )}

      <Sheet
        open={alertGroup != null}
        onOpenChange={(open) => !open && setAlertGroup(null)}
      >
        <SheetContent className={sideDrawerContentClassName('sm:max-w-xl')}>
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>
              {t('Usage reminder')} ·{' '}
              {alertGroup
                ? labels[alertGroup] || defaultGroupName(alertGroup)
                : ''}
            </SheetTitle>
            <SheetDescription>
              {t(
                'Notify your team before a customer’s account balance runs out.'
              )}
            </SheetDescription>
          </SheetHeader>
          <div className='min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-5 sm:px-6'>
            {alertGroup && (
              <B2BBalanceAlertPanel
                key={alertGroup}
                group={alertGroup}
                customers={customers.filter(
                  (customer) => customer.group === alertGroup
                )}
              />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Per-group pricing drawer. */}
      <Sheet
        open={pricingGroup != null}
        onOpenChange={(v) => !v && setPricingGroup(null)}
      >
        <SheetContent className={sideDrawerContentClassName('sm:max-w-2xl')}>
          <SheetHeader className={sideDrawerHeaderClassName()}>
            <SheetTitle>
              {t('Edit discount')} ·{' '}
              {pricingGroup
                ? labels[pricingGroup] || defaultGroupName(pricingGroup)
                : ''}
            </SheetTitle>
            <SheetDescription>{pricingGroup ?? ''}</SheetDescription>
          </SheetHeader>
          <div className='overflow-y-auto px-4 pb-6'>
            {pricingGroup && (
              <div className='py-4'>
                <B2BPricingPanel
                  group={pricingGroup}
                  showProvision={false}
                  showNotes={false}
                />
              </div>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  )
}

// GroupTitle shows a group's display name and, when editable, lets the admin
// rename it inline (a cosmetic label; the real group id never changes). The
// overall default tier (btob) is not renamable.
function GroupTitle({
  group,
  label,
  fallback,
  editable,
  saving,
  onSave,
}: {
  group: string
  label: string
  fallback: string
  editable: boolean
  saving: boolean
  onSave: (label: string) => void
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(label)

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== label) onSave(next)
  }

  if (editing) {
    return (
      <div className='flex items-center gap-1'>
        <Input
          autoFocus
          className='h-8 max-w-[220px]'
          value={draft}
          maxLength={60}
          placeholder={t('Group display name')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(label)
              setEditing(false)
            }
          }}
        />
        {saving && <Spinner className='size-4' />}
      </div>
    )
  }

  return (
    <div className='flex items-center gap-2'>
      <CardTitle className='text-base'>{label || fallback}</CardTitle>
      {group === B2B_GROUP && (
        <Badge variant='secondary' className='text-xs'>
          {t('Default')}
        </Badge>
      )}
      {editable && (
        <button
          type='button'
          className='text-muted-foreground hover:text-foreground'
          title={t('Rename group')}
          onClick={() => {
            setDraft(label)
            setEditing(true)
          }}
        >
          <Pencil className='size-3.5' />
        </button>
      )}
    </div>
  )
}

// RemarkCell — inline-editable customer remark (stored on User.remark, shared
// with the global user list). Fetches the full user before saving so Edit's
// validated fields (username/display_name/group) are preserved.
function RemarkCell({ userId, value }: { userId: number; value: string }) {
  const { t } = useTranslation()
  const queryClient = useQueryClient()
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)

  const remarkMutation = useMutation({
    mutationFn: async (remark: string) => {
      const res = await getUser(userId)
      if (!res.success || !res.data) {
        throw new Error(res.message || t('User not found'))
      }
      const u = res.data
      const upd = await updateUser({
        id: u.id,
        username: u.username,
        display_name: u.display_name,
        group: u.group,
        remark,
      })
      if (!upd.success) throw new Error(upd.message || t('Update failed'))
    },
    onSuccess: () => {
      toast.success(t('Remark saved'))
      queryClient.invalidateQueries({ queryKey: ['btob-customers'] })
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const commit = () => {
    setEditing(false)
    const next = draft.trim()
    if (next !== value) remarkMutation.mutate(next)
  }

  if (editing) {
    return (
      <div className='flex items-center gap-1'>
        <Input
          autoFocus
          className='h-7 max-w-[160px] text-xs'
          value={draft}
          maxLength={255}
          placeholder={t('Add remark')}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit()
            if (e.key === 'Escape') {
              setDraft(value)
              setEditing(false)
            }
          }}
        />
        {remarkMutation.isPending && <Spinner className='size-3.5' />}
      </div>
    )
  }

  return (
    <button
      type='button'
      className='hover:bg-muted text-muted-foreground max-w-[160px] truncate rounded px-2 py-1 text-left text-xs'
      onClick={() => {
        setDraft(value)
        setEditing(true)
      }}
      title={value || t('Add remark')}
    >
      {value || <span className='opacity-50'>{t('Add remark')}</span>}
    </button>
  )
}
