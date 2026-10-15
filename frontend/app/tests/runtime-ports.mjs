import assert from 'node:assert/strict'
import test from 'node:test'
import { loadConfigFromFile } from 'vite'

test('Vite proxies use the selected backend port and honor an explicit URL', async () => {
  const originalUrl = process.env.BACKEND_URL
  const originalPort = process.env.BACKEND_PORT
  try {
    delete process.env.BACKEND_URL
    process.env.BACKEND_PORT = '9384'
    await assertProxyTargets('http://127.0.0.1:9384')

    process.env.BACKEND_URL = 'http://127.0.0.1:9484'
    await assertProxyTargets('http://127.0.0.1:9484')
  } finally {
    if (originalUrl === undefined) delete process.env.BACKEND_URL
    else process.env.BACKEND_URL = originalUrl
    if (originalPort === undefined) delete process.env.BACKEND_PORT
    else process.env.BACKEND_PORT = originalPort
  }
})

async function assertProxyTargets(expected) {
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, 'vite.config.ts')
  assert.ok(loaded)
  for (const proxy of [loaded.config.server.proxy, loaded.config.preview.proxy]) {
    for (const route of ['/api', '/mcp', '/oauth', '/.well-known']) {
      const target = proxy[route]
      assert.equal(typeof target === 'string' ? target : target.target, expected, route)
    }
  }
}
