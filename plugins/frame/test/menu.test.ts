import assert from 'node:assert/strict'
import test from 'node:test'
import { createGroup, deleteGroup, loadMenu, menuChoices, menuDraft, menuList, moveGroup, moveItem, renameGroup, saveMenu, sidebarBlocks, untitledName } from '../src/menu.ts'
import type { NavGroup } from '../src/pages.ts'

const platform: NavGroup = {
  id: 'platform',
  label: '平台设置',
  placement: 'footer',
  order: 0,
  icon: 'settings',
  pages: [],
}

const markets: NavGroup = {
  id: 'markets',
  label: '行情',
  placement: 'nav',
  order: 30,
  icon: '',
  pages: [],
}

test('platform settings is not a menu row and harness starts under overview', () => {
  const options = menuChoices({ nav: [markets], footer: [platform] }, 'Harness')
  assert.deepEqual(options.map(item => item.id), ['conversation', 'markets'])
  const blocks = sidebarBlocks(options, { groups: [], items: [] }, '概览')
  assert.deepEqual(blocks.map(block => [block.title, block.items.map(item => item.id)]), [
    ['概览', ['conversation']],
    ['', ['markets']],
  ])
})

test('items stay in the saved group order and an empty group is omitted from the sidebar', () => {
  const options = menuChoices({ nav: [markets] }, 'Harness')
  const layout = {
    groups: [
      { id: 'work', title: '工作台', sort: 0 },
      { id: 'empty', title: '空组', sort: 1 },
    ],
    items: [
      { id: 'markets', groupId: 'work', sort: 0 },
      { id: 'conversation', groupId: 'work', sort: 1 },
    ],
  }
  assert.deepEqual(sidebarBlocks(options, layout, '概览').map(block => [block.title, block.items.map(item => item.id)]), [
    ['工作台', ['markets', 'conversation']],
  ])
  assert.deepEqual(menuList(options, layout, '概览').groups.map(group => group.title), ['工作台', '空组'])
})

test('a group can be created, and deleting it returns its items', () => {
  const layout = { groups: [{ id: 'overview', title: '概览', sort: 0 }], items: [{ id: 'conversation', groupId: 'overview', sort: 0 }] }
  const created = createGroup(layout, ' 工作台 ', 'work')
  assert.equal('groups' in created && created.groups[1]?.title, '工作台')
  assert.equal('ok' in createGroup(layout, '概览', 'again'), true)
  assert.equal('ok' in createGroup(layout, '', 'blank'), true)
  const removed = deleteGroup(layout, 'overview')
  assert.deepEqual(removed.groups, [])
  assert.deepEqual(removed.items, [{ id: 'conversation', groupId: '', sort: 0 }])
})

test('a new group takes the first free untitled number and can be renamed', () => {
  assert.equal(untitledName(['概览', '未命名分组1'], '未命名分组'), '未命名分组2')
  assert.equal(untitledName(['未命名分组2'], '未命名分组'), '未命名分组1')
  const layout = { groups: [{ id: 'one', title: '未命名分组1', sort: 0 }], items: [] }
  const renamed = renameGroup(layout, 'one', ' 工作台 ')
  assert.equal('groups' in renamed && renamed.groups[0]?.title, '工作台')
  assert.equal('ok' in renameGroup(layout, 'one', ''), true)
  assert.equal('ok' in renameGroup({ groups: [{ id: 'two', title: '工作台', sort: 1 }, ...layout.groups], items: [] }, 'one', '工作台'), true)
})

test('dragging a group changes only the group order', () => {
  const layout = {
    groups: [
      { id: 'overview', title: '概览', sort: 0 },
      { id: 'work', title: '工作台', sort: 1 },
    ],
    items: [{ id: 'conversation', groupId: 'overview', sort: 0 }],
  }
  const moved = moveGroup(layout, 'work', 0)
  assert.deepEqual(moved.groups.map(group => [group.id, group.sort]), [['work', 0], ['overview', 1]])
  assert.deepEqual(moved.items, layout.items)
  assert.equal(moveGroup(layout, 'missing', 0), layout)
})

test('dragging an item lands at the requested index', () => {
  const options = menuChoices({ nav: [markets] }, 'Harness')
  const layout = {
    groups: [{ id: 'overview', title: '概览', sort: 0 }],
    items: [
      { id: 'conversation', groupId: 'overview', sort: 0 },
      { id: 'markets', groupId: '', sort: 0 },
    ],
  }
  const moved = moveItem(layout, options, 'markets', 'overview', 0)
  assert.deepEqual(
    moved.items.filter(item => item.groupId === 'overview').sort((left, right) => left.sort - right.sort).map(item => item.id),
    ['markets', 'conversation'],
  )
  const down = moveItem(moved, options, 'markets', 'overview', 2)
  assert.deepEqual(
    down.items.filter(item => item.groupId === 'overview').sort((left, right) => left.sort - right.sort).map(item => item.id),
    ['conversation', 'markets'],
  )
})

test('a group title longer than 40 characters is refused', () => {
  const layout = { groups: [{ id: 'overview', title: '概览', sort: 0 }], items: [] }
  assert.equal(menuDraft(layout).ok, true)
  assert.equal(menuDraft({ groups: [{ id: 'overview', title: 'x'.repeat(41), sort: 0 }], items: [] }).ok, false)
  assert.equal(menuDraft({ groups: [], items: [{ id: 'conversation', groupId: 'missing', sort: 0 }] }).ok, false)
  assert.equal(menuDraft({}).ok, false)
})

test('menu groups and rows are replaced together', async () => {
  let groups: { id: string; title: string; sort: number }[] = []
  let items: { id: string; groupId: string; sort: number }[] = []
  const db = {
    async query(sql: string, params?: unknown[]) {
      if (sql.startsWith('delete from console_menu_group')) groups = []
      else if (sql.startsWith('delete from console_menu')) items = []
      else if (sql.startsWith('select') && sql.includes('console_menu_group')) return { rows: groups }
      else if (sql.startsWith('select') && sql.includes('console_menu')) return { rows: items.map(item => ({ id: item.id, groupId: item.groupId, sort: item.sort })) }
      else if (sql.includes('console_menu_group')) {
        const ids = params?.[0] as string[]
        const titles = params?.[1] as string[]
        const sorts = params?.[2] as number[]
        groups = ids.map((id, index) => ({ id, title: titles[index] ?? '', sort: sorts[index] ?? 0 }))
      } else if (sql.includes('console_menu')) {
        const ids = params?.[0] as string[]
        const groupIds = params?.[1] as string[]
        const sorts = params?.[2] as number[]
        items = ids.map((id, index) => ({ id, groupId: groupIds[index] ?? '', sort: sorts[index] ?? 0 }))
      }
      return { rows: [] }
    },
  }
  assert.deepEqual(await loadMenu(db), { groups: [], items: [] })
  await saveMenu(db, { groups: [{ id: 'overview', title: '概览', sort: 0 }], items: [{ id: 'conversation', groupId: 'overview', sort: 0 }] })
  assert.deepEqual(await loadMenu(db), { groups: [{ id: 'overview', title: '概览', sort: 0 }], items: [{ id: 'conversation', groupId: 'overview', sort: 0 }] })
})
