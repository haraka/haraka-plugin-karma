'use strict'

const assert = require('assert')

const Address = require('address-rfc2821').Address
const fixtures = require('haraka-test-fixtures')
const constants = require('haraka-constants')

const stub = fixtures.stub.stub

function _set_up(done) {
  this.plugin = new fixtures.plugin('karma')

  this.plugin.cfg = { main: {} }
  this.plugin.deny_hooks = { connect: true }
  this.plugin.tarpit_hooks = ['connect']

  this.connection = fixtures.connection.createConnection({}, { notes: {} })
  this.connection.transaction = fixtures.transaction.createTransaction()

  done()
}

describe('karma_init', function () {
  beforeEach(function (done) {
    this.plugin = new fixtures.plugin('karma')
    done()
  })

  it('load_karma_ini', function (done) {
    this.plugin.inherits('haraka-plugin-redis')
    this.plugin.load_karma_ini()
    assert.ok(this.plugin.cfg.asn)
    assert.ok(this.plugin.deny_hooks)
    done()
  })
})

describe('results_init', function () {
  beforeEach(_set_up)

  it('init, pre', function (done) {
    const r = this.connection.results.get('karma')
    assert.equal(undefined, r)
    done()
  })

  it('init, empty cfg', function (done) {
    this.plugin.results_init(stub, this.connection)
    const r = this.connection.results.get('karma')
    assert.ok(r)
    done()
  })

  it('init, cfg', function (done) {
    this.plugin.cfg.awards = { test: 1 }
    this.plugin.results_init(stub, this.connection)
    const r = this.connection.results.get('karma')
    assert.ok(r)
    assert.ok(r.todo)
    done()
  })

  it('init, skip', function (done) {
    this.connection.remote.is_private = true
    this.plugin.results_init(stub, this.connection)
    const r = this.connection.results.get('karma')
    assert.equal(undefined, r)
    done()
  })

  it('init, private skip', function (done) {
    this.connection.notes.disable_karma = true
    this.plugin.results_init(stub, this.connection)
    const r = this.connection.results.get('karma')
    assert.equal(undefined, r)
    done()
  })
})

describe('assemble_note_obj', function () {
  beforeEach(_set_up)

  it('no auth fails', function (done) {
    const obj = this.plugin.assemble_note_obj(
      this.connection,
      'notes.auth_fails',
    )
    assert.equal(undefined, obj)
    done()
  })

  it('has auth fails', function (done) {
    this.connection.notes.auth_fails = [1, 2]
    const obj = this.plugin.assemble_note_obj(
      this.connection,
      'notes.auth_fails',
    )
    assert.deepEqual([1, 2], obj)
    done()
  })
})

describe('hook_deny', function () {
  beforeEach(_set_up)

  it('no params', function (done) {
    const next = function (rc) {
      assert.equal(constants.OK, rc, rc)
      done()
    }
    this.plugin.hook_deny(next, this.connection, ['', '', '', ''])
  })

  it('pi_name=karma', function (done) {
    const next = function (rc) {
      assert.equal(undefined, rc)
      done()
    }
    this.plugin.hook_deny(next, this.connection, ['', '', 'karma', ''])
  })

  it('pi_name=access', function (done) {
    const next = function (rc) {
      assert.equal(undefined, rc)
      done()
    }
    this.plugin.deny_exclude_plugins = { access: true }
    this.plugin.hook_deny(next, this.connection, ['', '', 'access', ''])
  })

  it('pi_hook=rcpt_to', function (done) {
    const next = function (rc) {
      assert.equal(undefined, rc)
      done()
    }
    this.plugin.deny_exclude_hooks = { rcpt_to: true }
    this.plugin.hook_deny(next, this.connection, [
      '',
      '',
      '',
      '',
      '',
      'rcpt_to',
    ])
  })

  it('pi_hook=queue', function (done) {
    const next = function (rc) {
      assert.equal(undefined, rc)
      done()
    }
    this.plugin.deny_exclude_hooks = { queue: true }
    this.plugin.hook_deny(next, this.connection, ['', '', '', '', '', 'queue'])
  })

  it('denysoft', function (done) {
    const next = function (rc) {
      assert.equal(constants.OK, rc)
      done()
    }
    this.plugin.hook_deny(next, this.connection, [
      constants.DENYSOFT,
      '',
      '',
      '',
      '',
      '',
    ])
  })
})

