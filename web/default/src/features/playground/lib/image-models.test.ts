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
import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  imageModelKind,
  isImageGenModel,
  resolutionsForModel,
  imageCountsForModel,
  supports4K,
} from './image-models'

test('Nano Banana 2.1 has its own official image capability set', () => {
  const model = 'gemini-nano-banana-2.1'
  assert.equal(isImageGenModel(model), true)
  assert.equal(imageModelKind(model), 'gemini')
  assert.equal(supports4K(model), true)
  assert.deepEqual(resolutionsForModel(model), ['1K', '2K', '4K'])
  assert.deepEqual(imageCountsForModel(model), [1])
  assert.deepEqual(resolutionsForModel('gemini-3.1-flash-image'), [
    '0.5K',
    '1K',
    '2K',
    '4K',
  ])
  assert.deepEqual(imageCountsForModel('gemini-3.1-flash-image'), [1, 2, 4])
  assert.equal(isImageGenModel('gemini-3.8-flash'), false)
})
