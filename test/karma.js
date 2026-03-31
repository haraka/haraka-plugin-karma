'use strict'

const assert = require('node:assert')
const { describe, it, beforeEach } = require('node:test')

const Address = require('address-rfc2821').Address
const fixtures = require('haraka-test-fixtures')
const constants = require('haraka-constants')

const stub = fixtures.stub.stub

function _set_up() {
  const plugin = new fixtures.plugin('karma')

  plugin.cfg = { main: {}, asn: {}, redis: {} }
  plugin.deny_hooks = { connect: true }
  plugin.tarpit_hooks = ['connect']

  const connection = fixtures.connection.createConnection({}, { notes: {} })
  connection.init_transaction()

  return { plugin, connection }
}

describe('karma_init', () => {
  it('load_karma_ini', () => {
    const plugin = new fixtures.plugin('karma')
    plugin.inherits('haraka-plugin-redis')
    plugin.load_karma_ini()
    assert.ok(plugin.cfg.asn)
    assert.ok(plugin.deny_hooks)
  })
})

describe('results_init', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('init, pre', () => {
    const r = connection.results.get('karma')
    assert.strictEqual(undefined, r)
  })

  it('init, empty cfg', () => {
    plugin.results_init(stub, connection)
    const r = connection.results.get('karma')
    assert.ok(r)
  })

  it('init, cfg', () => {
    plugin.cfg.awards = { test: 1 }
    plugin.results_init(stub, connection)
    const r = connection.results.get('karma')
    assert.ok(r)
    assert.ok(r.todo)
  })

  it('init, skip', () => {
    connection.remote.is_private = true
    plugin.results_init(stub, connection)
    const r = connection.results.get('karma')
    assert.strictEqual(undefined, r)
  })

  it('init, private skip', () => {
    connection.notes.disable_karma = true
    plugin.results_init(stub, connection)
    const r = connection.results.get('karma')
    assert.strictEqual(undefined, r)
  })
})

describe('assemble_note_obj', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('no auth fails', () => {
    const obj = plugin.assemble_note_obj(connection, 'notes.auth_fails')
    assert.strictEqual(undefined, obj)
  })

  it('has auth fails', () => {
    connection.notes.auth_fails = [1, 2]
    const obj = plugin.assemble_note_obj(connection, 'notes.auth_fails')
    assert.deepStrictEqual([1, 2], obj)
  })
})

describe('hook_deny', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('no params', (t, done) => {
    const next = (rc) => {
      assert.strictEqual(constants.OK, rc, rc)
      done()
    }
    plugin.hook_deny(next, connection, ['', '', '', ''])
  })

  it('pi_name=karma', (t, done) => {
    const next = (rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }
    plugin.hook_deny(next, connection, ['', '', 'karma', ''])
  })

  it('pi_name=access', (t, done) => {
    const next = (rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }
    plugin.deny_exclude_plugins = { access: true }
    plugin.hook_deny(next, connection, ['', '', 'access', ''])
  })

  it('pi_hook=rcpt_to', (t, done) => {
    const next = (rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }
    plugin.deny_exclude_hooks = { rcpt_to: true }
    plugin.hook_deny(next, connection, ['', '', '', '', '', 'rcpt_to'])
  })

  it('pi_hook=queue', (t, done) => {
    const next = (rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }
    plugin.deny_exclude_hooks = { queue: true }
    plugin.hook_deny(next, connection, ['', '', '', '', '', 'queue'])
  })

  it('denysoft', (t, done) => {
    const next = (rc) => {
      assert.strictEqual(constants.OK, rc)
      done()
    }
    plugin.hook_deny(next, connection, [constants.DENYSOFT, '', '', '', '', ''])
  })
})

