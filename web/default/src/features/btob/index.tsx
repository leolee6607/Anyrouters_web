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
import { useTranslation } from 'react-i18next'
import { SectionPageLayout } from '@/components/layout'
import { B2BCustomersPanel } from './components/customers-panel'

// Group-centric layout: the page is organized as one card per B2B group — the
// overall default tier (btob) first, then per-customer dedicated groups, then
// shared tiers. Each card carries the group's display name, per-vendor discount
// summary, an "edit discount" entry, and its customers. Pricing is edited in a
// right-side drawer (see customers-panel).
export function BtoB() {
  const { t } = useTranslation()

  return (
    <SectionPageLayout>
      <SectionPageLayout.Title>{t('B2B Customers')}</SectionPageLayout.Title>
      <SectionPageLayout.Content>
        <B2BCustomersPanel />
      </SectionPageLayout.Content>
    </SectionPageLayout>
  )
}
