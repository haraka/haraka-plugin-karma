'use strict'
// karma - reward good and penalize bad mail senders

const constants = require('haraka-constants')
const redis = require('redis')
const utils = require('haraka-utils')

const phase_prefixes = utils.to_object([
  'connect',
  'helo',
  'mail_from',
  'rcpt_to',
  'data',
])

exports.register = function () {
  this.inherits('haraka-plugin-redis')

  // set up defaults
  this.deny_hooks = utils.to_object([
    'unrecognized_command',
    'helo',
    'data',
    'data_post',
    'queue',
    'queue_outbound',
  ])
  this.deny_exclude_hooks = utils.to_object('rcpt_to queue queue_outbound')
  this.deny_exclude_plugins = utils.to_object([
    'access',
    'helo.checks',
    'data.headers',
    'spamassassin',
    'mail_from.is_resolvable',
    'clamd',
    'tls',
  ])

  this.load_karma_ini()

  this.register_hook('init_master', 'init_redis_plugin')
  this.register_hook('init_child', 'init_redis_plugin')

  this.register_hook('connect_init', 'results_init')
  this.register_hook('connect_init', 'ip_history_from_redis')
}

exports.load_karma_ini = function () {
  const plugin = this

  plugin.cfg = plugin.config.get(
    'karma.ini',
    {
      booleans: ['+asn.enable'],
    },
    function () {
      plugin.load_karma_ini()
    },
  )

  plugin.merge_redis_ini()

  const cfg = plugin.cfg
  if (cfg.deny && cfg.deny.hooks) {
    plugin.deny_hooks = utils.to_object(cfg.deny.hooks)
  }

  const e = cfg.deny_excludes
  if (e && e.hooks) {
    plugin.deny_exclude_hooks = utils.to_object(e.hooks)
  }

  if (e && e.plugins) {
    plugin.deny_exclude_plugins = utils.to_object(e.plugins)
  }

  if (cfg.result_awards) {
    plugin.preparse_result_awards()
  }

  if (!cfg.redis) cfg.redis = {}
  if (!cfg.redis.host && cfg.redis.server_ip) {
    cfg.redis.host = cfg.redis.server_ip // backwards compat
  }
  if (!cfg.redis.port && cfg.redis.server_port) {
    cfg.redis.port = cfg.redis.server_port // backwards compat
  }
}

exports.results_init = async function (next, connection) {
  if (this.should_we_skip(connection)) {
    connection.logdebug(this, 'skipping')
    return next()
  }

  if (connection.results.get('karma')) {
    connection.logerror(this, 'this should never happen')
    return next() // init once per connection
  }

  if (this.cfg.awards) {
    // todo is a list of connection/transaction awards to 'watch' for.
    // When discovered, apply the awards value
    const todo = {}
    for (const key in this.cfg.awards) {
      const award = this.cfg.awards[key].toString()
      todo[key] = award
    }
    connection.results.add(this, { score: 0, todo })
  } else {
    connection.results.add(this, { score: 0 })
  }

  if (!connection.server.notes.redis) {
    connection.logerror(this, 'karma requires the redis plugin')
    return next()
  }

  if (!this.result_awards) return next() // not configured

  if (connection.notes.redis) {
    connection.logdebug(this, `redis already subscribed`)
    return // another plugin has already called this.
  }

  connection.notes.redis = redis.createClient(this.redisCfg.pubsub)
  connection.notes.redis.on('error', (err) => {
    connection.logerror(this, err.message)
  })
  await connection.notes.redis.connect()

  const pattern = this.get_redis_sub_channel(connection)
  connection.notes.redis.pSubscribe(pattern, (message) => {
    this.check_result(connection, message)
  })

  next()
}