describe('get_award_location', function () {
  beforeEach(_set_up)

  it('relaying=false', function (done) {
    this.connection.relaying = false
    const r = this.plugin.get_award_location(this.connection, 'relaying')
    assert.equal(false, r)
    done()
  })

  it('relaying=true', function (done) {
    this.connection.relaying = true
    const r = this.plugin.get_award_location(this.connection, 'relaying')
    assert.equal(true, r)
    done()
  })

  it('notes.undef=2', function (done) {
    const r = this.plugin.get_award_location(this.connection, 'notes.undef')
    assert.equal(undefined, r)
    done()
  })

  it('notes.tarpit=2', function (done) {
    this.connection.notes = { tarpit: 2 }
    const r = this.plugin.get_award_location(this.connection, 'notes.tarpit')
    assert.equal(2, r)
    done()
  })

  it('results.geoip', function (done) {
    this.connection.results.add('geoip', { country: 'US' })
    const r = this.plugin.get_award_location(this.connection, 'results.geoip')
    // console.log(r);
    assert.equal('US', r.country)
    done()
  })

  it('results.karma', function (done) {
    this.connection.results.add('karma', { score: -1 })
    const r = this.plugin.get_award_location(this.connection, 'results.karma')
    // console.log(r);
    assert.equal(-1, r.score)
    done()
  })

  it('results.karma, txn', function (done) {
    // results should be found in conn or txn
    this.connection.transaction.results.add('karma', { score: -1 })
    const r = this.plugin.get_award_location(this.connection, 'results.karma')
    // console.log(r);
    assert.equal(-1, r.score)
    done()
  })

  it('txn.results.karma', function (done) {
    // these results shouldn't be found, b/c txn specified
    this.connection.results.add('karma', { score: -1 })
    const r = this.plugin.get_award_location(
      this.connection,
      'transaction.results.karma',
    )
    // console.log(r);
    assert.equal(undefined, r)
    done()
  })

  it('results.auth/auth_base', function (done) {
    this.connection.results.add('auth/auth_base', { fail: 'PLAIN' })
    const r = this.plugin.get_award_location(
      this.connection,
      'results.auth/auth_base',
    )
    assert.equal('PLAIN', r.fail[0])
    done()
  })
})

describe('get_award_condition', function () {
  beforeEach(_set_up)
  it('geoip.distance', function (done) {
    assert.equal(
      4000,
      this.plugin.get_award_condition(
        'results.geoip.distance@4000',
        '-1 if gt',
      ),
    )
    assert.equal(
      4000,
      this.plugin.get_award_condition(
        'results.geoip.distance@uniq',
        '-1 if gt 4000',
      ),
    )
    done()
  })

  it('auth/auth_base', function (done) {
    assert.equal(
      'plain',
      this.plugin.get_award_condition(
        'results.auth/auth_base.fail@plain',
        '-1 if in',
      ),
    )
    done()
  })
})

describe('check_awards', function () {
  beforeEach(_set_up)

  it('no results', function (done) {
    const r = this.plugin.check_awards(this.connection)
    assert.equal(undefined, r)
    done()
  })

  it('no todo', function (done) {
    this.connection.results.add('karma', { todo: {} })
    const r = this.plugin.check_awards(this.connection)
    assert.equal(undefined, r)
    done()
  })

  it('geoip gt', function (done) {
    // populate the karma result with a todo item
    this.connection.results.add('karma', {
      todo: { 'results.geoip.distance@4000': '-1 if gt 4000' },
    })
    // test a non-matching criteria
    this.connection.results.add('geoip', { distance: 4000 })
    // check awards
    this.plugin.check_awards(this.connection)
    assert.equal(undefined, this.connection.results.get('karma').fail[0])

    // test a matching criteria
    this.connection.results.add('geoip', { distance: 4001 })
    // check awards
    this.plugin.check_awards(this.connection)
    // test that the award was applied
    assert.equal('geoip.distance', this.connection.results.get('karma').fail[0])

    done()
  })

  it('auth failure', function (done) {
    this.connection.results.add('karma', {
      todo: { 'results.auth/auth_base.fail@PLAIN': '-1 if in' },
    })
    this.connection.results.add('auth/auth_base', { fail: 'PLAIN' })
    const r = this.plugin.check_awards(this.connection)
    assert.equal(undefined, r)
    assert.equal(
      'auth/auth_base.fail',
      this.connection.results.get('karma').fail[0],
    )
    done()
  })

  it('valid recipient', function (done) {
    this.connection.results.add('karma', {
      todo: { 'results.rcpt_to.qmd.pass@exist': '1 if in' },
    })
    this.connection.results.add('rcpt_to.qmd', { pass: 'exist' })
    const r = this.plugin.check_awards(this.connection)
    assert.equal(undefined, r)
    assert.equal('qmd.pass', this.connection.results.get('karma').pass[0])
    done()
  })
})

