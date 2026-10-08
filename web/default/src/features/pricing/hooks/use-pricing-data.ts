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
import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useStatus } from '@/hooks/use-status'
import { getPricing } from '../api'
import type { PricingModel } from '../types'

// Models the marketplace should advertise as non-purchasable "Coming soon"
// rows before their channel goes live. Now that the ChatGPT (Azure) channel is
// configured, gpt-5.5 / gpt-5.4 surface from the live /api/pricing response, so
// no client-side placeholders are needed. Add entries here only for models that
// are announced but not yet wired up.
const COMING_SOON_MODELS: PricingModel[] = []

export function usePricingData() {
  const { status } = useStatus()

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['pricing'],
    queryFn: getPricing,
    staleTime: 5 * 60 * 1000,
  })

  // Ensure rates never reach zero to prevent division errors
  const priceRate = useMemo(
    () => Math.max((status?.price as number) ?? 1, 0.001),
    [status?.price]
  )
  const usdExchangeRate = useMemo(
    () => Math.max((status?.usd_exchange_rate as number) ?? priceRate, 0.001),
    [status?.usd_exchange_rate, priceRate]
  )

  const models = useMemo(() => {
    if (!data?.data || !data?.vendors) return []

    const vendorMap = new Map(data.vendors.map((v) => [v.id, v]))
    const groupModelRatio = data.group_model_ratio ?? {}

    // Best (lowest) per-model override across the account's usable groups —
    // mirrors the best price the account actually gets by using its group.
    // 1 (no override) when none applies.
    const overrideFor = (modelName: string): number => {
      let best = 1
      for (const group of Object.keys(groupModelRatio)) {
        const r = groupModelRatio[group]?.[modelName]
        if (r != null && r > 0 && r < best) best = r
      }
      return best
    }

    const live = data.data.map((model) => {
      const vendor = model.vendor_id
        ? vendorMap.get(model.vendor_id)
        : undefined
      return {
        ...model,
        key: model.model_name,
        vendor_name: vendor?.name,
        vendor_icon: vendor?.icon,
        vendor_description: vendor?.description,
        group_ratio: data.group_ratio,
        group_model_ratio: overrideFor(model.model_name),
        group_model_ratios: Object.fromEntries(
          Object.entries(groupModelRatio).map(([group, ratios]) => [
            group,
            ratios[model.model_name] ?? 1,
          ])
        ),
      }
    })
    return [...live, ...COMING_SOON_MODELS]
  }, [data])

  return {
    models,
    vendors: data?.vendors ?? [],
    groupRatio: data?.group_ratio ?? {},
    usableGroup: data?.usable_group ?? {},
    endpointMap: data?.supported_endpoint ?? {},
    autoGroups: data?.auto_groups ?? [],
    isLoading,
    error,
    refetch,
    priceRate,
    usdExchangeRate,
  }
}