exports.preparse_result_awards = function () {
  if (!this.result_awards) this.result_awards = {}

  const cra = this.cfg.result_awards
  // arrange results for rapid traversal by check_result() :
  // ex: karma.result_awards.clamd.fail = { .... }
  for (const anum of Object.keys(cra)) {
    const [pi_name, prop, operator, value, award, reason, resolv] =
      cra[anum].split(/(?:\s*\|\s*)/)

    const ra = this.result_awards

    if (!ra[pi_name]) ra[pi_name] = {}

    if (!ra[pi_name][prop]) ra[pi_name][prop] = []

    ra[pi_name][prop].push({ id: anum, operator, value, award, reason, resolv })
  }
}

exports.check_result = function (connection, message) {
  // connection.loginfo(this, message);
  // {"plugin":"karma","result":{"fail":"spamassassin.hits"}}
  // {"plugin":"geoip","result":{"country":"CN"}}

  const m = JSON.parse(message)
  if (m && m.result && m.result.asn) {
    this.check_result_asn(m.result.asn, connection)
  }
  if (!this.result_awards[m.plugin]) return // no awards for plugin

  for (const r of Object.keys(m.result)) {
    // each result in mess
    if (r === 'emit') continue // r: pass, fail, skip, err, ...

    const pi_prop = this.result_awards[m.plugin][r]
    if (!pi_prop) continue // no award for this plugin property

    const thisResult = m.result[r]
    // ignore empty arrays, objects, and strings
    if (Array.isArray(thisResult) && thisResult.length === 0) continue
    if (typeof thisResult === 'object' && !Object.keys(thisResult).length) {
      continue
    }
    if (typeof thisResult === 'string' && !thisResult) continue // empty

    // do any award conditions match this result?
    for (const thisAward of pi_prop) {
      // each award...
      // { id: '011', operator: 'equals', value: 'all_bad', award: '-2'}
      const thisResArr = this.result_as_array(thisResult)
      switch (thisAward.operator) {
        case 'eq':
        case 'equal':
        case 'equals':
          this.check_result_equal(thisResArr, thisAward, connection)
          break
        case 'match':
          this.check_result_match(thisResArr, thisAward, connection)
          break
        case 'lt':
          this.check_result_lt(thisResArr, thisAward, connection)
          break
        case 'gt':
          this.check_result_gt(thisResArr, thisAward, connection)
          break
        case 'length':
          this.check_result_length(thisResArr, thisAward, connection)
          break
      }
    }
  }
}

exports.result_as_array = function (result) {
  if (typeof result === 'string') return [result]
  if (typeof result === 'number') return [result]
  if (typeof result === 'boolean') return [result]
  if (Array.isArray(result)) return result
  if (typeof result === 'object') {
    const array = []
    Object.keys(result).forEach((tr) => {
      array.push(result[tr])
    })
    return array
  }
  this.loginfo(`what format is result: ${result}`)
  return result
}

exports.check_result_asn = function (asn, conn) {
  if (!this.cfg.asn_awards) return
  if (!this.cfg.asn_awards[asn]) return

  conn.results.incr(this, { score: this.cfg.asn_awards[asn] })
  conn.results.push(this, { fail: 'asn_awards' })
}

exports.check_result_lt = function (thisResult, thisAward, conn) {
  for (const element of thisResult) {
    const tr = parseFloat(element)
    if (tr >= parseFloat(thisAward.value)) continue
    if (conn.results.has('karma', 'awards', thisAward.id)) continue

    conn.results.incr(this, { score: thisAward.award })
    conn.results.push(this, { awards: thisAward.id })
  }
}

exports.check_result_gt = function (thisResult, thisAward, conn) {
  for (const element of thisResult) {
    const tr = parseFloat(element)
    if (tr <= parseFloat(thisAward.value)) continue
    if (conn.results.has('karma', 'awards', thisAward.id)) continue

    conn.results.incr(this, { score: thisAward.award })
    conn.results.push(this, { awards: thisAward.id })
  }
}

