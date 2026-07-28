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
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useAuthStore } from '@/stores/auth-store'
import { ROLE } from '@/lib/roles'
import { getAdminUnreadCount, getSelfUnreadCount } from './api'

const POLL_INTERVAL_MS = 30_000

type TicketUnreadValue = {
  userUnread: number
  adminUnread: number
  refresh: () => Promise<void>
}

const TicketUnreadContext = createContext<TicketUnreadValue>({
  userUnread: 0,
  adminUnread: 0,
  refresh: async () => {},
})

export function TicketUnreadProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation()
  const user = useAuthStore((state) => state.auth.user)
  const isAdmin = (user?.role ?? 0) >= ROLE.ADMIN
  const [userUnread, setUserUnread] = useState(0)
  const [adminUnread, setAdminUnread] = useState(0)
  const previousUserUnread = useRef<number | null>(null)
  const previousAdminUnread = useRef<number | null>(null)
  const refreshInFlight = useRef(false)

  const refresh = useCallback(async () => {
    if (!user || refreshInFlight.current) return
    refreshInFlight.current = true

    try {
      const [nextUserUnread, nextAdminUnread] = await Promise.all([
        getSelfUnreadCount().catch(() => previousUserUnread.current ?? 0),
        isAdmin
          ? getAdminUnreadCount().catch(() => previousAdminUnread.current ?? 0)
          : Promise.resolve(0),
      ])

      if (
        nextUserUnread > 0 &&
        (previousUserUnread.current === null ||
          nextUserUnread > previousUserUnread.current)
      ) {
        toast.info(
          t('You have {{count}} unread support ticket replies.', {
            count: nextUserUnread,
          })
        )
      }
      if (
        nextAdminUnread > 0 &&
        (previousAdminUnread.current === null ||
          nextAdminUnread > previousAdminUnread.current)
      ) {
        toast.warning(
          t('There are {{count}} unread support tickets waiting for staff.', {
            count: nextAdminUnread,
          }),
          { duration: 8000 }
        )
      }

      previousUserUnread.current = nextUserUnread
      previousAdminUnread.current = nextAdminUnread
      setUserUnread(nextUserUnread)
      setAdminUnread(nextAdminUnread)
    } finally {
      refreshInFlight.current = false
    }
  }, [isAdmin, t, user])

  useEffect(() => {
    if (!user) {
      previousUserUnread.current = null
      previousAdminUnread.current = null
      return
    }

    void refresh()
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void refresh()
    }, POLL_INTERVAL_MS)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    window.addEventListener('focus', onVisible)
    document.addEventListener('visibilitychange', onVisible)

    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', onVisible)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, user])

  const visibleUserUnread = user ? userUnread : 0
  const visibleAdminUnread = user && isAdmin ? adminUnread : 0

  return (
    <TicketUnreadContext.Provider
      value={{
        userUnread: visibleUserUnread,
        adminUnread: visibleAdminUnread,
        refresh,
      }}
    >
      {children}
    </TicketUnreadContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTicketUnread() {
  return useContext(TicketUnreadContext)
}