describe('get_award_location', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('relaying=false', () => {
    connection.relaying = false
    const r = plugin.get_award_location(connection, 'relaying')
    assert.strictEqual(false, r)
  })

  it('relaying=true', () => {
    connection.relaying = true
    const r = plugin.get_award_location(connection, 'relaying')
    assert.strictEqual(true, r)
  })

  it('notes.undef=2', () => {
    const r = plugin.get_award_location(connection, 'notes.undef')
    assert.strictEqual(undefined, r)
  })

  it('notes.tarpit=2', () => {
    connection.notes = { tarpit: 2 }
    const r = plugin.get_award_location(connection, 'notes.tarpit')
    assert.strictEqual(2, r)
  })

  it('results.geoip', () => {
    connection.results.add('geoip', { country: 'US' })
    const r = plugin.get_award_location(connection, 'results.geoip')
    assert.strictEqual('US', r.country)
  })

  it('results.karma', () => {
    connection.results.add('karma', { score: -1 })
    const r = plugin.get_award_location(connection, 'results.karma')
    assert.strictEqual(-1, r.score)
  })

  it('results.karma, txn', () => {
    connection.transaction.results.add('karma', { score: -1 })
    const r = plugin.get_award_location(connection, 'results.karma')
    assert.strictEqual(-1, r.score)
  })

  it('txn.results.karma', () => {
    connection.results.add('karma', { score: -1 })
    const r = plugin.get_award_location(connection, 'transaction.results.karma')
    assert.strictEqual(undefined, r)
  })

  it('results.auth/auth_base', () => {
    connection.results.add('auth/auth_base', { fail: 'PLAIN' })
    const r = plugin.get_award_location(connection, 'results.auth/auth_base')
    assert.strictEqual('PLAIN', r.fail[0])
  })

  it('unknown location', () => {
    let called = false
    connection.logdebug = () => {
      called = true
    }
    plugin.get_award_location(connection, 'foo.bar.baz')
    assert.ok(called)
  })
})

describe('get_award_condition', () => {
  let plugin
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
  })

  it('geoip.distance', () => {
    assert.strictEqual(
      '4000',
      plugin.get_award_condition('results.geoip.distance@4000', '-1 if gt'),
    )
    assert.strictEqual(
      '4000',
      plugin.get_award_condition(
        'results.geoip.distance@uniq',
        '-1 if gt 4000',
      ),
    )
  })

  it('auth/auth_base', () => {
    assert.strictEqual(
      'plain',
      plugin.get_award_condition(
        'results.auth/auth_base.fail@plain',
        '-1 if in',
      ),
    )
  })
})

describe('check_awards', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('no results', () => {
    const r = plugin.check_awards(connection)
    assert.strictEqual(undefined, r)
  })

  it('no todo', () => {
    connection.results.add('karma', { todo: {} })
    const r = plugin.check_awards(connection)
    assert.strictEqual(undefined, r)
  })

  it('geoip gt', () => {
    connection.results.add('karma', {
      todo: { 'results.geoip.distance@4000': '-1 if gt 4000' },
    })
    connection.results.add('geoip', { distance: 4000 })
    plugin.check_awards(connection)
    assert.strictEqual(undefined, connection.results.get('karma').fail[0])

    connection.results.add('geoip', { distance: 4001 })
    plugin.check_awards(connection)
    assert.strictEqual(
      'geoip.distance',
      connection.results.get('karma').fail[0],
    )
  })

  it('auth failure', () => {
    connection.results.add('karma', {
      todo: { 'results.auth/auth_base.fail@PLAIN': '-1 if in' },
    })
    connection.results.add('auth/auth_base', { fail: 'PLAIN' })
    const r = plugin.check_awards(connection)
    assert.strictEqual(undefined, r)
    assert.strictEqual(
      'auth/auth_base.fail',
      connection.results.get('karma').fail[0],
    )
  })

  it('valid recipient', () => {
    connection.results.add('karma', {
      todo: { 'results.rcpt_to.qmd.pass@exist': '1 if in' },
    })
    connection.results.add('rcpt_to.qmd', { pass: 'exist' })
    const r = plugin.check_awards(connection)
    assert.strictEqual(undefined, r)
    assert.strictEqual('qmd.pass', connection.results.get('karma').pass[0])
  })

  it('equals operator', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if equals val' },
    })
    connection.notes.test = 'val'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('gt operator', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@5': '1 if gt 5' },
    })
    connection.notes.test = 6
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('lt operator', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@5': '1 if lt 5' },
    })
    connection.notes.test = 4
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('match operator', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if match val' },
    })
    connection.notes.test = 'avalb'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('length operator gt', () => {
    connection.results.add('karma', {
      todo: { 'notes.test': '1 if length gt 3' },
    })
    connection.notes.test = 'abcd'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('length operator lt', () => {
    connection.results.add('karma', {
      todo: { 'notes.test': '1 if length lt 5' },
    })
    connection.notes.test = 'abcd'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('length operator equals', () => {
    connection.results.add('karma', {
      todo: { 'notes.test': '1 if length equals 4' },
    })
    connection.notes.test = 'abcd'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('in operator with array', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if in' },
    })
    connection.notes.test = ['val', 'other']
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('in operator mismatch', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if in' },
    })
    connection.notes.test = 'notval' // not an array
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('match operator with array', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if match val' },
    })
    connection.notes.test = ['avalb', 'other']
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('length operator unknown operator', () => {
    let called = false
    connection.logerror = () => {
      called = true
    }
    connection.results.add('karma', {
      todo: { 'notes.test': '1 if length foo 3' },
    })
    connection.notes.test = 'abcd'
    plugin.check_awards(connection)
    assert.ok(called)
  })

  it('unknown operator in switch', () => {
    connection.results.add('karma', {
      todo: { 'notes.test': '1 if foo bar' },
    })
    connection.notes.test = 'abcd'
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('if condition truth test fails', () => {
    connection.results.add('karma', {
      todo: { 'notes.test': '1' },
    })
    connection.notes.test = 0 // falsy
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('if condition with wants mismatch', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1' },
    })
    connection.notes.test = 'notval'
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('in operator with array mismatch', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if in' },
    })
    connection.notes.test = ['other']
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })
})

describe('apply_award', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('handles non-numeric award', () => {
    let called = false
    connection.logerror = () => {
      called = true
    }
    plugin.apply_award(connection, 'test', 'NaN')
    assert.ok(called)
  })

  it('trims notes prefix', () => {
    connection.results.add(plugin, { score: 0 })
    plugin.apply_award(connection, 'notes.test', 1)
    assert.strictEqual(connection.results.get('karma').pass[0], 'test')
  })

  it('trims results prefix', () => {
    connection.results.add(plugin, { score: 0 })
    plugin.apply_award(connection, 'results.test', 1)
    assert.strictEqual(connection.results.get('karma').pass[0], 'test')
  })

  it('trims transaction.results prefix', () => {
    connection.results.add(plugin, { score: 0 })
    plugin.apply_award(connection, 'transaction.results.test', 1)
    assert.strictEqual(connection.results.get('karma').pass[0], 'test')
  })
})