exports.check_result_equal = function (thisResult, thisAward, conn) {
  for (const element of thisResult) {
    if (thisAward.value === 'true') {
      if (!element) continue
    } else {
      if (element != thisAward.value) continue
    }
    if (!/auth/.test(thisAward.plugin)) {
      // only auth attempts are scored > 1x
      if (conn.results.has('karma', 'awards', thisAward.id)) continue
    }

    conn.results.incr(this, { score: thisAward.award })
    conn.results.push(this, { awards: thisAward.id })
  }
}

exports.check_result_match = function (thisResult, thisAward, conn) {
  const re = new RegExp(thisAward.value, 'i')

  for (const element of thisResult) {
    if (!re.test(element)) continue
    if (conn.results.has('karma', 'awards', thisAward.id)) continue

    conn.results.incr(this, { score: thisAward.award })
    conn.results.push(this, { awards: thisAward.id })
  }
}

exports.check_result_length = function (thisResult, thisAward, conn) {
  for (const element of thisResult) {
    const [operator, qty] = thisAward.value.split(/\s+/) // requires node 6+

    switch (operator) {
      case 'eq':
      case 'equal':
      case 'equals':
        if (parseInt(element, 10) != parseInt(qty, 10)) continue
        break
      case 'gt':
        if (parseInt(element, 10) <= parseInt(qty, 10)) continue
        break
      case 'lt':
        if (parseInt(element, 10) >= parseInt(qty, 10)) continue
        break
      default:
        conn.results.add(this, { err: `invalid operator: ${operator}` })
        continue
    }

    conn.results.incr(this, { score: thisAward.award })
    conn.results.push(this, { awards: thisAward.id })
  }
}

exports.check_result_exists = function (thisResult, thisAward, conn) {
  /* eslint-disable no-unused-vars */
  for (const r of thisResult) {
    const [operator, qty] = thisAward.value.split(/\s+/)

    switch (operator) {
      case 'any':
      case '':
        break
      default:
        conn.results.add(this, { err: `invalid operator: ${operator}` })
        continue
    }

    conn.results.incr(this, { score: thisAward.award })
    conn.results.push(this, { awards: thisAward.id })
  }
}

exports.apply_tarpit = function (connection, hook, score, next) {
  if (!this.cfg.tarpit) return next() // tarpit disabled in config

  // If tarpit is enabled on the reset_transaction hook, Haraka doesn't
  // wait. Then bad things happen, like a Haraka crash.
  if (utils.in_array(hook, ['reset_transaction', 'queue'])) return next()

  // no delay for senders with good karma
  const k = connection.results.get('karma')
  if (score === undefined) score = parseFloat(k.score)
  if (score >= 0) return next()

  // how long to delay?
  const delay = this.tarpit_delay(score, connection, hook, k)
  if (!delay) return next()

  connection.logdebug(this, `tarpitting ${hook} for ${delay}s`)
  setTimeout(() => {
    connection.logdebug(this, `tarpit ${hook} end`)
    next()
  }, delay * 1000)
}

exports.tarpit_delay = function (score, connection, hook, k) {
  if (this.cfg.tarpit.delay && parseFloat(this.cfg.tarpit.delay)) {
    connection.logdebug(this, 'static tarpit')
    return parseFloat(this.cfg.tarpit.delay)
  }

  const delay = score * -1 // progressive tarpit

  // detect roaming users based on MSA ports that require auth
  if (
    [587, 465].includes(connection.local.port) &&
    ['ehlo', 'connect'].includes(hook)
  ) {
    return this.tarpit_delay_msa(connection, delay, k)
  }

  const max = this.cfg.tarpit.max || 5
  if (delay > max) {
    connection.logdebug(this, `tarpit capped to: ${max}`)
    return max
  }

  return delay
}

