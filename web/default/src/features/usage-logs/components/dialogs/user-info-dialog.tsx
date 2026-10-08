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
import { useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { formatQuota, formatCompactNumber } from '@/lib/format'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Dialog } from '@/components/dialog'
import { UserMonthlyUsageDialog } from '@/features/users/components/user-monthly-usage-dialog'
import { getUserInfo } from '../../api'

interface UserInfoDialogProps {
  userId: number | null
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function UserInfoDialog(props: UserInfoDialogProps) {
  if (!props.open || !props.userId) return null
  return (
    <UserInfoContent
      key={props.userId}
      userId={props.userId}
      onClose={() => props.onOpenChange(false)}
    />
  )
}

const InfoItem = ({
  label,
  value,
}: {
  label: string
  value: string | number
}) => (
  <div className='space-y-1.5'>
    <Label className='text-muted-foreground text-xs'>{label}</Label>
    <div className='text-sm font-semibold'>{value}</div>
  </div>
)

function UserInfoContent(props: { userId: number; onClose: () => void }) {
  const { t } = useTranslation()
  const [showUsage, setShowUsage] = useState(false)
  const query = useQuery({
    queryKey: ['admin-user-info', props.userId],
    queryFn: async () => {
      const result = await getUserInfo(props.userId)
      if (!result.success || !result.data)
        throw new Error('Unable to load user information')
      return result.data
    },
    staleTime: 0,
    gcTime: 0,
    retry: false,
    enabled: !showUsage,
  })
  const userInfo = query.data
  if (showUsage && userInfo) {
    return (
      <UserMonthlyUsageDialog
        user={{
          id: props.userId,
          username: userInfo.username,
          display_name: userInfo.display_name,
        }}
        initialView='models'
        onClose={props.onClose}
      />
    )
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) props.onClose()
      }}
      title={t('User Information')}
      description={t(
        'View detailed information about this user including balance, usage statistics, and invitation details.'
      )}
      contentClassName='sm:max-w-lg'
      contentHeight='auto'
      bodyClassName='space-y-4'
    >
      {query.isPending ? (
        <div className='flex items-center justify-center py-8'>
          <Loader2 className='text-muted-foreground size-6 animate-spin' />
        </div>
      ) : userInfo && !query.isError ? (
        <div className='space-y-4 py-4'>
          <Button
            variant='outline'
            className='w-full'
            onClick={() => setShowUsage(true)}
          >
            {t('View model and channel consumption')}
          </Button>
          {/* Basic Info */}
          <div className='grid grid-cols-2 gap-4'>
            <InfoItem label={t('Username')} value={userInfo.username} />
            {userInfo.display_name && (
              <InfoItem
                label={t('Display Name')}
                value={userInfo.display_name}
              />
            )}
          </div>

          {/* Balance Info */}
          <div className='grid grid-cols-2 gap-4'>
            <InfoItem
              label={t('Balance')}
              value={formatQuota(userInfo.quota)}
            />
            <InfoItem
              label={t('Used Quota')}
              value={formatQuota(userInfo.used_quota)}
            />
          </div>

          {/* Statistics */}
          <div className='grid grid-cols-2 gap-4'>
            <InfoItem
              label={t('Request Count')}
              value={formatCompactNumber(userInfo.request_count)}
            />
            {userInfo.group && (
              <InfoItem label={t('User Group')} value={userInfo.group} />
            )}
          </div>

          {/* Invitation Info */}
          {(userInfo.aff_code ||
            userInfo.aff_count !== undefined ||
            (userInfo.aff_quota !== undefined && userInfo.aff_quota > 0)) && (
            <>
              <div className='grid grid-cols-2 gap-4'>
                {userInfo.aff_code && (
                  <InfoItem
                    label={t('Invitation Code')}
                    value={userInfo.aff_code}
                  />
                )}
                {userInfo.aff_count !== undefined && (
                  <InfoItem
                    label={t('Invited Users')}
                    value={formatCompactNumber(userInfo.aff_count)}
                  />
                )}
              </div>

              {userInfo.aff_quota !== undefined && userInfo.aff_quota > 0 && (
                <InfoItem
                  label={t('Invitation Quota')}
                  value={formatQuota(userInfo.aff_quota)}
                />
              )}
            </>
          )}

          {/* Remark */}
          {userInfo.remark && (
            <div className='space-y-1.5'>
              <Label className='text-muted-foreground text-xs'>
                {t('Remark')}
              </Label>
              <div className='text-sm leading-relaxed font-semibold break-words'>
                {userInfo.remark}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className='text-muted-foreground py-8 text-center text-sm'>
          {t('Failed to fetch user information')}
          <Button
            variant='outline'
            className='ml-3'
            onClick={() => {
              void query.refetch()
            }}
          >
            {t('Retry')}
          </Button>
        </div>
      )}
    </Dialog>
  )
}