describe('check_syntax_RcptTo', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('valid RcptTo', () => {
    connection.current_line = 'RCPT TO:<user@example.com>'
    plugin.check_syntax_RcptTo(connection)
    assert.strictEqual(undefined, connection.results.get('karma'))
  })

  it('invalid RcptTo', () => {
    connection.current_line = 'RCPT TO: <user@example.com>'
    plugin.check_syntax_RcptTo(connection)
    assert.strictEqual(
      connection.results.get('karma').fail[0],
      'rfc5321.RcptTo',
    )
  })
})

describe('assemble_note_obj extra', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('handles phase prefixes', () => {
    connection.notes['rcpt_to.qmd'] = { test: 1 }
    const obj = plugin.assemble_note_obj(connection, 'notes.rcpt_to.qmd.test')
    assert.strictEqual(obj, 1)
  })
})

describe('apply_tarpit', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('tarpit=false', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.apply_tarpit(connection, 'connect', 0, next)
  })

  it('tarpit=true, score=0', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.apply_tarpit(connection, 'connect', 0, next)
  })

  it('tarpit=true, score=1', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.apply_tarpit(connection, 'connect', 1, next)
  })

  it('tarpit=true, score=-1', (t, done) => {
    const before = Date.now()
    const next = (rc, msg) => {
      assert.ok(Date.now() >= before)
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.apply_tarpit(connection, 'connect', -1, next)
  })

  it('tarpit=true, score=-2, max=1', (t, done) => {
    const before = Date.now()
    const next = (rc, msg) => {
      assert.ok(Date.now() >= before)
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.apply_tarpit(connection, 'connect', -2, next)
  })

  it('tarpit=true, score=connect, max=1', (t, done) => {
    const before = Date.now()
    const next = (rc, msg) => {
      assert.ok(Date.now() >= before)
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    connection.results.add(plugin, { score: -2 })
    plugin.apply_tarpit(connection, 'connect', -2, next)
  })
})

describe('should_we_deny', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('no results', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.should_we_deny(next, connection, 'connect')
  })

  it('no score', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    connection.results.add(plugin, { test: 'blah' })
    plugin.should_we_deny(next, connection, 'connect')
  })

  it('invalid score', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    connection.results.add(plugin, { score: 'blah' })
    plugin.should_we_deny(next, connection, 'connect')
  })

  it('valid score, okay', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    connection.results.add(plugin, { score: -1 })
    plugin.should_we_deny(next, connection, 'connect')
  })

  it('valid score, -6, deny_hook', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(constants.DENY, rc)
      assert.ok(msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.deny_hooks = { connect: true }
    connection.results.add(plugin, { score: -6 })
    plugin.should_we_deny(next, connection, 'connect')
  })

  it('valid score, -6, pass_hook', (t, done) => {
    const next = (rc, msg) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(undefined, msg)
      done()
    }
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.deny_hooks = { helo: true }
    connection.results.add(plugin, { score: -6 })
    plugin.should_we_deny(next, connection, 'connect')
  })
})