exports.tarpit_delay_msa = function (connection, delay, k) {
  const trg = 'tarpit reduced for good'

  delay = parseFloat(delay)

  // Reduce delay for good history
  const history = (k.good || 0) - (k.bad || 0)
  if (history > 0) {
    delay = delay - 2
    connection.logdebug(this, `${trg} history: ${delay}`)
  }

  // Reduce delay for good ASN history
  let asn = connection.results.get('asn')
  if (!asn) asn = connection.results.get('geoip')
  if (asn && asn.asn && asn.asn_score > 0) {
    connection.logdebug(this, `${trg} neighbors: ${delay}`)
    delay = delay - 2
  }

  const max = this.cfg.tarpit.max_msa || 2
  if (delay > max) {
    connection.logdebug(this, `tarpit capped at: ${delay}`)
    delay = max
  }

  return delay
}

exports.should_we_skip = function (connection) {
  if (connection.remote?.is_private) return true
  if (connection.notes?.disable_karma) return true
  return false
}

exports.should_we_deny = function (next, connection, hook) {
  const r = connection.results.get('karma')
  if (!r) return next()

  this.check_awards(connection) // update awards first

  const score = parseFloat(r.score)
  if (isNaN(score)) {
    connection.logerror(this, 'score is NaN')
    connection.results.add(this, { score: 0 })
    return next()
  }

  let negative_limit = -5
  if (this.cfg.thresholds && this.cfg.thresholds.negative) {
    negative_limit = parseFloat(this.cfg.thresholds.negative)
  }

  if (score > negative_limit) {
    return this.apply_tarpit(connection, hook, score, next)
  }
  if (!this.deny_hooks[hook]) {
    return this.apply_tarpit(connection, hook, score, next)
  }

  let rejectMsg = 'very bad karma score: {score}'
  if (this.cfg.deny && this.cfg.deny.message) {
    rejectMsg = this.cfg.deny.message
  }

  if (/\{/.test(rejectMsg)) {
    rejectMsg = rejectMsg.replace(/\{score\}/, score)
    rejectMsg = rejectMsg.replace(/\{uuid\}/, connection.uuid)
  }

  return this.apply_tarpit(connection, hook, score, () => {
    next(constants.DENY, rejectMsg)
  })
}

exports.hook_deny = function (next, connection, params) {
  if (this.should_we_skip(connection)) return next()

  // let pi_deny     = params[0];  // (constants.deny, denysoft, ok)
  // let pi_message  = params[1];
  const pi_name = params[2]
  // let pi_function = params[3];
  // let pi_params   = params[4];
  const pi_hook = params[5]

  // exceptions, whose 'DENY' should not be captured
  if (pi_name) {
    if (pi_name === 'karma') return next()
    if (this.deny_exclude_plugins[pi_name]) return next()
  }
  if (pi_hook && this.deny_exclude_hooks[pi_hook]) return next()

  if (!connection.results) return next(constants.OK) // resume the connection

  // intercept any other denials
  connection.results.add(this, { msg: `deny: ${pi_name}` })
  connection.results.incr(this, { score: -2 })

  next(constants.OK) // resume the connection
}

exports.hook_connect = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  const asnkey = this.get_asn_key(connection)
  if (asnkey) {
    this.check_asn(connection, asnkey)
  }
  this.should_we_deny(next, connection, 'connect')
}

exports.hook_helo = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'helo')
}

exports.hook_ehlo = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'ehlo')
}

exports.hook_vrfy = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'vrfy')
}

exports.hook_noop = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'noop')
}

exports.hook_data = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'data')
}

exports.hook_queue = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'queue')
}

exports.hook_queue_outbound = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.should_we_deny(next, connection, 'queue_outbound')
}

exports.hook_reset_transaction = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  connection.results.add(this, { emit: true })
  this.should_we_deny(next, connection, 'reset_transaction')
}