describe('apply_tarpit', function () {
  beforeEach(_set_up)

  it('tarpit=false', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.apply_tarpit(this.connection, 'connect', 0, next)
  })

  it('tarpit=true, score=0', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.plugin.apply_tarpit(this.connection, 'connect', 0, next)
  })

  it('tarpit=true, score=1', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.plugin.apply_tarpit(this.connection, 'connect', 1, next)
  })

  it('tarpit=true, score=-1', function (done) {
    const before = Date.now()
    const next = function (rc, msg) {
      assert.ok(Date.now() >= before + 1)
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.plugin.apply_tarpit(this.connection, 'connect', -1, next)
  })

  it('tarpit=true, score=-2, max=1', function (done) {
    const before = Date.now()
    const next = function (rc, msg) {
      assert.ok(Date.now() >= before + 1)
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.plugin.apply_tarpit(this.connection, 'connect', -2, next)
  })

  it('tarpit=true, score=connect, max=1', function (done) {
    const before = Date.now()
    const next = function (rc, msg) {
      assert.ok(Date.now() >= before + 1)
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.connection.results.add(this.plugin, { score: -2 })
    this.plugin.apply_tarpit(this.connection, 'connect', -2, next)
  })
})

describe('should_we_deny', function () {
  beforeEach(_set_up)

  it('no results', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.plugin.should_we_deny(next, this.connection, 'connect')
  })

  it('no score', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.connection.results.add(this.plugin, { test: 'blah' })
    this.plugin.should_we_deny(next, this.connection, 'connect')
  })

  it('invalid score', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }
    this.connection.results.add(this.plugin, { score: 'blah' })
    this.plugin.should_we_deny(next, this.connection, 'connect')
  })

  it('valid score, okay', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }.bind(this)
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.connection.results.add(this.plugin, { score: -1 })
    this.plugin.should_we_deny(next, this.connection, 'connect')
  })

  it('valid score, -6, deny_hook', function (done) {
    const next = function (rc, msg) {
      assert.equal(constants.DENY, rc)
      assert.ok(msg)
      done()
    }.bind(this)
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.plugin.deny_hooks = { connect: true }
    this.connection.results.add(this.plugin, { score: -6 })
    this.plugin.should_we_deny(next, this.connection, 'connect')
  })

  it('valid score, -6, pass_hook', function (done) {
    const next = function (rc, msg) {
      assert.equal(undefined, rc)
      assert.equal(undefined, msg)
      done()
    }.bind(this)
    this.plugin.cfg.tarpit = { max: 1, delay: 0 }
    this.plugin.deny_hooks = { helo: true }
    this.connection.results.add(this.plugin, { score: -6 })
    this.plugin.should_we_deny(next, this.connection, 'connect')
  })
})

describe('check_result_equal', function () {
  beforeEach(_set_up)

  it('equal match is scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'equals',
      value: 'clean',
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_equal(['clean'], award, this.connection)
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('not equal match is not scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'equals',
      value: 'dirty',
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_equal(['clean'], award, this.connection)
    assert.equal(this.connection.results.store.karma, undefined)
    done()
  })
})

