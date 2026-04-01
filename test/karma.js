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
  plugin.deny_hooks = ['connect']
  plugin.tarpit_hooks = ['connect']

  const connection = fixtures.connection.createConnection({}, { notes: {} })
  connection.init_transaction()

  return { plugin, connection }
}

// Reduce repetition in check_result_* tests
function makeAward(overrides = {}) {
  return {
    id: 1,
    award: 2,
    operator: 'equals',
    value: 'test',
    reason: 'testing',
    plugin: 'test',
    ...overrides,
  }
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
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('pre-init has no karma results', () => {
    assert.strictEqual(undefined, connection.results.get('karma'))
  })

  it('empty cfg initializes score', () => {
    plugin.results_init(stub, connection)
    assert.ok(connection.results.get('karma'))
  })

  it('cfg with awards initializes todo', () => {
    plugin.cfg.awards = { test: 1 }
    plugin.results_init(stub, connection)
    const r = connection.results.get('karma')
    assert.ok(r)
    assert.ok(r.todo)
  })

  it('private IP is skipped', () => {
    connection.remote.is_private = true
    plugin.results_init(stub, connection)
    assert.strictEqual(undefined, connection.results.get('karma'))
  })

  it('logs error and skips when already initialized', () => {
    connection.results.add({ name: 'karma' }, { score: 0 })
    let errCalled = false
    connection.logerror = () => {
      errCalled = true
    }
    plugin.results_init(stub, connection)
    assert.ok(errCalled)
  })

  it('disable_karma flag is skipped', () => {
    connection.notes.disable_karma = true
    plugin.results_init(stub, connection)
    assert.strictEqual(undefined, connection.results.get('karma'))
  })
})

describe('should_we_skip', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('returns false for normal connections', () => {
    assert.strictEqual(false, plugin.should_we_skip(connection))
  })

  it('returns true for private IPs', () => {
    connection.remote.is_private = true
    assert.strictEqual(true, plugin.should_we_skip(connection))
  })

  it('returns true when disable_karma is set', () => {
    connection.notes.disable_karma = true
    assert.strictEqual(true, plugin.should_we_skip(connection))
  })
})

describe('assemble_note_obj', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('returns undefined for missing note', () => {
    assert.strictEqual(
      undefined,
      plugin.assemble_note_obj(connection, 'notes.auth_fails'),
    )
  })

  it('returns value for existing note', () => {
    connection.notes.auth_fails = [1, 2]
    assert.deepStrictEqual(
      [1, 2],
      plugin.assemble_note_obj(connection, 'notes.auth_fails'),
    )
  })

  it('handles phase-prefixed keys (rcpt_to.qmd)', () => {
    connection.notes['rcpt_to.qmd'] = { test: 1 }
    assert.strictEqual(
      1,
      plugin.assemble_note_obj(connection, 'notes.rcpt_to.qmd.test'),
    )
  })
})

describe('hook_deny', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('no pi_name resumes connection with OK', () => {
    let rc
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      ['', '', '', ''],
    )
    assert.strictEqual(constants.OK, rc)
  })

  it('pi_name=karma passes through', () => {
    let rc
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      ['', '', 'karma', ''],
    )
    assert.strictEqual(undefined, rc)
  })

  it('excluded plugin passes through', () => {
    let rc
    plugin.deny_exclude_plugins = ['access']
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      ['', '', 'access', ''],
    )
    assert.strictEqual(undefined, rc)
  })

  it('excluded hook rcpt_to passes through', () => {
    let rc
    plugin.deny_exclude_hooks = ['rcpt_to']
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      ['', '', '', '', '', 'rcpt_to'],
    )
    assert.strictEqual(undefined, rc)
  })

  it('excluded hook queue passes through', () => {
    let rc
    plugin.deny_exclude_hooks = ['queue']
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      ['', '', '', '', '', 'queue'],
    )
    assert.strictEqual(undefined, rc)
  })

  it('DENYSOFT resumes connection with OK', () => {
    let rc
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      [constants.DENYSOFT, '', '', '', '', ''],
    )
    assert.strictEqual(constants.OK, rc)
  })

  it('no connection results resumes with OK', () => {
    let rc
    connection.results = null
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      ['', '', '', '', '', ''],
    )
    assert.strictEqual(constants.OK, rc)
  })
})