exports.hook_unrecognized_command = function (next, connection, params) {
  if (this.should_we_skip(connection)) return next()

  // in case karma is in config/plugins before tls
  if (params[0].toUpperCase() === 'STARTTLS') return next()

  // in case karma is in config/plugins before AUTH plugin(s)
  if (connection.notes.authenticating) return next()

  connection.results.incr(this, { score: -1 })
  connection.results.add(this, { fail: `cmd:(${params})` })

  return this.should_we_deny(next, connection, 'unrecognized_command')
}

exports.ip_history_from_redis = function (next, connection) {
  const plugin = this

  if (this.should_we_skip(connection)) return next()

  const expire = (this.cfg.redis.expire_days || 60) * 86400 // to days
  const dbkey = `karma|${connection.remote.ip}`

  // redis plugin is emitting errors, no need to here
  if (!this.db) return next()

  this.db
    .hGetAll(dbkey)
    .then((dbr) => {
      if (dbr === null) {
        plugin.init_ip(dbkey, connection.remote.ip, expire)
        return next()
      }

      plugin.db
        .multi()
        .hIncrBy(dbkey, 'connections', 1) // increment total conn
        .expire(dbkey, expire) // extend expiration
        .exec()
        .catch((err) => {
          connection.results.add(plugin, { err })
        })

      const results = {
        good: dbr.good,
        bad: dbr.bad,
        connections: dbr.connections,
        history: parseInt((dbr.good || 0) - (dbr.bad || 0)),
        emit: true,
      }

      // Careful: don't become self-fulfilling prophecy.
      if (parseInt(dbr.good) > 5 && parseInt(dbr.bad) === 0) {
        results.pass = 'all_good'
      }
      if (parseInt(dbr.bad) > 5 && parseInt(dbr.good) === 0) {
        results.fail = 'all_bad'
      }

      connection.results.add(plugin, results)

      plugin.check_awards(connection)
      next()
    })
    .catch((err) => {
      connection.results.add(plugin, { err })
      next()
    })
}

exports.hook_mail = function (next, connection, params) {
  if (this.should_we_skip(connection)) return next()

  this.check_spammy_tld(params[0], connection)

  // look for invalid (RFC 5321,(2)821) space in envelope from
  const full_from = connection.current_line
  if (full_from.toUpperCase().substring(0, 11) !== 'MAIL FROM:<') {
    connection.loginfo(this, `RFC ignorant env addr format: ${full_from}`)
    connection.results.add(this, { fail: 'rfc5321.MailFrom' })
  }

  // apply TLS awards (if defined)
  if (this.cfg.tls !== undefined) {
    if (this.cfg.tls.set && connection.tls.enabled) {
      connection.results.incr(this, { score: this.cfg.tls.set })
    }
    if (this.cfg.tls.unset && !connection.tls.enabled) {
      connection.results.incr(this, { score: this.cfg.tls.unset })
    }
  }

  return this.should_we_deny(next, connection, 'mail')
}

exports.hook_rcpt = function (next, connection, params) {
  if (this.should_we_skip(connection)) return next()

  const rcpt = params[0]

  // hook_rcpt    catches recipients that no rcpt_to plugin permitted
  // hook_rcpt_ok catches accepted recipients

  // odds of from_user=rcpt_user in ham: < 1%, in spam > 40%
  // 2015-05 30-day sample: 84% spam correlation
  if (connection?.transaction?.mail_from?.user === rcpt.user) {
    connection.results.add(this, { fail: 'env_user_match' })
  }

  this.check_syntax_RcptTo(connection)

  connection.results.add(this, { fail: 'rcpt_to' })

  return this.should_we_deny(next, connection, 'rcpt')
}

exports.hook_rcpt_ok = function (next, connection, rcpt) {
  if (this.should_we_skip(connection)) return next()

  const txn = connection.transaction
  if (txn && txn.mail_from && txn.mail_from.user === rcpt.user) {
    connection.results.add(this, { fail: 'env_user_match' })
  }

  this.check_syntax_RcptTo(connection)

  return this.should_we_deny(next, connection, 'rcpt')
}