describe('check_result_equal', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('equal match is scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'equals',
      value: 'clean',
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_equal(['clean'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 1)
  })

  it('not equal match is not scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'equals',
      value: 'dirty',
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_equal(['clean'], award, connection)
    assert.strictEqual(connection.results.store.karma, undefined)
  })
})

describe('check_result_gt', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('gt match is scored', () => {
    const award = {
      id: 5,
      award: 3,
      operator: 'gt',
      value: 3,
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_gt([4], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 3)
    assert.strictEqual(connection.results.store.karma.awards[0], 5)
  })
})

describe('check_result_lt', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('lt match is scored', () => {
    const award = {
      id: 2,
      award: 3,
      operator: 'lt',
      value: 5,
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_lt([4], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 3)
    assert.strictEqual(connection.results.store.karma.awards[0], 2)
  })

  it('lt match not scored', () => {
    const award = {
      id: 3,
      award: 3,
      operator: 'lt',
      value: 3,
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_lt([4], award, connection)
    assert.strictEqual(connection.results.store.karma, undefined)
  })
})

describe('check_result_match', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('match pattern is scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'match',
      value: 'phish',
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_match(['isphishing'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 1)
  })

  it('mismatch is not scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'match',
      value: 'dirty',
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_match(['clean'], award, connection)
    assert.strictEqual(connection.results.store.karma, undefined)
  })

  it('FCrDNS match is scored', () => {
    const award = {
      id: 89,
      award: 2,
      operator: 'match',
      value: 'google.com',
      reason: 'testing',
      resolution: 'never',
    }
    plugin.check_result_match(['mail-yk0-f182.google.com'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 89)
  })
})

describe('check_result_length', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('eq pattern is scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'eq 3',
      reason: 'testing',
      resolution: 'hah',
    }
    plugin.check_result_length(['3'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 1)
  })

  it('eq pattern is not scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'eq 3',
      reason: 'testing',
      resolution: 'hah',
    }
    plugin.check_result_length(['4'], award, connection)
    assert.deepStrictEqual(connection.results.store.karma, undefined)
  })

  it('gt pattern is scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'gt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    plugin.check_result_length(['5'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 1)
  })

  it('gt pattern is not scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'gt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    plugin.check_result_length(['3'], award, connection)
    assert.deepStrictEqual(connection.results.store.karma, undefined)
  })

  it('lt pattern is scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'lt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    plugin.check_result_length(['2'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 1)
  })

  it('lt pattern is not scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'lt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    plugin.check_result_length(['3'], award, connection)
    assert.deepStrictEqual(connection.results.store.karma, undefined)
  })
})

describe('check_result_exists', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('exists pattern is scored', () => {
    const award = {
      id: 1,
      award: 2,
      operator: 'exists',
      value: 'any',
      reason: 'testing',
      resolution: 'high five',
    }
    plugin.check_result_exists(['3'], award, connection)
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], 1)
  })

  it('not exists pattern is not scored', () => {
    const award = {
      id: 1,
      award: 3,
      operator: 'exists',
      value: '',
      reason: 'testing',
      resolution: 'misses',
    }
    plugin.check_result_exists([], award, connection)
    assert.strictEqual(connection.results.store.karma, undefined)
  })
})

