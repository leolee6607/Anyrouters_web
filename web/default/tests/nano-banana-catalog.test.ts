import { describe, expect, test } from 'bun:test'
import { getDynamicDisplayGroupRatio, getDynamicGroupRatio } from '../src/features/pricing/lib/dynamic-price'
import { inferModelMetadata, inferApiInfo } from '../src/features/pricing/lib/model-metadata'
import type { PricingModel } from '../src/features/pricing/types'
const model: PricingModel = { id: 1, model_name: 'gemini-nano-banana-2.1', quota_type: 0, model_ratio: .75, completion_ratio: 5, enable_groups: ['default', 'btob'], group_ratio: { default: 1, btob: 2 }, group_model_ratio: .4, group_model_ratios: { default: .5, btob: .4 } }
describe('Nano Banana catalog', () => {
  test('pairs each group with its own model override', () => {
    expect(getDynamicGroupRatio(model, 'default')).toBe(.5)
    expect(getDynamicGroupRatio(model, 'btob')).toBe(.8)
    expect(getDynamicDisplayGroupRatio(model)).toBe(.5)
  })
  test('uses verified model metadata instead of seeded placeholders', () => {
    const meta = inferModelMetadata(model)
    expect(meta.context_length).toBe(131072)
    expect(meta.max_output_tokens).toBe(32768)
    expect(meta.release_date).toBe('2026-10-06')
    expect(meta.output_modalities).toContain('image')
    expect(meta.capabilities).not.toContain('function_calling')
    expect(meta.knowledge_cutoff).toBe('')
    expect(inferApiInfo(model).data_retention_days).toBeNull()
  })
})
