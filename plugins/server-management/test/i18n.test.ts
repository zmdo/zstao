import assert from 'node:assert/strict'
import { IncomingMessage, ServerResponse } from 'node:http'
import { Socket } from 'node:net'
import test from 'node:test'
import { ERROR_CODES, ServerError } from '../src/shared/errors.ts'
import {
  componentText,
  enumLabel,
  errorPayload,
  errorText,
  format,
  formatDate,
  serverCopy,
  statusReason,
} from '../src/shared/i18n.ts'
import { pageLabel } from '../src/client/shared/page-label.ts'
import { displayError, displayJobError } from '../src/shared/i18n.ts'
import { responseError } from '../src/client/shared/api.ts'
import { routeGroups } from '../src/host/http/groups.ts'
import { routeKeys } from '../src/host/http/keys.ts'
import { routeServers } from '../src/host/http/servers.ts'
import { HttpError } from '../src/host/errors.ts'
import { type Db } from '../src/host/database/connection.ts'
import {DefinitionRegistry} from '../src/host/definitions/registry.ts'
import { Enrollment } from '../src/host/servers/enrollment.ts'
import { builtinCatalog } from './fixtures.ts'

test('Chinese and English cover the same messages and placeholders', () => {
  function compare(left: object, right: object): void {
    assert.deepEqual(Object.keys(left).sort(), Object.keys(right).sort())
    for (const [key, value] of Object.entries(left)) {
      const other = right[key as keyof typeof right]
      if (typeof value === 'string') {
        assert.equal(typeof other, 'string')
        const params = (text: string) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort()
        assert.deepEqual(params(value), params(String(other)), key)
      } else compare(value, other)
    }
  }
  compare(serverCopy('zh'), serverCopy('en'))
  assert.equal(serverCopy('fr'), serverCopy('en'))
  assert.deepEqual([...ERROR_CODES].sort(), Object.keys(serverCopy('en').errors).sort())
  const error = new ServerError('ssh_auth_failed')
  assert.equal(error.message, 'ssh_auth_failed')
  assert.equal(errorPayload(error).detail, errorText('zh', error.code))
})

test('an existing error and dynamic navigation labels follow the active language', () => {
  const error = responseError({ code: 'group_exists', detail: 'Ignore this legacy detail', params: {} })
  let active = 'zh'
  const label = pageLabel(() => serverCopy(active).ui.serversTab, {
    group: 'server-management',
    groupLabel: () => serverCopy(active).ui.groupTitle,
    navigation: 'sidebar',
  })
  assert.equal(displayError(active, error), '分组名已存在')
  assert.equal(label(), '服务器实例')
  assert.equal(label.navigation, 'sidebar')
  assert.equal(serverCopy(active).ui.keysTab, '服务器密钥')
  assert.equal(typeof label.groupLabel === 'function' ? label.groupLabel() : label.groupLabel, '服务器管理')
  active = 'en'
  assert.equal(displayError(active, error), 'A group with this name already exists.')
  assert.equal(label(), 'Server instances')
  assert.equal(serverCopy(active).ui.keysTab, 'Server keys')
  assert.equal(typeof label.groupLabel === 'function' ? label.groupLabel() : label.groupLabel, 'Server management')
})

test('error codes do not rely on Chinese detail and malformed payloads fall back safely', () => {
  const error = responseError({
    code: 'component_dependency',
    params: { component: 'compose', dependency: 'docker', unexpected: {} },
  })
  assert.equal(displayError('en', error), 'Select Docker Compose and its dependency Docker Engine.')
  assert.equal('unexpected' in error.params, false)
  assert.equal(responseError(null).code, 'request_failed')
  assert.equal(responseError({ code: 'constructor' }).code, 'request_failed')
  assert.equal(responseError({ code: 'group_exists', params: ['bad'] }).code, 'group_exists')
  assert.match(displayError('en', responseError({ detail: 'remote output' })), /remote output/)
  assert.equal(errorPayload(new HttpError(404, 'server_not_found')).code, 'server_not_found')
})