describe('check_result', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('geoip country is scored', () => {
    plugin.cfg.result_awards = {
      1: 'geoip | country | equals | CN | 2',
    }
    plugin.preparse_result_awards()
    connection.results.add({ name: 'geoip' }, { country: 'CN' })
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"country":"CN"}}',
    )
    assert.strictEqual(connection.results.store.karma.score, 2)
    assert.strictEqual(connection.results.store.karma.awards[0], '1')
  })

  it('dnsbl listing is scored', () => {
    plugin.cfg.result_awards = {
      2: 'dnsbl | fail | equals | dnsbl.sorbs.net | -5',
    }
    plugin.preparse_result_awards()
    connection.results.add({ name: 'dnsbl' }, { fail: 'dnsbl.sorbs.net' })
    plugin.check_result(
      connection,
      '{"plugin":"dnsbl","result":{"fail":"dnsbl.sorbs.net"}}',
    )
    assert.strictEqual(connection.results.store.karma.score, -5)
    assert.strictEqual(connection.results.store.karma.awards[0], '2')
  })
})

describe('check_spammy_tld', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('spammy TLD is scored: top', () => {
    plugin.cfg.spammy_tlds = { top: -3 }
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    plugin.check_spammy_tld(mfrom, connection)
    assert.strictEqual(connection.results.store.karma.score, -3)
    assert.strictEqual(connection.results.store.karma.fail[0], 'spammy.TLD')
  })

  it('spammy TLD is scored: rocks', () => {
    plugin.cfg.spammy_tlds = { rocks: '-2' }
    const mfrom = new Address('spamy@foo.rocks')
    plugin.check_spammy_tld(mfrom, connection)
    assert.strictEqual(connection.results.store.karma.score, -2)
    assert.strictEqual(connection.results.store.karma.fail[0], 'spammy.TLD')
  })
})

describe('tls', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('unconfigured TLS does nothing', (t, done) => {
    connection.tls.enabled = true
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    connection.current_line = 'MAIL FROM:<foo@test.com>'
    plugin.hook_mail(
      () => {
        assert.strictEqual(connection.results.store.karma, undefined)
        done()
      },
      connection,
      [mfrom],
    )
  })

  it('TLS is scored', (t, done) => {
    plugin.cfg.tls = { set: 2, unset: -4 }
    connection.tls.enabled = true
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    connection.current_line = 'MAIL FROM:<foo@test.com>'
    plugin.hook_mail(
      () => {
        assert.strictEqual(connection.results.store.karma.score, 2)
        done()
      },
      connection,
      [mfrom],
    )
  })

  it('no TLS is scored', (t, done) => {
    plugin.cfg.tls = { set: 2, unset: -4 }
    connection.tls.enabled = false
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    connection.current_line = 'MAIL FROM:<foo@test.com>'
    plugin.hook_mail(
      () => {
        assert.strictEqual(connection.results.store.karma.score, -4)
        done()
      },
      connection,
      [mfrom],
    )
  })
})

describe('skipping hooks', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('notes.disable_karma', (t, done) => {
    function next(rc) {
      assert.strictEqual(undefined, rc)
    }
    function last(rc) {
      assert.strictEqual(undefined, rc)
      done()
    }
    connection.notes.disable_karma = true

    plugin.hook_deny(next, connection)
    plugin.hook_connect(next, connection)
    plugin.hook_ehlo(next, connection)
    plugin.hook_vrfy(next, connection)
    plugin.hook_noop(next, connection)
    plugin.hook_data(next, connection)
    plugin.hook_queue(next, connection)
    plugin.hook_reset_transaction(next, connection)
    plugin.hook_unrecognized_command(last, connection)
  })

  it('private skip', (t, done) => {
    function next(rc) {
      assert.strictEqual(undefined, rc)
    }
    function last(rc) {
      assert.strictEqual(undefined, rc)
      done()
    }
    connection.remote.is_private = true

    plugin.hook_deny(next, connection)
    plugin.hook_connect(next, connection)
    plugin.hook_ehlo(next, connection)
    plugin.hook_vrfy(next, connection)
    plugin.hook_noop(next, connection)
    plugin.hook_data(next, connection)
    plugin.hook_queue(next, connection)
    plugin.hook_reset_transaction(next, connection)
    plugin.hook_unrecognized_command(last, connection)
  })
})

describe('hook_data_post', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('skips when should_we_skip is true', (t, done) => {
    connection.remote.is_private = true
    plugin.hook_data_post((rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }, connection)
  })

  it('adds header and calls should_we_deny', (t, done) => {
    connection.results.add(plugin, { score: 1 })
    plugin.hook_data_post((rc) => {
      assert.strictEqual(undefined, rc)
      assert.ok(connection.transaction.header.get('X-Haraka-Karma'))
      done()
    }, connection)
  })
})