describe('check_result_gt', function () {
  beforeEach(_set_up)

  it('gt match is scored', function (done) {
    const award = {
      id: 5,
      award: 3,
      operator: 'gt',
      value: 3,
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_gt([4], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 3)
    assert.equal(this.connection.results.store.karma.awards[0], 5)
    done()
  })
})

describe('check_result_lt', function () {
  beforeEach(_set_up)

  it('lt match is scored', function (done) {
    const award = {
      id: 2,
      award: 3,
      operator: 'lt',
      value: 5,
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_lt([4], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 3)
    assert.equal(this.connection.results.store.karma.awards[0], 2)
    done()
  })

  it('lt match not scored', function (done) {
    const award = {
      id: 3,
      award: 3,
      operator: 'lt',
      value: 3,
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_lt([4], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma, undefined)
    done()
  })
})

describe('check_result_match', function () {
  beforeEach(_set_up)

  it('match pattern is scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'match',
      value: 'phish',
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_match(['isphishing'], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('mismatch is not scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'match',
      value: 'dirty',
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_match(['clean'], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma, undefined)
    done()
  })

  it('FCrDNS match is scored', function (done) {
    const award = {
      id: 89,
      award: 2,
      operator: 'match',
      value: 'google.com',
      reason: 'testing',
      resolution: 'never',
    }
    this.plugin.check_result_match(
      ['mail-yk0-f182.google.com'],
      award,
      this.connection,
    )
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 89)
    done()
  })
})

describe('check_result_length', function () {
  beforeEach(_set_up)
  it('eq pattern is scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'eq 3',
      reason: 'testing',
      resolution: 'hah',
    }
    this.plugin.check_result_length(['3'], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('eq pattern is not scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'eq 3',
      reason: 'testing',
      resolution: 'hah',
    }
    this.plugin.check_result_length(['4'], award, this.connection)
    // console.log(this.connection.results.store.karma);
    assert.deepEqual(this.connection.results.store.karma, undefined)
    done()
  })

  it('gt pattern is scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'gt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    this.plugin.check_result_length(['5'], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('gt pattern is not scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'gt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    this.plugin.check_result_length(['3'], award, this.connection)
    // console.log(this.connection.results.store.karma);
    assert.deepEqual(this.connection.results.store.karma, undefined)
    done()
  })

  it('lt pattern is scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'lt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    this.plugin.check_result_length(['2'], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('lt pattern is not scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'length',
      value: 'lt 3',
      reason: 'testing',
      resolution: 'hah',
    }
    this.plugin.check_result_length(['3'], award, this.connection)
    // console.log(this.connection.results.store.karma);
    assert.deepEqual(this.connection.results.store.karma, undefined)
    done()
  })
})

describe('check_result_exists', function () {
  beforeEach(_set_up)

  it('exists pattern is scored', function (done) {
    const award = {
      id: 1,
      award: 2,
      operator: 'exists',
      value: 'any',
      reason: 'testing',
      resolution: 'high five',
    }
    this.plugin.check_result_exists(['3'], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('not exists pattern is not scored', function (done) {
    const award = {
      id: 1,
      award: 3,
      operator: 'exists',
      value: '',
      reason: 'testing',
      resolution: 'misses',
    }
    this.plugin.check_result_exists([], award, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma, undefined)
    assert.equal(this.connection.results.store.karma, undefined)
    done()
  })
})

describe('check_result', function () {
  beforeEach(_set_up)

  it('geoip country is scored', function (done) {
    this.plugin.cfg.result_awards = {
      1: 'geoip | country | equals | CN | 2',
    }
    this.plugin.preparse_result_awards()
    this.connection.results.add({ name: 'geoip' }, { country: 'CN' })
    this.plugin.check_result(
      this.connection,
      '{"plugin":"geoip","result":{"country":"CN"}}',
    )
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, 2)
    assert.equal(this.connection.results.store.karma.awards[0], 1)
    done()
  })

  it('dnsbl listing is scored', function (done) {
    this.plugin.cfg.result_awards = {
      2: 'dnsbl | fail | equals | dnsbl.sorbs.net | -5',
    }
    this.plugin.preparse_result_awards()
    this.connection.results.add({ name: 'dnsbl' }, { fail: 'dnsbl.sorbs.net' })
    this.plugin.check_result(
      this.connection,
      '{"plugin":"dnsbl","result":{"fail":"dnsbl.sorbs.net"}}',
    )
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, -5)
    assert.equal(this.connection.results.store.karma.awards[0], 2)
    done()
  })
})

describe('check_spammy_tld', function () {
  beforeEach(_set_up)

  it('spammy TLD is scored: top', function (done) {
    this.plugin.cfg.spammy_tlds = { top: -3 }
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    this.plugin.check_spammy_tld(mfrom, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, -3)
    assert.equal(this.connection.results.store.karma.fail[0], 'spammy.TLD')
    done()
  })

  it('spammy TLD is scored: rocks', function (done) {
    this.plugin.cfg.spammy_tlds = { rocks: '-2' }
    const mfrom = new Address('spamy@foo.rocks')
    this.plugin.check_spammy_tld(mfrom, this.connection)
    // console.log(this.connection.results.store);
    assert.equal(this.connection.results.store.karma.score, -2)
    assert.equal(this.connection.results.store.karma.fail[0], 'spammy.TLD')
    done()
  })
})

describe('tls', function () {
  beforeEach(_set_up)

  it('unconfigured TLS does nothing', function (done) {
    this.connection.tls.enabled = true
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    this.connection.current_line = 'MAIL FROM:<foo@test.com>'
    this.plugin.hook_mail(
      () => {
        assert.equal(this.connection.results.store.karma, undefined)
        done()
      },
      this.connection,
      [mfrom],
    )
  })

  it('TLS is scored', function (done) {
    this.plugin.cfg.tls = { set: 2, unset: -4 }
    this.connection.tls.enabled = true
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    this.connection.current_line = 'MAIL FROM:<foo@test.com>'
    this.plugin.hook_mail(
      () => {
        // console.log(this.connection.results.store);
        assert.equal(this.connection.results.store.karma.score, 2)
        done()
      },
      this.connection,
      [mfrom],
    )
  })

  it('no TLS is scored', function (done) {
    this.plugin.cfg.tls = { set: 2, unset: -4 }
    this.connection.tls.enabled = false
    const mfrom = new Address('spamy@er7diogt.rrnsale.top')
    this.connection.current_line = 'MAIL FROM:<foo@test.com>'
    this.plugin.hook_mail(
      () => {
        // console.log(this.connection.results.store);
        assert.equal(this.connection.results.store.karma.score, -4)
        done()
      },
      this.connection,
      [mfrom],
    )
  })
})

describe('skipping hooks', function () {
  beforeEach(_set_up)

  it('notes.disable_karma', function (done) {
    function next(rc) {
      assert.equal(undefined, rc)
    }
    function last(rc) {
      assert.equal(undefined, rc)
      done()
    }
    this.connection.notes.disable_karma = true

    this.plugin.hook_deny(next, this.connection)
    this.plugin.hook_connect(next, this.connection)
    this.plugin.hook_ehlo(next, this.connection)
    this.plugin.hook_vrfy(next, this.connection)
    this.plugin.hook_noop(next, this.connection)
    this.plugin.hook_data(next, this.connection)
    this.plugin.hook_queue(next, this.connection)
    this.plugin.hook_reset_transaction(next, this.connection)
    this.plugin.hook_unrecognized_command(last, this.connection)
  })

  it('private skip', function (done) {
    function next(rc) {
      assert.equal(undefined, rc)
    }
    function last(rc) {
      assert.equal(undefined, rc)
      done()
    }
    this.connection.remote.is_private = true

    this.plugin.hook_deny(next, this.connection)
    this.plugin.hook_connect(next, this.connection)
    this.plugin.hook_ehlo(next, this.connection)
    this.plugin.hook_vrfy(next, this.connection)
    this.plugin.hook_noop(next, this.connection)
    this.plugin.hook_data(next, this.connection)
    this.plugin.hook_queue(next, this.connection)
    this.plugin.hook_reset_transaction(next, this.connection)
    this.plugin.hook_unrecognized_command(last, this.connection)
  })
})
