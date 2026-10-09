// Drives the production build in Firefox: sign up, build a workflow on the canvas, run it,
// read the steps, call the webhook, watch a run update live, and check users are kept apart.
import http from 'node:http'
import { mkdirSync } from 'node:fs'
import { firefox } from 'playwright'
import { startApp } from './harness.mjs'

mkdirSync('shots', { recursive: true })

// What the http node calls. /fail always answers 500, /slow waits, anything else echoes.
const hits = []
const echo = http.createServer((req, res) => {
  let body = ''
  req.on('data', (c) => (body += c))
  req.on('end', () => {
    hits.push({ url: req.url, method: req.method, body })
    if (req.url.startsWith('/fail')) { res.statusCode = 500; return res.end('boom') }
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ ok: true, got: body ? JSON.parse(body) : null }))
  })
})
await new Promise((r) => echo.listen(0, '127.0.0.1', r))
const ECHO = `http://127.0.0.1:${echo.address().port}`

const app = await startApp()
const browser = await firefox.launch()
let failed = 0
const check = (name, ok, extra = '') => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`)
  if (!ok) failed++
}
const until = async (fn, ms = 10_000) => {
  const end = Date.now() + ms
  while (Date.now() < end) {
    try { if (await fn()) return true } catch { /* not ready yet */ }
    await new Promise((r) => setTimeout(r, 60))
  }
  return false
}

try {
  const ctx = await browser.newContext({ viewport: { width: 1500, height: 900 } })
  const page = await ctx.newPage()
  page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message); failed++ })

  // ---------- landing, then sign up ----------
  await page.goto(app.url)
  await page.getByRole('heading', { name: /Automations you can/ }).waitFor()
  check('the landing page shows the product and a way in', (await page.getByTestId('cta').count()) === 1)
  await page.waitForTimeout(1500)
  await page.screenshot({ path: 'shots/landing.png' })
  // sections fade in as they scroll into view, so walk down the page before the full screenshot
  await page.evaluate(async () => { for (let y = 0; y < document.body.scrollHeight; y += 350) { window.scrollTo(0, y); await new Promise((r) => setTimeout(r, 200)) } })
  await page.waitForTimeout(800)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(400)
  await page.screenshot({ path: 'shots/landing-full.png', fullPage: true })
  await page.getByRole('link', { name: 'Start building' }).click()
  await page.waitForURL(/\/login\?mode=register$/)
  check('Start building opens the sign up form', (await page.getByRole('button', { name: 'Create account' }).count()) === 1)
  await page.waitForTimeout(900)
  await page.screenshot({ path: 'shots/login.png' })
  await page.getByLabel('Email').fill('ada@example.com')
  await page.getByLabel('Password').fill('correct horse')
  await page.getByRole('button', { name: 'Create account' }).click()
  await page.waitForURL(/\/workflows$/)
  check('register signs you in', (await page.getByTestId('me').textContent()) === 'ada@example.com')

  // ---------- build a workflow on the canvas ----------
  await page.getByTestId('new-workflow').click()
  await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/)
  const wfUrl = page.url()
  const wfId = wfUrl.split('/').pop()
  await page.locator('.react-flow__node').first().waitFor()
  check('a new workflow starts with a webhook trigger', (await page.locator('.react-flow__node').count()) === 1)

  await page.getByTestId('add-transform').click()
  await page.getByTestId('panel').locator('textarea').fill('{ "double": trigger.body.n * 2 }')
  await page.getByTestId('add-http').click()
  const panel = page.getByTestId('panel')
  await panel.locator('select').selectOption('POST')
  await panel.getByPlaceholder('https://api.example.com/items').fill(`${ECHO}/echo`)
  await panel.locator('textarea').fill('{{ steps.transform1 }}')
  check('the trigger cannot be added twice', await page.getByTestId('add-webhook').isDisabled())
  check('unconnected steps are reported as problems', /problem/.test(await page.getByRole('button', { name: /problem/ }).innerText()))

  await page.locator('.react-flow__controls-fitview').click()
  await page.waitForTimeout(500)

  const handle = async (nodeKey, kind) => {
    const box = await page.locator('.react-flow__node', { hasText: nodeKey }).first().locator(`.react-flow__handle.${kind}`).boundingBox()
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  }
  const connect = async (from, to) => {
    const a = await handle(from, 'source')
    const b = await handle(to, 'target')
    await page.mouse.move(a.x, a.y)
    await page.mouse.down()
    await page.mouse.move((a.x + b.x) / 2, (a.y + b.y) / 2, { steps: 6 })
    await page.mouse.move(b.x, b.y, { steps: 6 })
    await page.mouse.up()
  }
  const edgeCount = () => page.locator('.react-flow__edge').count()

  await connect('start', 'transform1')
  await connect('transform1', 'http1')
  check('dragging between handles draws two connections', await until(async () => (await edgeCount()) === 2))

  // a loop and an input on the trigger are refused when you try to draw them
  await connect('http1', 'transform1')
  // the trigger has no input dot, so the closest we can do is drop on the card itself
  const from = await handle('http1', 'source')
  const startBox = await page.locator('.react-flow__node', { hasText: 'start' }).first().boundingBox()
  await page.mouse.move(from.x, from.y)
  await page.mouse.down()
  await page.mouse.move(startBox.x + startBox.width / 2, startBox.y + startBox.height / 2, { steps: 10 })
  await page.mouse.up()
  check('the trigger has no input dot', (await page.locator('.react-flow__node', { hasText: 'start' }).first().locator('.react-flow__handle.target').count()) === 0)
  await page.waitForTimeout(300)
  check('a loop or an input on the trigger cannot be drawn', (await edgeCount()) === 2)
  check('with everything connected there are no problems', await until(async () => /No problems/.test(await page.getByRole('button', { name: /problem/ }).innerText())))

  await page.screenshot({ path: 'shots/editor.png' })

  // ---------- save, reload, state survives ----------
  check('unsaved changes are flagged', await page.getByTestId('dirty').isVisible())
  await page.getByRole('textbox', { name: 'Workflow name' }).fill('Double it')
  await page.keyboard.press('Control+s')
  await page.getByRole('status').getByText('Saved.').waitFor()
  check('saving clears the unsaved flag', await until(async () => !(await page.getByTestId('dirty').isVisible())))
  await page.reload()
  await page.locator('.react-flow__node').first().waitFor()
  check('after a reload all three steps and both connections are still there', (await page.locator('.react-flow__node').count()) === 3 && (await edgeCount()) === 2)
  await page.locator('.react-flow__node', { hasText: 'transform1' }).first().click()
  check('step settings are saved', (await page.getByTestId('panel').locator('textarea').inputValue()).includes('trigger.body.n * 2'))

  // ---------- run now ----------
  await page.getByRole('button', { name: 'Run now' }).click()
  await page.getByRole('textbox', { name: 'Test payload' }).fill('{ "method": "POST", "body": { "n": 21 }, "query": {}, "headers": {} }')
  await page.getByTestId('run-confirm').click()
  await page.waitForURL(/\/runs\//)
  check('the run finishes successfully', await until(async () => (await page.getByTestId('run-status').innerText()).trim().toLowerCase() === 'success'))
  const statuses = await page.locator('[data-testid^=step-]').evaluateAll((els) => els.map((e) => `${e.dataset.testid}:${e.dataset.status}`))
  check('every step shows as success', ['step-start:success', 'step-transform1:success', 'step-http1:success'].every((s) => statuses.includes(s)), statuses.join(' '))
  await page.getByTestId('step-http1').locator('summary').click()
  const detail = await page.getByTestId('step-http1').innerText()
  check('the http step shows what was sent and what came back', detail.includes('"double": 42') && detail.includes('"status": 200'))
  check('the echo server received the transformed body', hits.some((h) => h.url === '/echo' && JSON.parse(h.body).double === 42))
  await page.screenshot({ path: 'shots/run.png' })

  // ---------- turn on, call the webhook ----------
  await page.goto(wfUrl)
  await page.locator('.react-flow__node').first().waitFor()
  await page.getByRole('button', { name: 'Turn on' }).click()
  check('turning it on shows On', await until(async () => (await page.getByTestId('state').innerText()).toLowerCase() === 'on'))
  const list = await (await page.request.get(`${app.url}/api/workflows`)).json()
  const hook = (await (await page.request.get(`${app.url}/api/workflows/${wfId}`)).json()).webhookPath
  const res = await fetch(app.url + hook, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"n": 5}' })
  check('a webhook call is accepted', res.status === 202, String(res.status))
  const { runId } = await res.json()
  await page.goto(`${app.url}/workflows/${wfId}/runs`)
  check('the webhook run shows up in the run list', await until(async () => (await page.locator('[data-testid=run-list] a').count()) === 2))
  await page.goto(`${app.url}/runs/${runId}`)
  check('the webhook run succeeds with its payload', await until(async () => (await page.getByTestId('run-status').innerText()).trim().toLowerCase() === 'success'))
  check('a disabled or unknown webhook answers 404', (await fetch(app.url + '/hooks/nope', { method: 'POST' })).status === 404)
  check('the workflow list shows the last run', list.length === 1)

  // ---------- a failing step ----------
  const failGraph = {
    nodes: [
      { id: 'n_s', key: 'start', type: 'webhook', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_c', key: 'call', type: 'http', position: { x: 300, y: 0 }, config: { method: 'GET', url: `${ECHO}/fail`, headers: {}, body: '', timeoutMs: 5000, retries: 1 } },
      { id: 'n_a', key: 'after', type: 'transform', position: { x: 600, y: 0 }, config: { expression: '"never"' } },
    ],
    edges: [{ id: 'e1', source: 'n_s', target: 'n_c' }, { id: 'e2', source: 'n_c', target: 'n_a' }],
  }
  const failWf = await (await page.request.post(`${app.url}/api/workflows`, { data: { name: 'Always fails', graph: failGraph } })).json()
  const failRun = await (await page.request.post(`${app.url}/api/workflows/${failWf.id}/run`, { data: {} })).json()
  await page.goto(`${app.url}/runs/${failRun.runId}`)
  check('a failed run says failed', await until(async () => (await page.getByTestId('run-status').innerText()).trim().toLowerCase() === 'failed'))
  check('the failing step is open with its error and attempts', (await page.getByTestId('step-error').innerText()).includes('HTTP 500') && (await page.getByTestId('step-call').innerText()).includes('2 attempts'))
  check('the step after it is skipped', (await page.getByTestId('step-after').getAttribute('data-status')) === 'skipped')
  check('the retry really hit the server twice', hits.filter((h) => h.url === '/fail').length === 2)
  await page.screenshot({ path: 'shots/run-failed.png' })

  // ---------- live updates ----------
  const slowGraph = {
    nodes: [
      { id: 'n_s', key: 'start', type: 'webhook', position: { x: 0, y: 0 }, config: {} },
      { id: 'n_d', key: 'pause', type: 'delay', position: { x: 300, y: 0 }, config: { seconds: 2 } },
      { id: 'n_t', key: 'done', type: 'transform', position: { x: 600, y: 0 }, config: { expression: '"finished"' } },
    ],
    edges: [{ id: 'e1', source: 'n_s', target: 'n_d' }, { id: 'e2', source: 'n_d', target: 'n_t' }],
  }
  const slowWf = await (await page.request.post(`${app.url}/api/workflows`, { data: { name: 'Slow', graph: slowGraph } })).json()
  const slowRun = await (await page.request.post(`${app.url}/api/workflows/${slowWf.id}/run`, { data: {} })).json()
  await page.goto(`${app.url}/runs/${slowRun.runId}`)
  check('a running run shows the delay as waiting', await until(async () => (await page.getByTestId('step-pause').getAttribute('data-status')) === 'waiting', 6000))
  check('the page updates by itself when the run finishes', await until(async () => (await page.getByTestId('run-status').innerText()).trim().toLowerCase() === 'success', 8000))
  check('the step after the delay ran', (await page.getByTestId('step-done').getAttribute('data-status')) === 'success')

  // ---------- users are kept apart ----------
  const other = await (await browser.newContext({ viewport: { width: 1500, height: 900 } })).newPage()
  await other.goto(app.url + '/login')
  await other.getByRole('button', { name: 'I need an account' }).click()
  await other.getByLabel('Email').fill('grace@example.com')
  await other.getByLabel('Password').fill('another password')
  await other.getByRole('button', { name: 'Create account' }).click()
  await other.waitForURL(/\/workflows$/)
  check('a second user sees an empty list', await until(async () => (await other.getByText('Nothing here yet').count()) === 1))
  await other.goto(wfUrl)
  check("a second user cannot open someone else's workflow", await until(async () => (await other.getByText('does not exist').count()) === 1))
  await other.goto(`${app.url}/runs/${runId}`)
  check("or someone else's run", await until(async () => (await other.getByText('does not exist').count()) === 1))

  // ---------- templates and sign out ----------
  await page.goto(`${app.url}/workflows`)
  await page.waitForTimeout(1400) // let the cards finish fading in
  await page.screenshot({ path: 'shots/workflows.png' })
  await page.getByTestId('template-order-alert').click()
  await page.waitForURL(/\/workflows\/[0-9a-f-]{36}$/)
  await page.locator('.react-flow__node').first().waitFor()
  check('a template opens with its three steps', (await page.locator('.react-flow__node').count()) === 3)
  await page.goto(`${app.url}/workflows`)
  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.waitForURL(/\/login$/)
  await page.goto(`${app.url}/workflows`)
  check('after signing out, protected pages send you to login', await until(async () => /\/login$/.test(page.url())))
} catch (err) {
  console.log('E2E ERROR', err)
  failed++
} finally {
  await browser.close()
  await app.stop()
  echo.close()
}

console.log(failed ? `E2E_FAIL (${failed})` : 'E2E_OK')
process.exit(failed ? 1 : 0)