exports.hook_data_post = function (next, connection) {
  // goal: prevent delivery of spam before queue

  if (this.should_we_skip(connection)) return next()

  /*
  This should not be a default due to highly probability of false positives,
  but I've found it extremely effective against a recent (most of 2024) spam
  campaign that Gmail apparently has no interest in stopping.
  if (connection.transaction.header.get_decoded('subject').match(/\p{Emoji}/gu)) {
    connection.results.add(this, { msg: 'subject_contains_emoji' })
    if (connection.transaction.mail_from.host === 'gmail.com') {
      connection.results.incr(this, { score: -10 })
      connection.results.add(this, { msg: 'emoji_from_gmail' })
    }
  }
  */

  this.check_awards(connection) // update awards

  const results = connection.results.collate(this)
  connection.logdebug(this, `adding header: ${results}`)
  connection.transaction.remove_header('X-Haraka-Karma')
  connection.transaction.add_header('X-Haraka-Karma', results)

  return this.should_we_deny(next, connection, 'data_post')
}

exports.increment = function (connection, key, val) {
  if (!this.db) return

  this.db.hIncrBy(`karma|${connection.remote.ip}`, key, 1)

  const asnkey = this.get_asn_key(connection)
  if (asnkey) this.db.hIncrBy(asnkey, key, 1)
}

exports.hook_disconnect = function (next, connection) {
  if (this.should_we_skip(connection)) return next()

  this.redis_unsubscribe(connection)

  const k = connection.results.get('karma')
  if (!k || k.score === undefined) {
    connection.results.add(this, { err: 'karma results missing' })
    return next()
  }

  if (!this.cfg.thresholds) {
    this.check_awards(connection)
    connection.results.add(this, { msg: 'no action', emit: true })
    return next()
  }

  if (k.score > (this.cfg.thresholds.positive || 3)) {
    this.increment(connection, 'good', 1)
  }
  if (k.score < 0) {
    this.increment(connection, 'bad', 1)
  }

  connection.results.add(this, { emit: true })
  next()
}

exports.get_award_loc_from_note = function (connection, award) {
  if (connection.transaction) {
    const obj = this.assemble_note_obj(connection.transaction, award)
    if (obj) return obj
  }

  // connection.logdebug(this, `no txn note: ${award}`);
  const obj = this.assemble_note_obj(connection, award)
  if (obj) return obj

  // connection.logdebug(this, `no conn note: ${award}`);
  return
}

exports.get_award_loc_from_results = function (connection, loc_bits) {
  let pi_name = loc_bits[1]
  let notekey = loc_bits[2]

  if (phase_prefixes[pi_name]) {
    pi_name = `${loc_bits[1]}.${loc_bits[2]}`
    notekey = loc_bits[3]
  }

  let obj
  if (connection.transaction) obj = connection.transaction.results.get(pi_name)

  // connection.logdebug(this, `no txn results: ${pi_name}`);
  if (!obj) obj = connection.results.get(pi_name)
  if (!obj) return

  // connection.logdebug(this, `found results for ${pi_name}, ${notekey}`);
  if (notekey) return obj[notekey]
  return obj
}

exports.get_award_location = function (connection, award_key) {
  // based on award key, find the requested note or result
  const bits = award_key.split('@')
  const loc_bits = bits[0].split('.')
  if (loc_bits.length === 1) return connection[bits[0]] // ex: relaying

  if (loc_bits[0] === 'notes') {
    // ex: notes.spf_mail_helo
    return this.get_award_loc_from_note(connection, bits[0])
  }

  if (loc_bits[0] === 'results') {
    // ex: results.geoip.distance
    return this.get_award_loc_from_results(connection, loc_bits)
  }

  // ex: transaction.results.spf
  if (
    connection.transaction &&
    loc_bits[0] === 'transaction' &&
    loc_bits[1] === 'results'
  ) {
    loc_bits.shift()
    return this.get_award_loc_from_results(connection.transaction, loc_bits)
  }

  connection.logdebug(this, `unknown location for ${award_key}`)
}