describe('increment', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
    plugin.db = {
      hIncrBy: () => {},
    }
  })

  it('calls hIncrBy', () => {
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    plugin.increment(connection, 'good', 1)
    assert.strictEqual(called, 1)
  })

  it('calls hIncrBy with ASN', () => {
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    plugin.cfg.asn = { enable: true }
    connection.results.add('asn', { asn: 1234 })
    plugin.increment(connection, 'good', 1)
    assert.strictEqual(called, 2)
  })
})

describe('hook_disconnect', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
    plugin.db = {
      hIncrBy: () => {},
    }
    plugin.redis_unsubscribe = () => {}
  })

  it('skips when should_we_skip is true', (t, done) => {
    connection.remote.is_private = true
    plugin.hook_disconnect((rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }, connection)
  })

  it('increments good for positive score', (t, done) => {
    connection.results.add(plugin, { score: 5 })
    plugin.cfg.thresholds = { positive: 3 }
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    plugin.hook_disconnect((rc) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(called, 1)
      done()
    }, connection)
  })

  it('increments bad for negative score', (t, done) => {
    connection.results.add(plugin, { score: -1 })
    plugin.cfg.thresholds = { positive: 3 }
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    plugin.hook_disconnect((rc) => {
      assert.strictEqual(undefined, rc)
      assert.strictEqual(called, 1)
      done()
    }, connection)
  })

  it('no karma results', (t, done) => {
    plugin.hook_disconnect((rc) => {
      assert.strictEqual(undefined, rc)
      const k = connection.results.get('karma')
      assert.strictEqual(k.err[0], 'karma results missing')
      done()
    }, connection)
  })

  it('no thresholds', (t, done) => {
    connection.results.add(plugin, { score: 1 })
    plugin.cfg.thresholds = undefined
    plugin.hook_disconnect((rc) => {
      assert.strictEqual(undefined, rc)
      const k = connection.results.get('karma')
      assert.strictEqual(k.msg[0], 'no action')
      done()
    }, connection)
  })
})

describe('check_asn', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
    plugin.db = {
      hGetAll: () => Promise.resolve(null),
      hIncrBy: () => {},
    }
    plugin.init_asn = () => {}
  })

  it('inits ASN when no history', (t, done) => {
    let called = false
    plugin.init_asn = () => {
      called = true
    }
    plugin.check_asn(connection, 'as1234')
    setTimeout(() => {
      assert.ok(called)
      done()
    }, 10)
  })

  it('applies ASN score from history', (t, done) => {
    plugin.db.hGetAll = () => Promise.resolve({ good: 10, bad: 0 })
    plugin.check_asn(connection, 'as1234')
    setTimeout(() => {
      const r = connection.results.get('karma')
      assert.strictEqual(r.asn_score, 10)
      assert.strictEqual(r.pass[0], 'asn:history')
      done()
    }, 10)
  })

  it('applies all_bad for bad history', (t, done) => {
    plugin.db.hGetAll = () => Promise.resolve({ good: 0, bad: 10 })
    plugin.check_asn(connection, 'as1234')
    setTimeout(() => {
      const r = connection.results.get('karma')
      assert.strictEqual(r.asn_score, -10)
      assert.strictEqual(r.fail[0], 'asn:history')
      assert.strictEqual(r.fail[1], 'asn:all_bad')
      done()
    }, 10)
  })
})

describe('redis helpers', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
    plugin.db = {
      multi: () => ({
        hmSet: function () {
          return this
        },
        expire: function () {
          return this
        },
        exec: () => Promise.resolve([]),
      }),
    }
  })

  it('init_ip', async () => {
    await plugin.init_ip('dbkey', '1.2.3.4', 3600)
    // if it doesn't throw, it's fine for now as we mock multi
  })

  it('get_asn_key', () => {
    plugin.cfg.asn = { enable: true }
    connection.results.add('asn', { asn: 1234 })
    assert.strictEqual(plugin.get_asn_key(connection), 'as1234')
  })

  it('init_asn', () => {
    plugin.init_asn('as1234', 3600)
    // if it doesn't throw, it's fine
  })
})

describe('check_asn extra', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
    plugin.db = {
      hGetAll: () => Promise.reject(new Error('redis error')),
    }
  })

  it('handles redis error', (t, done) => {
    plugin.check_asn(connection, 'as1234')
    setTimeout(() => {
      const r = connection.results.get('karma')
      assert.ok(r.err)
      done()
    }, 10)
  })
})

