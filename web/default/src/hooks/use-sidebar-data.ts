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
  BookOpen,
  Box,
  Boxes,
  Briefcase,
  CreditCard,
  Key,
  LayoutDashboard,
  LifeBuoy,
  MessageSquare,
  Radio,
  ReceiptText,
  Settings,
  Ticket,
  Users,
  Wallet,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ROLE } from '@/lib/roles'
import { type SidebarData } from '@/components/layout/types'
import { useTicketUnread } from '@/features/tickets/ticket-unread-provider'

/**
 * Root navigation groups for the application sidebar.
 *
 * These are shown when the URL does not match any nested sidebar view
 * registered in `layout/lib/sidebar-view-registry.ts`.
 */
export function useSidebarData(): SidebarData {
  const { t } = useTranslation()
  const { userUnread, adminUnread } = useTicketUnread()
  const badge = (count: number) =>
    count > 99 ? '99+' : count > 0 ? String(count) : undefined

  return {
    navGroups: [
      {
        id: 'common',
        title: t('Frequently Used'),
        items: [
          {
            title: t('Wallet Top-up'),
            url: '/wallet',
            icon: Wallet,
          },
          {
            title: t('Dashboard'),
            url: '/dashboard',
            icon: LayoutDashboard,
          },
          {
            title: t('Settings'),
            url: '/profile',
            icon: Settings,
          },
          {
            // Native in-app tickets: the user is already logged in, so opening
            // and tracking a ticket carries their identity — no second login,
            // no separate help-desk domain (replaced the FreeScout/mailto link).
            title: t('Support Tickets'),
            url: '/tickets',
            icon: LifeBuoy,
            badge: badge(userUnread),
          },
        ],
      },
      {
        id: 'workspace',
        title: t('Workspace'),
        items: [
          {
            title: t('Chat'),
            url: '/playground',
            icon: MessageSquare,
          },
        ],
      },
      {
        id: 'api',
        title: t('API Configuration'),
        items: [
          {
            title: t('Model Marketplace'),
            url: '/marketplace',
            icon: Boxes,
          },
          {
            title: t('Create API Keys'),
            url: '/keys',
            icon: Key,
          },
          {
            title: t('Usage Details'),
            url: '/usage-logs/common',
            icon: ReceiptText,
          },
          {
            title: t('Documentation'),
            url: '/docs',
            icon: BookOpen,
          },
        ],
      },
      {
        id: 'admin',
        title: t('Admin'),
        items: [
          {
            title: t('Channels'),
            url: '/channels',
            icon: Radio,
          },
          {
            title: t('Models'),
            url: '/models/metadata',
            icon: Box,
          },
          {
            title: t('Users'),
            url: '/users',
            icon: Users,
          },
          {
            title: t('B2B Customers'),
            url: '/btob',
            icon: Briefcase,
          },
          {
            title: t('Redemption Codes'),
            url: '/redemption-codes',
            icon: Ticket,
          },
          {
            // Staff answer every user's ticket here (AdminAuth).
            title: t('Ticket Management'),
            url: '/admin-tickets',
            icon: LifeBuoy,
            badge: badge(adminUnread),
          },
          {
            title: t('Subscription Management'),
            url: '/subscriptions',
            icon: CreditCard,
          },
          {
            title: t('System Settings'),
            url: '/system-settings/site',
            activeUrls: ['/system-settings'],
            icon: Settings,
            // Root-only: every System Settings tab reads/writes /api/option,
            // which is RootAuth. A mere admin would only hit "permission
            // denied", so don't show it to them.
            minRole: ROLE.SUPER_ADMIN,
          },
        ],
      },
    ],
  }
}