test('remote job errors remain visible and structured job failures still follow the current language', () => {
  const error = 'recipe_failed: Running software differs from the installed package\n'
  assert.equal(displayJobError('zh', error), error)
  assert.equal(displayJobError('en', error), error)
  const structured = errorPayload(new ServerError('ssh_auth_failed'))
  assert.equal(displayJobError('zh', structured), 'SSH 认证失败，请检查用户名、私钥或口令。')
  assert.equal(displayJobError('en', structured), 'SSH authentication failed. Check the username, private key or password.')
})

test('dates use the platform locale and external names and output remain intact', () => {
  const date = '2026-10-19T05:06:07.000Z'
  assert.equal(formatDate(date, 'en'), new Date(date).toLocaleString('en-US'))
  assert.equal(formatDate(date, 'zh'), new Date(date).toLocaleString('zh-CN'))
  assert.equal(formatDate('invalid', 'en'), '—')
  assert.equal(formatDate(null, 'zh'), '—')
  assert.equal(format(serverCopy('en').ui.range, { count: 23, from: 11, to: 20 }), 'Showing 11–20 of 23')
  assert.equal(enumLabel(serverCopy('zh').jobStatus, 'custom state'), 'custom state')
  const component = { id: 'custom', name: '自定义软件', summary: 'Original description' }
  assert.equal(componentText('en', component), component)
  assert.equal(errorText('en', 'ssh_failed', { detail: '原始输出' }), 'Unable to connect to SSH. 原始输出')
  assert.equal(statusReason('zh', { code: 'software_missing', parameters: { software: 'builtin/docker-engine' } }), '必要软件 builtin/docker-engine 尚未安装。')
  assert.equal(statusReason('en', { code: 'software_missing', parameters: { software: 'builtin/docker-engine' } }), 'Required software builtin/docker-engine is missing.')
})

const noDb: Db = {
  async query() {
    throw new Error('Validation must finish before accessing the database')
  },
  async connect() {
    throw new Error('Validation must finish before accessing the database')
  },
}

async function invalidPost(
  body: object,
  route: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  code: string,
): Promise<void> {
  const socket = new Socket()
  const request = new IncomingMessage(socket)
  request.method = 'POST'
  request.push(JSON.stringify(body))
  request.push(null)
  const response = new ServerResponse(request)
  try {
    await assert.rejects(route(request, response), (cause) => cause instanceof ServerError && cause.code === code)
  } finally {
    request.destroy()
    response.destroy()
    socket.destroy()
  }
}

test('server and key validation return stable codes without attempting a write', async () => {
  const deps = {
    db: noDb,
    catalog: builtinCatalog(),
    definitions: new DefinitionRegistry(noDb, builtinCatalog()),
    secrets: { encrypt: (value: string) => value, decrypt: (value: string) => value },
    enrollment: new Enrollment({
      db: noDb,
      definitions: new DefinitionRegistry(noDb, builtinCatalog()),
      secrets: { encrypt: (v) => v, decrypt: (v) => v },
    }),
  }
  await invalidPost({}, (request, response) => routeServers(deps, request, response, ''), 'name_required')
  await invalidPost(
    { name: 'demo', host: '127.0.0.1', ssh_port: 70000 },
    (request, response) => routeServers(deps, request, response, ''),
    'port_invalid',
  )
  await invalidPost(
    { name: 'key', secret: 'invalid PEM' },
    (request, response) => routeKeys(deps, request, response, ''),
    'key_invalid',
  )
})

test('virtual group names are reserved in both supported languages', async () => {
  const definitions = new DefinitionRegistry(noDb, builtinCatalog())
  for (const name of ['未分组', '全部服务器', 'Ungrouped', 'ALL SERVERS']) {
    await invalidPost(
      { name },
      (request, response) => routeGroups(noDb, request, response, '', definitions),
      'group_name_reserved',
    )
  }
})