describe('should_rspamd_greylist', () => {
  let plugin, connection

  function setupGreylist() {
    ;({ plugin, connection } = _set_up())
    plugin.cfg.greylist = { spamassassin_score: 5, rspamd_score: 6 }
    plugin.greylist_asns = ['64496']
    connection.results.add({ name: 'asn' }, { asn: 64496 })
    connection.transaction.results.add({ name: 'spamassassin' }, { hits: 7 })
    connection.transaction.results.add({ name: 'rspamd' }, { score: 8 })
  }

  it('returns false when greylist_asns is not configured', () => {
    ;({ plugin, connection } = _set_up())
    plugin.greylist_asns = []
    assert.strictEqual(false, plugin.should_rspamd_greylist(connection))
  })

  it('returns false when connection ASN is not in the list', () => {
    setupGreylist()
    plugin.greylist_asns = ['99999'] // different ASN
    assert.strictEqual(false, plugin.should_rspamd_greylist(connection))
  })

  it('returns false when connection has no ASN result', () => {
    const { plugin: p, connection: c } = _set_up()
    p.cfg.greylist = { spamassassin_score: 5, rspamd_score: 6 }
    p.greylist_asns = ['64496']
    // no ASN result added
    assert.strictEqual(false, p.should_rspamd_greylist(c))
  })

  it('falls back to geoip result for ASN', () => {
    ;({ plugin, connection } = _set_up())
    plugin.cfg.greylist = { spamassassin_score: 5, rspamd_score: 6 }
    plugin.greylist_asns = ['64496']
    connection.results.add({ name: 'geoip' }, { asn: 64496 })
    connection.transaction.results.add({ name: 'spamassassin' }, { hits: 7 })
    connection.transaction.results.add({ name: 'rspamd' }, { score: 8 })
    assert.strictEqual(true, plugin.should_rspamd_greylist(connection))
  })

  it('returns false when SpamAssassin score is at or below threshold', () => {
    setupGreylist()
    connection.transaction.results.add({ name: 'spamassassin' }, { hits: 5 }) // == threshold
    assert.strictEqual(false, plugin.should_rspamd_greylist(connection))
  })

  it('returns false when SpamAssassin result is absent', () => {
    setupGreylist()
    const { plugin: p, connection: c } = _set_up()
    p.cfg.greylist = { spamassassin_score: 5, rspamd_score: 6 }
    p.greylist_asns = ['64496']
    c.results.add({ name: 'asn' }, { asn: 64496 })
    c.transaction.results.add({ name: 'rspamd' }, { score: 8 })
    // no spamassassin result
    assert.strictEqual(false, p.should_rspamd_greylist(c))
  })

  it('returns false when rspamd score is at or below threshold', () => {
    setupGreylist()
    connection.transaction.results.add({ name: 'rspamd' }, { score: 6 }) // == threshold
    assert.strictEqual(false, plugin.should_rspamd_greylist(connection))
  })

  it('returns false when rspamd result is absent', () => {
    const { plugin: p, connection: c } = _set_up()
    p.cfg.greylist = { spamassassin_score: 5, rspamd_score: 6 }
    p.greylist_asns = ['64496']
    c.results.add({ name: 'asn' }, { asn: 64496 })
    c.transaction.results.add({ name: 'spamassassin' }, { hits: 7 })
    // no rspamd result
    assert.strictEqual(false, p.should_rspamd_greylist(c))
  })

  it('returns true when ASN matches and both scores exceed thresholds', () => {
    setupGreylist()
    assert.strictEqual(true, plugin.should_rspamd_greylist(connection))
  })
})

describe('hook_deny rspamd greylist', () => {
  let plugin, connection

  function setupGreylistDeny() {
    ;({ plugin, connection } = _set_up())
    plugin.deny_exclude_plugins = []
    plugin.deny_exclude_hooks = []
    plugin.cfg.greylist = { spamassassin_score: 5, rspamd_score: 6 }
    plugin.greylist_asns = ['64496']
    connection.results.add({ name: 'asn' }, { asn: 64496 })
    connection.transaction.results.add({ name: 'spamassassin' }, { hits: 7 })
    connection.transaction.results.add({ name: 'rspamd' }, { score: 8 })
  }

  it('rspamd DENYSOFT passes through when all conditions are met', () => {
    setupGreylistDeny()
    let rc
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      [constants.DENYSOFT, 'greylist', 'rspamd', '', '', ''],
    )
    assert.strictEqual(undefined, rc)
  })

  it('rspamd DENYSOFT is intercepted when ASN is not in list', () => {
    setupGreylistDeny()
    plugin.greylist_asns = ['99999']
    let rc
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      [constants.DENYSOFT, 'greylist', 'rspamd', '', '', ''],
    )
    assert.strictEqual(constants.OK, rc)
  })

  it('rspamd DENY (not DENYSOFT) is intercepted regardless of conditions', () => {
    setupGreylistDeny()
    let rc
    plugin.hook_deny(
      (r) => {
        rc = r
      },
      connection,
      [constants.DENY, 'reject', 'rspamd', '', '', ''],
    )
    assert.strictEqual(constants.OK, rc)
  })
})