exports.get_award_condition = function (note_key, note_val) {
  let wants
  const keybits = note_key.split('@')
  if (keybits[1]) {
    wants = keybits[1]
  }

  const valbits = note_val.split(/\s+/)
  if (!valbits[1]) return wants
  if (valbits[1] !== 'if') return wants // no if condition

  if (valbits[2].match(/^(equals|gt|lt|match)$/)) {
    if (valbits[3]) wants = valbits[3]
  }
  return wants
}

exports.check_awards = function (connection) {
  const karma = connection.results.get('karma')
  if (!karma?.todo) return

  for (const key in karma.todo) {
    //     loc                     =     terms
    // note_location [@wants]      = award [conditions]
    // results.geoip.too_far       = -1
    // results.geoip.distance@4000 = -1 if gt 4000
    const award_terms = karma.todo[key]

    const note = this.get_award_location(connection, key)
    if (note === undefined) continue
    let wants = this.get_award_condition(key, award_terms)

    // test the desired condition
    const bits = award_terms.split(/\s+/)
    const award = parseFloat(bits[0])
    if (!bits[1] || bits[1] !== 'if') {
      // no if conditions
      if (!note) continue // failed truth test
      if (!wants) {
        // no wants, truth matches
        this.apply_award(connection, key, award)
        delete karma.todo[key]
        continue
      }
      if (note !== wants) continue // didn't match
    }

    // connection.loginfo(this, `check_awards, case matching for: ${wants}`

    // the matching logic here is inverted, weeding out misses (continue)
    // Matches fall through (break) to the apply_award below.
    const condition = bits[2]
    switch (condition) {
      case 'equals':
        if (wants != note) continue
        break
      case 'gt':
        if (parseFloat(note) <= parseFloat(wants)) continue
        break
      case 'lt':
        if (parseFloat(note) >= parseFloat(wants)) continue
        break
      case 'match':
        if (Array.isArray(note)) {
          // connection.logerror(this, 'matching an array');
          if (new RegExp(wants, 'i').test(note)) break
        }
        if (note.toString().match(new RegExp(wants, 'i'))) break
        continue
      case 'length': {
        const operator = bits[3]
        if (bits[4]) {
          wants = bits[4]
        }
        switch (operator) {
          case 'gt':
            if (note.length <= parseFloat(wants)) continue
            break
          case 'lt':
            if (note.length >= parseFloat(wants)) continue
            break
          case 'equals':
            if (note.length !== parseFloat(wants)) continue
            break
          default:
            connection.logerror(
              this,
              `length operator "${operator}" not supported.`,
            )
            continue
        }
        break
      }
      case 'in': // if in pass whitelisted
        // let list = bits[3];
        if (bits[4]) {
          wants = bits[4]
        }
        if (!Array.isArray(note)) continue
        if (!wants) continue
        if (note.indexOf(wants) !== -1) break // found!
        continue
      default:
        continue
    }
    this.apply_award(connection, key, award)
    delete karma.todo[key]
  }
}

exports.apply_award = function (connection, nl, award) {
  if (!award) return
  if (isNaN(award)) {
    // garbage in config
    connection.logerror(this, `non-numeric award from: ${nl}:${award}`)
    return
  }

  const bits = nl.split('@')
  nl = bits[0] // strip off @... if present

  connection.results.incr(this, { score: award })
  connection.logdebug(this, `applied ${nl}:${award}`)

  let trimmed =
    nl.substring(0, 5) === 'notes'
      ? nl.substring(6)
      : nl.substring(0, 7) === 'results'
        ? nl.substring(8)
        : nl.substring(0, 19) === 'transaction.results'
          ? nl.substring(20)
          : nl

  if (trimmed.substring(0, 7) === 'rcpt_to') trimmed = trimmed.substring(8)
  if (trimmed.substring(0, 7) === 'mail_from') trimmed = trimmed.substring(10)
  if (trimmed.substring(0, 7) === 'connect') trimmed = trimmed.substring(8)
  if (trimmed.substring(0, 4) === 'data') trimmed = trimmed.substring(5)

  if (award > 0) connection.results.add(this, { pass: trimmed })
  if (award < 0) connection.results.add(this, { fail: trimmed })
}