describe('hook_mail', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('invalid MailFrom syntax', (t, done) => {
    connection.current_line = 'MAIL FROM: <user@example.com>'
    plugin.hook_mail(
      (rc) => {
        assert.strictEqual(undefined, rc)
        assert.strictEqual(
          connection.results.get('karma').fail[0],
          'rfc5321.MailFrom',
        )
        done()
      },
      connection,
      [new Address('<user@example.com>')],
    )
  })
})

describe('hook_rcpt', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('user match', (t, done) => {
    connection.transaction.mail_from = new Address('<user@example.com>')
    connection.current_line = 'RCPT TO:<user@other.com>'
    const rcpt = new Address('<user@other.com>')
    plugin.hook_rcpt(
      (rc) => {
        assert.strictEqual(undefined, rc)
        assert.ok(
          connection.results.get('karma').fail.includes('env_user_match'),
        )
        done()
      },
      connection,
      [rcpt],
    )
  })
})

describe('hook_rcpt_ok', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('user match', (t, done) => {
    connection.transaction.mail_from = new Address('<user@example.com>')
    connection.current_line = 'RCPT TO:<user@other.com>'
    const rcpt = new Address('<user@other.com>')
    plugin.hook_rcpt_ok(
      (rc) => {
        assert.strictEqual(undefined, rc)
        assert.ok(
          connection.results.get('karma').fail.includes('env_user_match'),
        )
        done()
      },
      connection,
      rcpt,
    )
  })
})

describe('ip_history_from_redis', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
    plugin.db = {
      hGetAll: () => Promise.resolve(null),
    }
    plugin.init_ip = () => {}
  })

  it('inits IP when no history', (t, done) => {
    let called = false
    plugin.init_ip = () => {
      called = true
    }
    plugin.ip_history_from_redis(() => {
      assert.ok(called)
      done()
    }, connection)
  })

  it('loads history (good)', (t, done) => {
    plugin.db.hGetAll = () =>
      Promise.resolve({ good: 10, bad: 0, connections: 5 })
    plugin.db.multi = () => ({
      hIncrBy: function () {
        return this
      },
      expire: function () {
        return this
      },
      exec: () => Promise.resolve([]),
    })
    plugin.ip_history_from_redis(() => {
      const r = connection.results.get('karma')
      assert.strictEqual(r.good, 10)
      assert.strictEqual(r.history, 10)
      done()
    }, connection)
  })

  it('loads history with all_bad', (t, done) => {
    plugin.db.hGetAll = () =>
      Promise.resolve({ good: 0, bad: 10, connections: 5 })
    plugin.db.multi = () => ({
      hIncrBy: function () {
        return this
      },
      expire: function () {
        return this
      },
      exec: () => Promise.resolve([]),
    })
    plugin.ip_history_from_redis(() => {
      const r = connection.results.get('karma')
      assert.strictEqual(r.fail[0], 'all_bad')
      done()
    }, connection)
  })
})

describe('match operator extra', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('match operator with array mismatch', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if match val' },
    })
    connection.notes.test = ['other', 'another']
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })
})

describe('hook_connect', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('calls should_we_deny', (t, done) => {
    plugin.hook_connect((rc) => {
      assert.strictEqual(undefined, rc)
      done()
    }, connection)
  })
})

describe('other hooks', () => {
  let plugin, connection
  beforeEach(() => {
    const context = _set_up()
    plugin = context.plugin
    connection = context.connection
  })

  it('hook_helo', (t, done) => {
    plugin.hook_helo(() => done(), connection)
  })
  it('hook_ehlo', (t, done) => {
    plugin.hook_ehlo(() => done(), connection)
  })
  it('hook_vrfy', (t, done) => {
    plugin.hook_vrfy(() => done(), connection)
  })
  it('hook_noop', (t, done) => {
    plugin.hook_noop(() => done(), connection)
  })
  it('hook_data', (t, done) => {
    plugin.hook_data(() => done(), connection)
  })
  it('hook_queue', (t, done) => {
    plugin.hook_queue(() => done(), connection)
  })
  it('hook_reset_transaction', (t, done) => {
    plugin.hook_reset_transaction(() => done(), connection)
  })
  it('hook_unrecognized_command', (t, done) => {
    plugin.hook_unrecognized_command(() => done(), connection, 'foo')
  })
})