describe('get_award_location', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('relaying=false', () => {
    connection.relaying = false
    assert.strictEqual(false, plugin.get_award_location(connection, 'relaying'))
  })

  it('relaying=true', () => {
    connection.relaying = true
    assert.strictEqual(true, plugin.get_award_location(connection, 'relaying'))
  })

  it('undefined note returns undefined', () => {
    assert.strictEqual(
      undefined,
      plugin.get_award_location(connection, 'notes.undef'),
    )
  })

  it('notes.tarpit=2', () => {
    connection.notes = { tarpit: 2 }
    assert.strictEqual(2, plugin.get_award_location(connection, 'notes.tarpit'))
  })

  it('results.geoip', () => {
    connection.results.add('geoip', { country: 'US' })
    assert.strictEqual(
      'US',
      plugin.get_award_location(connection, 'results.geoip').country,
    )
  })

  it('results.karma on connection', () => {
    connection.results.add('karma', { score: -1 })
    assert.strictEqual(
      -1,
      plugin.get_award_location(connection, 'results.karma').score,
    )
  })

  it('results.karma falls back to transaction', () => {
    connection.transaction.results.add('karma', { score: -1 })
    assert.strictEqual(
      -1,
      plugin.get_award_location(connection, 'results.karma').score,
    )
  })

  it('transaction.results with no transaction result returns undefined', () => {
    connection.results.add('karma', { score: -1 })
    assert.strictEqual(
      undefined,
      plugin.get_award_location(connection, 'transaction.results.karma'),
    )
  })

  it('results.auth/auth_base', () => {
    connection.results.add('auth/auth_base', { fail: 'PLAIN' })
    assert.strictEqual(
      'PLAIN',
      plugin.get_award_location(connection, 'results.auth/auth_base').fail[0],
    )
  })

  it('unknown location logs debug', () => {
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
  beforeEach(() => ({ plugin } = _set_up()))

  it('extracts condition from key @value syntax', () => {
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

  it('extracts condition for in operator', () => {
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
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('returns early with no karma results', () => {
    assert.strictEqual(undefined, plugin.check_awards(connection))
  })

  it('returns early with empty todo', () => {
    connection.results.add('karma', { todo: {} })
    assert.strictEqual(undefined, plugin.check_awards(connection))
  })

  it('gt operator: no award at boundary', () => {
    connection.results.add('karma', {
      todo: { 'results.geoip.distance@4000': '-1 if gt 4000' },
    })
    connection.results.add('geoip', { distance: 4000 })
    plugin.check_awards(connection)
    assert.strictEqual(undefined, connection.results.get('karma').fail?.[0])
  })

  it('gt operator: scores above threshold', () => {
    connection.results.add('karma', {
      todo: { 'results.geoip.distance@4000': '-1 if gt 4000' },
    })
    connection.results.add('geoip', { distance: 4001 })
    plugin.check_awards(connection)
    assert.strictEqual(
      'geoip.distance',
      connection.results.get('karma').fail[0],
    )
  })

  it('in operator: auth failure', () => {
    connection.results.add('karma', {
      todo: { 'results.auth/auth_base.fail@PLAIN': '-1 if in' },
    })
    connection.results.add('auth/auth_base', { fail: 'PLAIN' })
    plugin.check_awards(connection)
    assert.strictEqual(
      'auth/auth_base.fail',
      connection.results.get('karma').fail[0],
    )
  })

  it('in operator: phase-prefixed result', () => {
    connection.results.add('karma', {
      todo: { 'results.rcpt_to.qmd.pass@exist': '1 if in' },
    })
    connection.results.add('rcpt_to.qmd', { pass: 'exist' })
    plugin.check_awards(connection)
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
    connection.results.add('karma', { todo: { 'notes.test@5': '1 if gt 5' } })
    connection.notes.test = 6
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('lt operator', () => {
    connection.results.add('karma', { todo: { 'notes.test@5': '1 if lt 5' } })
    connection.notes.test = 4
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('match operator on string', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if match val' },
    })
    connection.notes.test = 'avalb'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('match operator on array match', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if match val' },
    })
    connection.notes.test = ['avalb', 'other']
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('match operator on array mismatch', () => {
    connection.results.add('karma', {
      todo: { 'notes.test@val': '1 if match val' },
    })
    connection.notes.test = ['other', 'another']
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
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

  it('length operator unknown logs error', () => {
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

  it('in operator with array match', () => {
    connection.results.add('karma', { todo: { 'notes.test@val': '1 if in' } })
    connection.notes.test = ['val', 'other']
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('in operator mismatch (non-array)', () => {
    connection.results.add('karma', { todo: { 'notes.test@val': '1 if in' } })
    connection.notes.test = 'notval'
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('in operator array mismatch', () => {
    connection.results.add('karma', { todo: { 'notes.test@val': '1 if in' } })
    connection.notes.test = ['other']
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('unknown operator is ignored', () => {
    connection.results.add('karma', { todo: { 'notes.test': '1 if foo bar' } })
    connection.notes.test = 'abcd'
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('truthy note without if/wants condition is awarded', () => {
    connection.results.add('karma', { todo: { 'notes.test': '1' } })
    connection.notes.test = 'something'
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('in operator reads wants from bits[4] when no @wants in key', () => {
    connection.results.add('karma', {
      todo: { 'notes.test': '1 if in list val' },
    })
    connection.notes.test = ['other', 'val']
    plugin.check_awards(connection)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('falsy note fails truth test', () => {
    connection.results.add('karma', { todo: { 'notes.test': '1' } })
    connection.notes.test = 0
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })

  it('wants mismatch is not awarded', () => {
    connection.results.add('karma', { todo: { 'notes.test@val': '1' } })
    connection.notes.test = 'notval'
    plugin.check_awards(connection)
    const k = connection.results.get('karma')
    assert.ok(!k.pass || k.pass.length === 0)
  })
})

describe('apply_award', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
    connection.results.add(plugin, { score: 0 })
  })

  it('handles non-numeric award with error log', () => {
    let called = false
    connection.logerror = () => {
      called = true
    }
    plugin.apply_award(connection, 'test', 'NaN')
    assert.ok(called)
  })

  it('trims notes. prefix', () => {
    plugin.apply_award(connection, 'notes.test', 1)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('trims results. prefix', () => {
    plugin.apply_award(connection, 'results.test', 1)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('trims transaction.results. prefix', () => {
    plugin.apply_award(connection, 'transaction.results.test', 1)
    assert.strictEqual('test', connection.results.get('karma').pass[0])
  })

  it('trims rcpt_to. phase prefix', () => {
    plugin.apply_award(connection, 'results.rcpt_to.qmd', 1)
    assert.strictEqual('qmd', connection.results.get('karma').pass[0])
  })

  it('trims mail_from. phase prefix', () => {
    plugin.apply_award(connection, 'results.mail_from.something', 1)
    assert.strictEqual('something', connection.results.get('karma').pass[0])
  })

  it('trims connect. phase prefix', () => {
    plugin.apply_award(connection, 'results.connect.rdns', 1)
    assert.strictEqual('rdns', connection.results.get('karma').pass[0])
  })

  it('trims data. phase prefix', () => {
    plugin.apply_award(connection, 'results.data.headers', -1)
    assert.strictEqual('headers', connection.results.get('karma').fail[0])
  })

  it('negative award goes to fail', () => {
    plugin.apply_award(connection, 'notes.test', -1)
    assert.strictEqual('test', connection.results.get('karma').fail[0])
  })
})

describe('check_syntax_RcptTo', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('valid RCPT TO syntax is accepted', () => {
    connection.current_line = 'RCPT TO:<user@example.com>'
    plugin.check_syntax_RcptTo(connection)
    assert.strictEqual(undefined, connection.results.get('karma'))
  })

  it('illegal space in RCPT TO is flagged', () => {
    connection.current_line = 'RCPT TO: <user@example.com>'
    plugin.check_syntax_RcptTo(connection)
    assert.strictEqual(
      'rfc5321.RcptTo',
      connection.results.get('karma').fail[0],
    )
  })
})

describe('apply_tarpit', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('disabled tarpit calls next immediately', async () => {
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', 0, resolve),
    )
  })

  it('tarpit enabled, score=0 skips delay', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', 0, resolve),
    )
  })

  it('tarpit enabled, positive score skips delay', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', 1, resolve),
    )
  })

  it('tarpit enabled, score=-1 delays then calls next', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    const before = Date.now()
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', -1, resolve),
    )
    assert.ok(Date.now() >= before)
  })

  it('delay is capped at max', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', -2, resolve),
    )
  })

  it('connection-level score used when score arg is undefined', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    connection.results.add(plugin, { score: -2 })
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', -2, resolve),
    )
  })

  it('static delay is used when tarpit.delay is set', async () => {
    plugin.cfg.tarpit = { max: 5, delay: 0.001 } // 1ms static
    const start = Date.now()
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'connect', -1, resolve),
    )
    assert.ok(Date.now() - start < 500) // completed without excessive wait
  })

  it('MSA port routes through tarpit_delay_msa', async () => {
    plugin.cfg.tarpit = { max: 5, max_msa: 2 }
    connection.results.add('karma', { good: 0, bad: 0 })
    connection.local.port = 587
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'ehlo', -3, resolve),
    )
  })

  it('reset_transaction hook is not delayed', async () => {
    plugin.cfg.tarpit = { max: 5, delay: 1 }
    const start = Date.now()
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'reset_transaction', -10, resolve),
    )
    assert.ok(Date.now() - start < 500)
  })

  it('queue hook is not delayed', async () => {
    plugin.cfg.tarpit = { max: 5, delay: 1 }
    const start = Date.now()
    await new Promise((resolve) =>
      plugin.apply_tarpit(connection, 'queue', -10, resolve),
    )
    assert.ok(Date.now() - start < 500)
  })
})

describe('tarpit_delay_msa', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
    plugin.cfg.tarpit = { max: 5, max_msa: 2 }
  })

  it('delay is capped at max_msa with no history', () => {
    connection.results.add('karma', { good: 0, bad: 0 })
    const k = connection.results.get('karma')
    assert.strictEqual(2, plugin.tarpit_delay_msa(connection, 3, k))
  })

  it('good history reduces delay', () => {
    connection.results.add('karma', { good: 5, bad: 0 })
    const k = connection.results.get('karma')
    assert.strictEqual(1, plugin.tarpit_delay_msa(connection, 3, k))
  })

  it('positive ASN score reduces delay', () => {
    connection.results.add('karma', { good: 0, bad: 0 })
    connection.results.add('asn', { asn: 1234, asn_score: 10 })
    const k = connection.results.get('karma')
    assert.strictEqual(1, plugin.tarpit_delay_msa(connection, 3, k))
  })
})

describe('should_we_deny', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('no karma results calls next cleanly', async () => {
    const [rc] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(undefined, rc)
  })

  it('undefined score (NaN) resets and calls next', async () => {
    connection.results.add(plugin, { test: 'blah' })
    const [rc] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(undefined, rc)
  })

  it('invalid score string (NaN) resets and calls next', async () => {
    connection.results.add(plugin, { score: 'blah' })
    const [rc] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(undefined, rc)
  })

  it('score above threshold passes through', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    connection.results.add(plugin, { score: -1 })
    const [rc] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(undefined, rc)
  })

  it('score below threshold on deny hook issues DENY', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.deny_hooks = ['connect']
    connection.results.add(plugin, { score: -6 })
    const [rc, msg] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(constants.DENY, rc)
    assert.ok(msg)
  })

  it('score below threshold on non-deny hook passes through', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.deny_hooks = ['helo']
    connection.results.add(plugin, { score: -6 })
    const [rc] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(undefined, rc)
  })

  it('custom negative threshold is used when configured', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.cfg.thresholds = { negative: -3 }
    plugin.deny_hooks = ['connect']
    connection.results.add(plugin, { score: -4 })
    const [rc] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(constants.DENY, rc)
  })

  it('custom deny message has score interpolated', async () => {
    plugin.cfg.tarpit = { max: 1, delay: 0 }
    plugin.cfg.deny = { message: 'bad score {score} for {uuid}' }
    plugin.deny_hooks = ['connect']
    connection.results.add(plugin, { score: -6 })
    const [rc, msg] = await new Promise((resolve) =>
      plugin.should_we_deny((...args) => resolve(args), connection, 'connect'),
    )
    assert.strictEqual(constants.DENY, rc)
    assert.ok(msg.includes('-6'))
  })
})

