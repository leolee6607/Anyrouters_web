import { expect, test } from 'bun:test'
import { readFileSync } from 'node:fs'

const workflow = readFileSync(
  new URL('../../../.github/workflows/codex-installers.yml', import.meta.url),
  'utf8'
)
const tests = readFileSync(
  new URL('./codex-gpt56-catalog-compat.test.ts', import.meta.url),
  'utf8'
)

test('Windows CI selects every executable PowerShell regression, including GPT-6', () => {
  const pattern = workflow.match(/--test-name-pattern "([^"]+)"/)?.[1]
  expect(pattern).toBeDefined()
  const selected = new RegExp(pattern!)
  const names = Array.from(
    tests.matchAll(/powerShellTest\(\s*(['"`])([\s\S]*?)\1/g),
    (match) => match[2]
  )
  expect(names.length).toBeGreaterThanOrEqual(4)
  expect(names.some((name) => name.includes('GPT-6'))).toBe(true)
  for (const name of names) {
    expect(selected.test(name), `Windows CI would skip: ${name}`).toBe(true)
  }
})

test('Windows CI covers Windows PowerShell 5.1 and PowerShell 7', () => {
  expect(workflow).toContain('powershell.exe')
  expect(workflow).toContain('pwsh.exe')
  expect(workflow).toContain('matrix.powershell')
  expect(workflow).toContain('REQUIRE_POWERSHELL_TESTS:')
  expect(workflow).toContain('ANYROUTERS_DISPOSABLE_WINDOWS_TEST_HOST:')
})