exports.check_spammy_tld = function (mail_from, connection) {
  if (!this.cfg.spammy_tlds) return
  if (mail_from.isNull()) return // null sender (bounce)

  const from_tld = mail_from.host.split('.').pop()
  // connection.logdebug(this, `from_tld: ${from_tld}`);

  const tld_penalty = parseFloat(this.cfg.spammy_tlds[from_tld] || 0)
  if (tld_penalty === 0) return

  connection.results.incr(this, { score: tld_penalty })
  connection.results.add(this, { fail: 'spammy.TLD' })
}

exports.check_syntax_RcptTo = function (connection) {
  // look for an illegal (RFC 5321,(2)821) space in envelope recipient
  const full_rcpt = connection.current_line
  if (full_rcpt.toUpperCase().substring(0, 9) === 'RCPT TO:<') return

  connection.loginfo(this, `illegal envelope address format: ${full_rcpt}`)
  connection.results.add(this, { fail: 'rfc5321.RcptTo' })
}

exports.assemble_note_obj = function (prefix, key) {
  let note = prefix
  const parts = key.split('.')
  while (parts.length > 0) {
    let next = parts.shift()
    if (phase_prefixes[next]) {
      next = `${next}.${parts.shift()}`
    }
    note = note[next]
    if (note === null || note === undefined) break
  }
  return note
}

exports.check_asn = function (connection, asnkey) {
  if (!this.db) return

  const report_as = { name: this.name }
  if (this.cfg.asn.report_as) report_as.name = this.cfg.asn.report_as

  this.db
    .hGetAll(asnkey)
    .then((res) => {
      if (res === null) {
        const expire = (this.cfg.redis.expire_days || 60) * 86400 // days
        this.init_asn(asnkey, expire)
        return
      }

      this.db.hIncrBy(asnkey, 'connections', 1)
      const asn_score = parseInt(res.good || 0) - (res.bad || 0)

      if (asn_score) {
        connection.results.add(report_as, { asn_score: asn_score })
        if (asn_score < -5) {
          connection.results.add(report_as, { fail: 'asn:history' })
        } else if (asn_score > 5) {
          connection.results.add(report_as, { pass: 'asn:history' })
        }
      }

      if (parseInt(res.bad) > 5 && parseInt(res.good) === 0) {
        connection.results.add(report_as, { fail: 'asn:all_bad' })
      }
      if (parseInt(res.good) > 5 && parseInt(res.bad) === 0) {
        connection.results.add(report_as, { pass: 'asn:all_good' })
      }

      connection.results.add(report_as, { emit: true })
    })
    .catch((err) => {
      connection.results.add(this, { err })
    })
}

exports.init_ip = async function (dbkey, rip, expire) {
  if (!this.db) return
  await this.db
    .multi()
    .hmSet(dbkey, { bad: 0, good: 0, connections: 1 })
    .expire(dbkey, expire)
    .exec()
}

exports.get_asn_key = function (connection) {
  if (!this.cfg.asn.enable) return
  let asn = connection.results.get('asn')
  if (!asn || !asn.asn) asn = connection.results.get('geoip')
  if (!asn || !asn.asn || isNaN(asn.asn)) return
  return `as${asn.asn}`
}

exports.init_asn = function (asnkey, expire) {
  if (!this.db) return
  this.db
    .multi()
    .hmSet(asnkey, { bad: 0, good: 0, connections: 1 })
    .expire(asnkey, expire * 2) // keep ASN longer
    .exec()
}