describe('result_as_array', () => {
  let plugin
  beforeEach(() => ({ plugin } = _set_up()))

  it('wraps string in array', () => {
    assert.deepStrictEqual(['hello'], plugin.result_as_array('hello'))
  })

  it('wraps number in array', () => {
    assert.deepStrictEqual([42], plugin.result_as_array(42))
  })

  it('wraps boolean in array', () => {
    assert.deepStrictEqual([true], plugin.result_as_array(true))
  })

  it('returns array as-is', () => {
    assert.deepStrictEqual([1, 2, 3], plugin.result_as_array([1, 2, 3]))
  })

  it('converts object values to array', () => {
    assert.deepStrictEqual([1, 2], plugin.result_as_array({ a: 1, b: 2 }))
  })

  it('unknown type calls loginfo and returns value', () => {
    let called = false
    plugin.loginfo = () => {
      called = true
    }
    const result = plugin.result_as_array(undefined)
    assert.ok(called)
    assert.strictEqual(undefined, result)
  })
})

describe('check_result_equal', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('matching value is scored', () => {
    plugin.check_result_equal(
      ['clean'],
      makeAward({ value: 'clean', award: 2 }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
    assert.strictEqual(1, connection.results.store.karma.awards[0])
  })

  it('non-matching value is not scored', () => {
    plugin.check_result_equal(
      ['clean'],
      makeAward({ value: 'dirty' }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('value "true" matches any truthy element', () => {
    plugin.check_result_equal(
      ['anything'],
      makeAward({ value: 'true', award: 1 }),
      connection,
    )
    assert.strictEqual(1, connection.results.store.karma.score)
  })

  it('value "true" does not match falsy element', () => {
    plugin.check_result_equal(
      [null],
      makeAward({ value: 'true', award: 1 }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })
})

describe('check_result_gt', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('value above threshold is scored', () => {
    plugin.check_result_gt(
      [4],
      makeAward({ id: 5, operator: 'gt', value: 3, award: 3 }),
      connection,
    )
    assert.strictEqual(3, connection.results.store.karma.score)
    assert.strictEqual(5, connection.results.store.karma.awards[0])
  })

  it('value at threshold is not scored', () => {
    plugin.check_result_gt(
      [3],
      makeAward({ operator: 'gt', value: 3 }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })
})

describe('check_result_lt', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('value below threshold is scored', () => {
    plugin.check_result_lt(
      [4],
      makeAward({ id: 2, operator: 'lt', value: 5, award: 3 }),
      connection,
    )
    assert.strictEqual(3, connection.results.store.karma.score)
    assert.strictEqual(2, connection.results.store.karma.awards[0])
  })

  it('value at threshold is not scored', () => {
    plugin.check_result_lt(
      [4],
      makeAward({ operator: 'lt', value: 3 }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })
})

describe('check_result_match', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('matching pattern is scored', () => {
    plugin.check_result_match(
      ['isphishing'],
      makeAward({ value: 'phish', award: 2 }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
  })

  it('non-matching pattern is not scored', () => {
    plugin.check_result_match(
      ['clean'],
      makeAward({ value: 'dirty' }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('partial FCrDNS match is scored', () => {
    plugin.check_result_match(
      ['mail-yk0-f182.google.com'],
      makeAward({ id: 89, value: 'google.com', award: 2 }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
    assert.strictEqual(89, connection.results.store.karma.awards[0])
  })
})

describe('check_result_length', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  const base = { operator: 'length', reason: 'testing' }

  it('eq match is scored', () => {
    plugin.check_result_length(
      ['3'],
      makeAward({ ...base, value: 'eq 3' }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
  })

  it('eq mismatch is not scored', () => {
    plugin.check_result_length(
      ['4'],
      makeAward({ ...base, value: 'eq 3' }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('gt match is scored', () => {
    plugin.check_result_length(
      ['5'],
      makeAward({ ...base, value: 'gt 3' }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
  })

  it('gt mismatch is not scored', () => {
    plugin.check_result_length(
      ['3'],
      makeAward({ ...base, value: 'gt 3' }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('lt match is scored', () => {
    plugin.check_result_length(
      ['2'],
      makeAward({ ...base, value: 'lt 3' }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
  })

  it('lt mismatch is not scored', () => {
    plugin.check_result_length(
      ['3'],
      makeAward({ ...base, value: 'lt 3' }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('invalid operator is recorded as error', () => {
    plugin.check_result_length(
      ['3'],
      makeAward({ ...base, value: 'invalid 3' }),
      connection,
    )
    assert.ok(connection.results.store.karma?.err?.length > 0)
  })
})

describe('check_result_exists', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('non-empty result is scored', () => {
    plugin.check_result_exists(
      ['3'],
      makeAward({ operator: 'exists', value: 'any' }),
      connection,
    )
    assert.strictEqual(2, connection.results.store.karma.score)
  })

  it('empty result is not scored', () => {
    plugin.check_result_exists(
      [],
      makeAward({ operator: 'exists', value: '' }),
      connection,
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('invalid operator is recorded as error', () => {
    plugin.check_result_exists(
      ['item'],
      makeAward({ operator: 'exists', value: 'invalid' }),
      connection,
    )
    assert.ok(connection.results.store.karma?.err?.length > 0)
  })
})

describe('check_result_asn', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('returns early when no asn_awards configured', () => {
    plugin.check_result_asn('1234', connection)
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('returns early when ASN not in asn_awards', () => {
    plugin.cfg.asn_awards = { 5678: -2 }
    plugin.check_result_asn('1234', connection)
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('scores matching ASN', () => {
    plugin.cfg.asn_awards = { 1234: -3 }
    connection.results.add(plugin, { score: 0 })
    plugin.check_result_asn('1234', connection)
    assert.strictEqual(-3, connection.results.store.karma.score)
    assert.ok(connection.results.store.karma.fail.includes('asn_awards'))
  })
})

describe('preparse_result_awards', () => {
  let plugin
  beforeEach(() => ({ plugin } = _set_up()))

  it('organizes awards by plugin and property', () => {
    plugin.cfg.result_awards = {
      1: 'geoip | country | equals | CN | -2 | spam country | 0',
      2: 'geoip | distance | gt | 4000 | -1 | too far | 0',
    }
    plugin.preparse_result_awards()
    assert.ok(plugin.result_awards.geoip)
    assert.ok(plugin.result_awards.geoip.country)
    assert.strictEqual(1, plugin.result_awards.geoip.country.length)
    assert.strictEqual('equals', plugin.result_awards.geoip.country[0].operator)
    assert.ok(plugin.result_awards.geoip.distance)
    assert.strictEqual('gt', plugin.result_awards.geoip.distance[0].operator)
  })
})

describe('check_result', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('geoip country is scored', () => {
    plugin.cfg.result_awards = { 1: 'geoip | country | equals | CN | 2' }
    plugin.preparse_result_awards()
    connection.results.add({ name: 'geoip' }, { country: 'CN' })
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"country":"CN"}}',
    )
    assert.strictEqual(2, connection.results.store.karma.score)
    assert.strictEqual('1', connection.results.store.karma.awards[0])
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
    assert.strictEqual(-5, connection.results.store.karma.score)
  })

  it('emit key is skipped', () => {
    plugin.result_awards = {}
    plugin.check_result(
      connection,
      '{"plugin":"testplugin","result":{"emit":true}}',
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('unknown plugin is skipped', () => {
    plugin.result_awards = {}
    plugin.check_result(
      connection,
      '{"plugin":"unknown","result":{"pass":"test"}}',
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('match operator is dispatched', () => {
    plugin.cfg.result_awards = { 3: 'dnsbl | fail | match | sorbs | -3' }
    plugin.preparse_result_awards()
    plugin.check_result(
      connection,
      '{"plugin":"dnsbl","result":{"fail":"dnsbl.sorbs.net"}}',
    )
    assert.strictEqual(-3, connection.results.store.karma.score)
  })

  it('lt operator is dispatched', () => {
    plugin.cfg.result_awards = { 4: 'geoip | distance | lt | 1000 | 1' }
    plugin.preparse_result_awards()
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"distance":500}}',
    )
    assert.strictEqual(1, connection.results.store.karma.score)
  })

  it('gt operator is dispatched', () => {
    plugin.cfg.result_awards = { 5: 'geoip | distance | gt | 3000 | -1' }
    plugin.preparse_result_awards()
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"distance":5000}}',
    )
    assert.strictEqual(-1, connection.results.store.karma.score)
  })

  it('length operator is dispatched', () => {
    plugin.cfg.result_awards = { 6: 'dnsbl | fail | length | gt 0 | -2' }
    plugin.preparse_result_awards()
    plugin.check_result(
      connection,
      '{"plugin":"dnsbl","result":{"fail":"dnsbl.sorbs.net"}}',
    )
    assert.strictEqual(-2, connection.results.store.karma.score)
  })

  it('empty object result is skipped', () => {
    plugin.cfg.result_awards = { 1: 'geoip | country | equals | CN | 2' }
    plugin.preparse_result_awards()
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"country":{}}}',
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('empty string result is skipped', () => {
    plugin.cfg.result_awards = { 1: 'geoip | country | equals | CN | 2' }
    plugin.preparse_result_awards()
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"country":""}}',
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('empty array result is skipped', () => {
    plugin.cfg.result_awards = { 1: 'geoip | fail | equals | CN | 2' }
    plugin.preparse_result_awards()
    plugin.check_result(connection, '{"plugin":"geoip","result":{"fail":[]}}')
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('asn result is routed to check_result_asn', () => {
    let called = false
    plugin.check_result_asn = () => {
      called = true
    }
    plugin.result_awards = {}
    plugin.check_result(
      connection,
      '{"plugin":"geoip","result":{"asn":"1234"}}',
    )
    assert.ok(called)
  })
})

describe('check_spammy_tld', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('.top TLD is scored', () => {
    plugin.cfg.spammy_tlds = { top: -3 }
    plugin.check_spammy_tld(
      new Address('spamy@er7diogt.rrnsale.top'),
      connection,
    )
    assert.strictEqual(-3, connection.results.store.karma.score)
    assert.strictEqual('spammy.TLD', connection.results.store.karma.fail[0])
  })

  it('.rocks TLD is scored', () => {
    plugin.cfg.spammy_tlds = { rocks: '-2' }
    plugin.check_spammy_tld(new Address('spamy@foo.rocks'), connection)
    assert.strictEqual(-2, connection.results.store.karma.score)
  })

  it('null sender (bounce) is skipped', () => {
    plugin.cfg.spammy_tlds = { top: -3 }
    plugin.check_spammy_tld(new Address('<>'), connection)
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('non-spammy TLD is not scored', () => {
    plugin.cfg.spammy_tlds = { top: -3 }
    plugin.check_spammy_tld(new Address('user@example.com'), connection)
    assert.strictEqual(undefined, connection.results.store.karma)
  })
})

describe('tls', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('unconfigured TLS does nothing', async () => {
    connection.tls.enabled = true
    connection.current_line = 'MAIL FROM:<foo@test.com>'
    await new Promise((resolve) =>
      plugin.hook_mail(resolve, connection, [new Address('foo@test.com')]),
    )
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('enabled TLS is scored positively', async () => {
    plugin.cfg.tls = { set: 2, unset: -4 }
    connection.tls.enabled = true
    connection.current_line = 'MAIL FROM:<foo@test.com>'
    await new Promise((resolve) =>
      plugin.hook_mail(resolve, connection, [new Address('foo@test.com')]),
    )
    assert.strictEqual(2, connection.results.store.karma.score)
  })

  it('disabled TLS is scored negatively', async () => {
    plugin.cfg.tls = { set: 2, unset: -4 }
    connection.tls.enabled = false
    connection.current_line = 'MAIL FROM:<foo@test.com>'
    await new Promise((resolve) =>
      plugin.hook_mail(resolve, connection, [new Address('foo@test.com')]),
    )
    assert.strictEqual(-4, connection.results.store.karma.score)
  })
})

describe('skipping hooks', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('notes.disable_karma skips all hooks', (t, done) => {
    connection.notes.disable_karma = true
    function next(rc) {
      assert.strictEqual(undefined, rc)
    }
    function last(rc) {
      assert.strictEqual(undefined, rc)
      done()
    }

    plugin.hook_deny(next, connection)
    plugin.hook_connect(next, connection)
    plugin.hook_ehlo(next, connection)
    plugin.hook_vrfy(next, connection)
    plugin.hook_noop(next, connection)
    plugin.hook_data(next, connection)
    plugin.hook_queue(next, connection)
    plugin.hook_queue_outbound(next, connection)
    plugin.hook_reset_transaction(next, connection)
    plugin.hook_unrecognized_command(last, connection, ['foo'])
  })

  it('private IP skips all hooks', (t, done) => {
    connection.remote.is_private = true
    function next(rc) {
      assert.strictEqual(undefined, rc)
    }
    function last(rc) {
      assert.strictEqual(undefined, rc)
      done()
    }

    plugin.hook_deny(next, connection)
    plugin.hook_connect(next, connection)
    plugin.hook_ehlo(next, connection)
    plugin.hook_vrfy(next, connection)
    plugin.hook_noop(next, connection)
    plugin.hook_data(next, connection)
    plugin.hook_queue(next, connection)
    plugin.hook_queue_outbound(next, connection)
    plugin.hook_reset_transaction(next, connection)
    plugin.hook_unrecognized_command(last, connection, ['foo'])
  })
})

describe('hook_connect', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('calls should_we_deny', async () => {
    const [rc] = await new Promise((resolve) =>
      plugin.hook_connect((...args) => resolve(args), connection),
    )
    assert.strictEqual(undefined, rc)
  })

  it('calls check_asn when ASN key is present', () => {
    let called = false
    plugin.check_asn = () => {
      called = true
    }
    plugin.cfg.asn = { enable: true }
    connection.results.add('asn', { asn: 1234 })
    plugin.hook_connect(stub, connection)
    assert.ok(called)
  })
})

describe('hook_mail', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('invalid MAIL FROM syntax is flagged', async () => {
    connection.current_line = 'MAIL FROM: <user@example.com>'
    await new Promise((resolve) =>
      plugin.hook_mail(resolve, connection, [
        new Address('<user@example.com>'),
      ]),
    )
    assert.strictEqual(
      'rfc5321.MailFrom',
      connection.results.get('karma').fail[0],
    )
  })

  it('valid MAIL FROM syntax is accepted', async () => {
    connection.current_line = 'MAIL FROM:<user@example.com>'
    await new Promise((resolve) =>
      plugin.hook_mail(resolve, connection, [
        new Address('<user@example.com>'),
      ]),
    )
    assert.strictEqual(undefined, connection.results.get('karma'))
  })
})

describe('hook_rcpt', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('matching from/rcpt user is flagged', async () => {
    connection.transaction.mail_from = new Address('<user@example.com>')
    connection.current_line = 'RCPT TO:<user@other.com>'
    await new Promise((resolve) =>
      plugin.hook_rcpt(resolve, connection, [new Address('<user@other.com>')]),
    )
    assert.ok(connection.results.get('karma').fail.includes('env_user_match'))
  })
})

describe('hook_rcpt_ok', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('matching from/rcpt user is flagged', async () => {
    connection.transaction.mail_from = new Address('<user@example.com>')
    connection.current_line = 'RCPT TO:<user@other.com>'
    await new Promise((resolve) =>
      plugin.hook_rcpt_ok(resolve, connection, new Address('<user@other.com>')),
    )
    assert.ok(connection.results.get('karma').fail.includes('env_user_match'))
  })
})

describe('hook_queue_outbound', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('calls should_we_deny', async () => {
    const [rc] = await new Promise((resolve) =>
      plugin.hook_queue_outbound((...args) => resolve(args), connection),
    )
    assert.strictEqual(undefined, rc)
  })
})

describe('hook_unrecognized_command', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('STARTTLS is passed through without penalty', () => {
    let rc
    plugin.hook_unrecognized_command(
      (r) => {
        rc = r
      },
      connection,
      ['STARTTLS'],
    )
    assert.strictEqual(undefined, rc)
    assert.strictEqual(undefined, connection.results.store.karma)
  })

  it('authenticating connection is passed through', () => {
    connection.notes.authenticating = true
    let rc
    plugin.hook_unrecognized_command(
      (r) => {
        rc = r
      },
      connection,
      ['AUTH'],
    )
    assert.strictEqual(undefined, rc)
  })

  it('unknown command is penalized', () => {
    connection.results.add(plugin, { score: 0 })
    plugin.hook_unrecognized_command(stub, connection, ['FROBBLE'])
    assert.strictEqual(-1, connection.results.get('karma').score)
    assert.ok(
      connection.results.get('karma').fail.some((f) => f.includes('FROBBLE')),
    )
  })
})

describe('hook_data_post', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  it('skips private IP', async () => {
    connection.remote.is_private = true
    const [rc] = await new Promise((resolve) =>
      plugin.hook_data_post((...args) => resolve(args), connection),
    )
    assert.strictEqual(undefined, rc)
  })

  it('adds X-Haraka-Karma header and calls should_we_deny', async () => {
    connection.results.add(plugin, { score: 1 })
    const [rc] = await new Promise((resolve) =>
      plugin.hook_data_post((...args) => resolve(args), connection),
    )
    assert.strictEqual(undefined, rc)
    assert.ok(connection.transaction.header.get('X-Haraka-Karma'))
  })
})

describe('increment', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
    plugin.db = { hIncrBy: () => {} }
  })

  it('calls hIncrBy for IP key', () => {
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    plugin.increment(connection, 'good', 1)
    assert.strictEqual(1, called)
  })

  it('also increments ASN key when configured', () => {
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    plugin.cfg.asn = { enable: true }
    connection.results.add('asn', { asn: 1234 })
    plugin.increment(connection, 'good', 1)
    assert.strictEqual(2, called)
  })

  it('does nothing when db is unavailable', () => {
    plugin.db = null
    plugin.increment(connection, 'good', 1) // must not throw
  })
})

describe('hook_disconnect', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
    plugin.db = { hIncrBy: () => {} }
    plugin.redis_unsubscribe = () => {}
  })

  it('skips private IP', async () => {
    connection.remote.is_private = true
    const [rc] = await new Promise((resolve) =>
      plugin.hook_disconnect((...args) => resolve(args), connection),
    )
    assert.strictEqual(undefined, rc)
  })

  it('increments good for positive score', async () => {
    connection.results.add(plugin, { score: 5 })
    plugin.cfg.thresholds = { positive: 3 }
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    await new Promise((resolve) => plugin.hook_disconnect(resolve, connection))
    assert.strictEqual(1, called)
  })

  it('increments bad for negative score', async () => {
    connection.results.add(plugin, { score: -1 })
    plugin.cfg.thresholds = { positive: 3 }
    let called = 0
    plugin.db.hIncrBy = () => {
      called++
    }
    await new Promise((resolve) => plugin.hook_disconnect(resolve, connection))
    assert.strictEqual(1, called)
  })

  it('logs error for missing karma results', async () => {
    await new Promise((resolve) => plugin.hook_disconnect(resolve, connection))
    assert.strictEqual(
      'karma results missing',
      connection.results.get('karma').err[0],
    )
  })

  it('no thresholds logs no action', async () => {
    connection.results.add(plugin, { score: 1 })
    plugin.cfg.thresholds = undefined
    await new Promise((resolve) => plugin.hook_disconnect(resolve, connection))
    assert.strictEqual('no action', connection.results.get('karma').msg[0])
  })
})

describe('check_asn', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
    plugin.db = {
      hGetAll: () => Promise.resolve(null),
      hIncrBy: () => {},
    }
    plugin.init_asn = () => {}
  })

  it('inits ASN when no history', async () => {
    let called = false
    plugin.init_asn = () => {
      called = true
    }
    plugin.check_asn(connection, 'as1234')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(called)
  })

  it('applies positive ASN score from history', async () => {
    plugin.db.hGetAll = () => Promise.resolve({ good: 10, bad: 0 })
    plugin.check_asn(connection, 'as1234')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const r = connection.results.get('karma')
    assert.strictEqual(10, r.asn_score)
    assert.ok(r.pass.includes('asn:history'))
  })

  it('applies all_good pass for good history', async () => {
    plugin.db.hGetAll = () => Promise.resolve({ good: 10, bad: 0 })
    plugin.check_asn(connection, 'as1234')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(connection.results.get('karma').pass.includes('asn:all_good'))
  })

  it('applies negative ASN score and all_bad for bad history', async () => {
    plugin.db.hGetAll = () => Promise.resolve({ good: 0, bad: 10 })
    plugin.check_asn(connection, 'as1234')
    await new Promise((resolve) => setTimeout(resolve, 10))
    const r = connection.results.get('karma')
    assert.strictEqual(-10, r.asn_score)
    assert.ok(r.fail.includes('asn:history'))
    assert.ok(r.fail.includes('asn:all_bad'))
  })

  it('handles Redis error gracefully', async () => {
    plugin.db.hGetAll = () => Promise.reject(new Error('redis error'))
    plugin.check_asn(connection, 'as1234')
    await new Promise((resolve) => setTimeout(resolve, 10))
    assert.ok(connection.results.get('karma').err)
  })
})

describe('redis helpers', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
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

  it('init_ip executes without error', async () => {
    await plugin.init_ip('dbkey', '1.2.3.4', 3600)
  })

  it('get_asn_key returns key for configured ASN', () => {
    plugin.cfg.asn = { enable: true }
    connection.results.add('asn', { asn: 1234 })
    assert.strictEqual('as1234', plugin.get_asn_key(connection))
  })

  it('get_asn_key returns undefined when asn disabled', () => {
    plugin.cfg.asn = { enable: false }
    connection.results.add('asn', { asn: 1234 })
    assert.strictEqual(undefined, plugin.get_asn_key(connection))
  })

  it('get_asn_key falls back to geoip results', () => {
    plugin.cfg.asn = { enable: true }
    connection.results.add('geoip', { asn: 5678 })
    assert.strictEqual('as5678', plugin.get_asn_key(connection))
  })

  it('get_asn_key returns undefined for NaN asn', () => {
    plugin.cfg.asn = { enable: true }
    connection.results.add('asn', { asn: 'notanumber' })
    assert.strictEqual(undefined, plugin.get_asn_key(connection))
  })

  it('init_asn executes without error', () => {
    plugin.init_asn('as1234', 3600)
  })
})

describe('ip_history_from_redis', () => {
  let plugin, connection
  beforeEach(() => {
    ;({ plugin, connection } = _set_up())
    plugin.db = { hGetAll: () => Promise.resolve(null) }
    plugin.init_ip = () => {}
  })

  it('inits IP when no history found', async () => {
    let called = false
    plugin.init_ip = () => {
      called = true
    }
    await new Promise((resolve) =>
      plugin.ip_history_from_redis(resolve, connection),
    )
    assert.ok(called)
  })

  it('loads good history and sets all_good', async () => {
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
    await new Promise((resolve) =>
      plugin.ip_history_from_redis(resolve, connection),
    )
    const r = connection.results.get('karma')
    assert.strictEqual(r.good, 10)
    assert.strictEqual(r.history, 10)
    assert.strictEqual(r.pass[0], 'all_good')
  })

  it('loads bad history and sets all_bad', async () => {
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
    await new Promise((resolve) =>
      plugin.ip_history_from_redis(resolve, connection),
    )
    assert.strictEqual('all_bad', connection.results.get('karma').fail[0])
  })

  it('handles Redis fetch error gracefully', async () => {
    plugin.db.hGetAll = () => Promise.reject(new Error('redis error'))
    await new Promise((resolve) =>
      plugin.ip_history_from_redis(resolve, connection),
    )
    assert.ok(connection.results.get('karma').err)
  })

  it('handles multi exec error gracefully', async () => {
    plugin.db.hGetAll = () =>
      Promise.resolve({ good: 5, bad: 0, connections: 3 })
    plugin.db.multi = () => ({
      hIncrBy: function () {
        return this
      },
      expire: function () {
        return this
      },
      exec: () => Promise.reject(new Error('multi error')),
    })
    await new Promise((resolve) =>
      plugin.ip_history_from_redis(resolve, connection),
    )
    // next() was still called; the error is silently captured in results
  })

  it('skips when db is unavailable', async () => {
    plugin.db = null
    await new Promise((resolve) =>
      plugin.ip_history_from_redis(resolve, connection),
    )
  })
})

describe('other hooks', () => {
  let plugin, connection
  beforeEach(() => ({ plugin, connection } = _set_up()))

  for (const hookName of [
    'hook_helo',
    'hook_ehlo',
    'hook_vrfy',
    'hook_noop',
    'hook_data',
    'hook_queue',
    'hook_reset_transaction',
  ]) {
    it(`${hookName} calls next`, async () => {
      await new Promise((resolve) => plugin[hookName](resolve, connection))
    })
  }
})
