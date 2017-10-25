'use strict';
// karma - reward good and penalize bad mail senders

const constants = require('haraka-constants');
const utils     = require('haraka-utils');

const phase_prefixes = utils.to_object([
  'connect','helo','mail_from','rcpt_to','data'
]);

exports.register = function () {
  const plugin = this;

  plugin.inherits('haraka-plugin-redis');

  // set up defaults
  plugin.deny_hooks = utils.to_object(
    ['unrecognized_command','helo','data','data_post','queue']
  );
  plugin.deny_exclude_hooks = utils.to_object('rcpt_to, queue');
  plugin.deny_exclude_plugins = utils.to_object([
    'access', 'helo.checks', 'data.headers', 'spamassassin',
    'mail_from.is_resolvable', 'clamd', 'tls'
  ]);

  plugin.load_karma_ini();

  plugin.register_hook('init_master',  'init_redis_plugin');
  plugin.register_hook('init_child',   'init_redis_plugin');

  plugin.register_hook('connect_init', 'results_init');
  plugin.register_hook('connect_init', 'ip_history_from_redis');
}

exports.load_karma_ini = function () {
  const plugin = this;

  plugin.cfg = plugin.config.get('karma.ini', {
    booleans: [
      '+asn.enable',
    ],
  }, function () {
    plugin.load_karma_ini();
  });

  plugin.merge_redis_ini();

  const cfg = plugin.cfg;
  if (cfg.deny && cfg.deny.hooks) {
    plugin.deny_hooks = utils.to_object(cfg.deny.hooks);
  }

  const e = cfg.deny_excludes;
  if (e && e.hooks) {
    plugin.deny_exclude_hooks = utils.to_object(e.hooks);
  }

  if (e && e.plugins) {
    plugin.deny_exclude_plugins = utils.to_object(e.plugins);
  }

  if (cfg.result_awards) {
    plugin.preparse_result_awards();
  }

  if (!cfg.redis) cfg.redis = {};
  if (!cfg.redis.host && cfg.redis.server_ip) {
    cfg.redis.host = cfg.redis.server_ip; // backwards compat
  }
  if (!cfg.redis.port && cfg.redis.server_port) {
    cfg.redis.port = cfg.redis.server_port; // backwards compat
  }
}

exports.results_init = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) {
    connection.logdebug(plugin, 'skipping');
    return next();
  }

  if (connection.results.get('karma')) {
    connection.logerror(plugin, 'this should never happen');
    return next();    // init once per connection
  }

  if (plugin.cfg.awards) {
    // todo is a list of connection/transaction awards to 'watch' for.
    // When discovered, apply the awards value
    const todo = {};
    for (const key in plugin.cfg.awards) {
      const award = plugin.cfg.awards[key].toString();
      todo[key] = award;
    }
    connection.results.add(plugin, { score:0, todo: todo });
  }
  else {
    connection.results.add(plugin, { score:0 });
  }

  if (!connection.server.notes.redis) {
    connection.logerror(plugin, 'karma requires the redis plugin');
    return next();
  }

  if (!plugin.result_awards) return next();  // not configured

  // subscribe to result_store publish messages
  plugin.redis_subscribe(connection, () => {
    connection.notes.redis.on('pmessage', (pattern, channel, message) => {
      plugin.check_result(connection, message);
    });
    next();
  })
}

exports.preparse_result_awards = function () {
  const plugin = this;
  if (!plugin.result_awards) plugin.result_awards = {};

  // arrange results for rapid traversal by check_result() :
  // ex: karma.result_awards.clamd.fail = { .... }
  Object.keys(plugin.cfg.result_awards).forEach(anum => {
    // plugin, property, operator, value, award, reason, resolution
    const parts = plugin.cfg.result_awards[anum].split(/(?:\s*\|\s*)/);
    const pi_name = parts[0];
    const property = parts[1];
    if (!plugin.result_awards[pi_name]) {
      plugin.result_awards[pi_name] = {};
    }
    if (!plugin.result_awards[pi_name][property]) {
      plugin.result_awards[pi_name][property] = [];
    }
    plugin.result_awards[pi_name][property].push({
      id         : anum,
      operator   : parts[2],
      value      : parts[3],
      award      : parts[4],
      reason     : parts[5],
      resolution : parts[6],
    });
  });
};

exports.check_result = function (connection, message) {
  const plugin = this;
  // connection.loginfo(plugin, message);
  // {"plugin":"karma","result":{"fail":"spamassassin.hits"}}
  // {"plugin":"geoip","result":{"country":"CN"}}

  const m = JSON.parse(message);
  if (m && m.result && m.result.asn) {
    plugin.check_result_asn(m.result.asn, connection);
  }
  if (!plugin.result_awards[m.plugin]) return;  // no awards for plugin

  Object.keys(m.result).forEach(r => {  // foreach result in mess
    if (r === 'emit') return;  // r: pass, fail, skip, err, ...

    const pi_prop = plugin.result_awards[m.plugin][r];
    if (!pi_prop) return;      // no award for this plugin property

    const thisResult = m.result[r];
    // ignore empty arrays, objects, and strings
    if (Array.isArray(thisResult) && thisResult.length === 0) return;
    if (typeof thisResult === 'object' && !Object.keys(thisResult).length) {
      return;
    }
    if (typeof thisResult === 'string' && !thisResult) return; // empty

    // do any award conditions match this result?
    for (let i=0; i < pi_prop.length; i++) {     // each award...
      const thisAward = pi_prop[i];
      // { id: '011', operator: 'equals', value: 'all_bad', award: '-2'}
      const thisResArr = plugin.result_as_array(thisResult);
      switch (thisAward.operator) {
        case 'eq':
        case 'equal':
        case 'equals':
          plugin.check_result_equal(thisResArr, thisAward, connection);
          break;
        case 'match':
          plugin.check_result_match(thisResArr, thisAward, connection);
          break;
        case 'lt':
          plugin.check_result_lt(thisResArr, thisAward, connection);
          break;
        case 'gt':
          plugin.check_result_gt(thisResArr, thisAward, connection);
          break;
        case 'length':
          plugin.check_result_length(thisResArr, thisAward, connection);
          break;
      }
    }
  });
};

exports.result_as_array = function (result) {

  if (typeof result === 'string') return [result];
  if (typeof result === 'number') return [result];
  if (typeof result === 'boolean') return [result];
  if (Array.isArray(result)) return result;
  if (typeof result === 'object') {
    const array = [];
    Object.keys(result).forEach(tr => {
      array.push(result[tr]);
    });
    return array;
  }
  this.loginfo('what format is result: ' + result);
  return result;
};

exports.check_result_asn = function (asn, conn) {
  const plugin = this;
  if (!plugin.cfg.asn_awards) return;
  if (!plugin.cfg.asn_awards[asn]) return;

  conn.results.incr(plugin, {score: plugin.cfg.asn_awards[asn]});
  conn.results.push(plugin, {fail: 'asn_awards'});
};

exports.check_result_lt = function (thisResult, thisAward, conn) {
  const plugin = this;

  for (let j=0; j < thisResult.length; j++) {
    const tr = parseFloat(thisResult[j]);
    if (tr >= parseFloat(thisAward.value)) continue;
    if (conn.results.has('karma', 'awards', thisAward.id)) continue;

    conn.results.incr(plugin, {score: thisAward.award});
    conn.results.push(plugin, {awards: thisAward.id});
  }
};

exports.check_result_gt = function (thisResult, thisAward, conn) {
  const plugin = this;

  for (let j=0; j < thisResult.length; j++) {
    const tr = parseFloat(thisResult[j]);
    if (tr <= parseFloat(thisAward.value)) continue;
    if (conn.results.has('karma', 'awards', thisAward.id)) continue;

    conn.results.incr(plugin, {score: thisAward.award});
    conn.results.push(plugin, {awards: thisAward.id});
  }
};

exports.check_result_equal = function (thisResult, thisAward, conn) {
  const plugin = this;

  for (let j=0; j < thisResult.length; j++) {
    if (thisAward.value === 'true') {
      if (!thisResult[j]) continue;
    }
    else {
      if (thisResult[j] != thisAward.value) continue;
    }
    if (!/auth/.test(thisAward.plugin)) {
      // only auth attempts are scored > 1x
      if (conn.results.has('karma', 'awards', thisAward.id)) continue;
    }

    conn.results.incr(plugin, {score: thisAward.award});
    conn.results.push(plugin, {awards: thisAward.id});
  }
};

exports.check_result_match = function (thisResult, thisAward, conn) {
  const plugin = this;
  const re = new RegExp(thisAward.value, 'i');

  for (let i=0; i < thisResult.length; i++) {
    if (!re.test(thisResult[i])) continue;
    if (conn.results.has('karma', 'awards', thisAward.id)) continue;

    conn.results.incr(plugin, {score: thisAward.award});
    conn.results.push(plugin, {awards: thisAward.id});
  }
};

exports.check_result_length = function (thisResult, thisAward, conn) {
  const plugin = this;

  for (let j=0; j < thisResult.length; j++) {
    // let [operator, qty] = thisAward.value.split(/\s+/); // requires node 6
    const matches = thisAward.value.split(/\s+/);
    const operator = matches[0];
    const qty = matches[1];

    switch (operator) {
      case 'eq':
      case 'equal':
      case 'equals':
        if (parseInt(thisResult[j], 10) != parseInt(qty, 10)) continue;
        break;
      case 'gt':
        if (parseInt(thisResult[j], 10) <= parseInt(qty, 10)) continue;
        break;
      case 'lt':
        if (parseInt(thisResult[j], 10) >= parseInt(qty, 10)) continue;
        break;
      default:
        conn.results.add(plugin, { err: 'invalid operator:' + operator });
        continue;
    }

    conn.results.incr(plugin, {score: thisAward.award});
    conn.results.push(plugin, {awards: thisAward.id});
  }
};

exports.apply_tarpit = function (connection, hook, score, next) {
  const plugin = this;
  if (!plugin.cfg.tarpit) { return next(); } // tarpit disabled in config

  // If tarpit is enabled on the reset_transaction hook, Haraka doesn't
  // wait. Then bad things happen, like a Haraka crash.
  if (utils.in_array(hook, ['reset_transaction','queue'])) return next();

  // no delay for senders with good karma
  const k = connection.results.get('karma');
  if (score === undefined) { score = parseFloat(k.score); }
  if (score >= 0) { return next(); }

  // how long to delay?
  const delay = plugin.tarpit_delay(score, connection, hook, k);
  if (!delay) return next();

  connection.logdebug(plugin, 'tarpitting '+hook+' for ' + delay + 's');
  setTimeout(() => {
    connection.logdebug(plugin, 'tarpit '+hook+' end');
    next();
  }, delay * 1000);
};

exports.tarpit_delay = function (score, connection, hook, k) {
  const plugin = this;

  if (plugin.cfg.tarpit.delay && parseFloat(plugin.cfg.tarpit.delay)) {
    connection.logdebug(plugin, 'static tarpit');
    return parseFloat(plugin.cfg.tarpit.delay);
  }

  const delay = score * -1;   // progressive tarpit

  // detect roaming users based on MSA ports that require auth
  if (utils.in_array(connection.local.port, [587,465]) &&
    utils.in_array(hook, ['ehlo','connect'])) {
    return plugin.tarpit_delay_msa(connection, delay, k);
  }

  const max = plugin.cfg.tarpit.max || 5;
  if (delay > max) {
    connection.logdebug(plugin, 'tarpit capped to: ' + max);
    return max;
  }

  return delay;
};

exports.tarpit_delay_msa = function (connection, delay, k) {
  const plugin = this;
  const trg = 'tarpit reduced for good';

  delay = parseFloat(delay);

  // Reduce delay for good history
  const history = ((k.good || 0) - (k.bad || 0));
  if (history > 0) {
    delay = delay - 2;
    connection.logdebug(plugin, trg + ' history: ' + delay);
  }

  // Reduce delay for good ASN history
  let asn = connection.results.get('asn');
  if (!asn) { asn = connection.results.get('geoip'); }
  if (asn && asn.asn && k.neighbors > 0) {
    connection.logdebug(plugin, trg + ' neighbors: ' + delay);
    delay = delay - 2;
  }

  const max = plugin.cfg.tarpit.max_msa || 2;
  if (delay > max) {
    connection.logdebug(plugin, 'tarpit capped at: ' + delay);
    delay = max;
  }

  return delay;
};

exports.should_we_skip = function (connection) {
  if (connection.remote.is_private) return true;
  if (connection.notes.disable_karma) return true;
  return false;
};

exports.should_we_deny = function (next, connection, hook) {
  const plugin = this;

  const r = connection.results.get('karma');
  if (!r) { return next(); }

  plugin.check_awards(connection);  // update awards first

  const score = parseFloat(r.score);
  if (isNaN(score))  {
    connection.logerror(plugin, 'score is NaN');
    connection.results.add(plugin, {score: 0});
    return next();
  }

  let negative_limit = -5;
  if (plugin.cfg.thresholds && plugin.cfg.thresholds.negative) {
    negative_limit = parseFloat(plugin.cfg.thresholds.negative);
  }

  if (score > negative_limit) {
    return plugin.apply_tarpit(connection, hook, score, next);
  }
  if (!plugin.deny_hooks[hook]) {
    return plugin.apply_tarpit(connection, hook, score, next);
  }

  let rejectMsg = 'very bad karma score: {score}';
  if (plugin.cfg.deny && plugin.cfg.deny.message) {
    rejectMsg = plugin.cfg.deny.message;
  }

  if (/\{/.test(rejectMsg)) {
    rejectMsg = rejectMsg.replace(/\{score\}/, score);
    rejectMsg = rejectMsg.replace(/\{uuid\}/, connection.uuid);
  }

  return plugin.apply_tarpit(connection, hook, score, () => {
    next(constants.DENY, rejectMsg);
  });
};

exports.hook_deny = function (next, connection, params) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  // let pi_deny     = params[0];  // (constants.deny, denysoft, ok)
  // let pi_message  = params[1];
  const pi_name     = params[2];
  // let pi_function = params[3];
  // let pi_params   = params[4];
  const pi_hook     = params[5];

  // exceptions, whose 'DENY' should not be captured
  if (pi_name) {
    if (pi_name === 'karma') return next();
    if (plugin.deny_exclude_plugins[pi_name]) return next();
  }
  if (pi_hook && plugin.deny_exclude_hooks[pi_hook]) {
    return next();
  }

  if (!connection.results) {
    return next(constants.OK); // resume the connection
  }

  // intercept any other denials
  connection.results.add(plugin, { msg: 'deny:' + pi_name });
  connection.results.incr(plugin, { score: -2 });

  next(constants.OK);  // resume the connection
};

exports.hook_connect = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  const asnkey = plugin.get_asn_key(connection);
  if (asnkey) {
    plugin.check_asn(connection, asnkey);
  }
  plugin.should_we_deny(next, connection, 'connect');
};

exports.hook_helo = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.should_we_deny(next, connection, 'helo');
};

exports.hook_ehlo = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.should_we_deny(next, connection, 'ehlo');
};

exports.hook_vrfy = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.should_we_deny(next, connection, 'vrfy');
};

exports.hook_noop = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.should_we_deny(next, connection, 'noop');
};

exports.hook_data = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.should_we_deny(next, connection, 'data');
};

exports.hook_queue = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.should_we_deny(next, connection, 'queue');
};

exports.hook_reset_transaction = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  connection.results.add(plugin, {emit: true});
  plugin.should_we_deny(next, connection, 'reset_transaction');
};

exports.hook_unrecognized_command = function (next, connection, cmd) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  connection.results.incr(plugin, {score: -1});
  connection.results.add(plugin, {fail: 'cmd:('+cmd+')'});

  return plugin.should_we_deny(next, connection, 'unrecognized_command');
};

exports.ip_history_from_redis = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  const expire = (plugin.cfg.redis.expire_days || 60) * 86400; // to days
  const dbkey  = 'karma|' + connection.remote.ip;

  // redis plugin is emitting errors, no need to here
  if (!plugin.db) return next();

  plugin.db.hgetall(dbkey, (err, dbr) => {
    if (err) {
      connection.results.add(plugin, {err: err});
      return next();
    }

    if (dbr === null) {
      plugin.init_ip(dbkey, connection.remote.ip, expire);
      return next();
    }

    plugin.db.multi()
      .hincrby(dbkey, 'connections', 1)  // increment total conn
      .expire(dbkey, expire)             // extend expiration
      .exec((err2, replies) => {
        if (err2) connection.results.add(plugin, {err: err2});
      });

    const results = {
      good: dbr.good,
      bad: dbr.bad,
      connections: dbr.connections,
      history: parseInt((dbr.good || 0) - (dbr.bad || 0)),
      emit: true,
    }

    // Careful: don't become self-fulfilling prophecy.
    if (parseInt(dbr.good) > 5 && parseInt(dbr.bad) === 0) {
      results.pass = 'all_good';
    }
    if (parseInt(dbr.bad) > 5 && parseInt(dbr.good) === 0) {
      results.fail = 'all_bad';
    }

    connection.results.add(plugin, results);

    plugin.check_awards(connection);
    return next();
  });
};

exports.hook_mail = function (next, connection, params) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.check_spammy_tld(params[0], connection);

  // look for invalid (RFC 5321,(2)821) space in envelope from
  const full_from = connection.current_line;
  if (full_from.toUpperCase().substring(0,11) !== 'MAIL FROM:<') {
    connection.loginfo(plugin, 'RFC ignorant env addr format: ' + full_from);
    connection.results.add(plugin, {fail: 'rfc5321.MailFrom'});
  }

  // apply TLS awards (if defined)
  if (plugin.cfg.tls !== undefined) {
    if (plugin.cfg.tls.set && connection.tls.enabled) {
      connection.results.incr(plugin, {score: plugin.cfg.tls.set});
    }
    if (plugin.cfg.tls.unset && !connection.tls.enabled) {
      connection.results.incr(plugin, {score: plugin.cfg.tls.unset});
    }
  }

  return plugin.should_we_deny(next, connection, 'mail');
};

exports.hook_rcpt = function (next, connection, params) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  const rcpt = params[0];

  // hook_rcpt    catches recipients that no rcpt_to plugin permitted
  // hook_rcpt_ok catches accepted recipients

  // odds of from_user=rcpt_user in ham: < 1%, in spam > 40%
  // 2015-05 30-day sample: 84% spam correlation
  const txn = connection.transaction;
  if (txn && txn.mail_from && txn.mail_from.user === rcpt.user) {
    connection.results.add(plugin, {fail: 'env_user_match'});
  }

  plugin.check_syntax_RcptTo(connection);

  connection.results.add(plugin, {fail: 'rcpt_to'});

  return plugin.should_we_deny(next, connection, 'rcpt');
};

exports.hook_rcpt_ok = function (next, connection, rcpt) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  const txn = connection.transaction;
  if (txn && txn.mail_from && txn.mail_from.user === rcpt.user) {
    connection.results.add(plugin, {fail: 'env_user_match'});
  }

  plugin.check_syntax_RcptTo(connection);

  return plugin.should_we_deny(next, connection, 'rcpt');
};

exports.hook_data_post = function (next, connection) {
  // goal: prevent delivery of spam before queue
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.check_awards(connection);  // update awards

  const results = connection.results.collate(plugin);
  connection.logdebug(plugin, 'adding header: ' + results);
  connection.transaction.remove_header('X-Haraka-Karma');
  connection.transaction.add_header('X-Haraka-Karma', results);

  return plugin.should_we_deny(next, connection, 'data_post');
};

exports.increment = function (connection, key, val) {
  const plugin = this;
  if (!plugin.db) return;

  plugin.db.hincrby('karma|' + connection.remote.ip, key, 1);

  const asnkey = plugin.get_asn_key(connection);
  if (asnkey) plugin.db.hincrby(asnkey, key, 1);
};

exports.hook_disconnect = function (next, connection) {
  const plugin = this;

  if (plugin.should_we_skip(connection)) return next();

  plugin.redis_unsubscribe(connection);

  const k = connection.results.get('karma');
  if (!k || k.score === undefined) {
    connection.results.add(plugin, {err: 'karma results missing'});
    return next();
  }

  if (!plugin.cfg.thresholds) {
    plugin.check_awards(connection);
    connection.results.add(plugin, {msg: 'no action', emit: true });
    return next();
  }

  if (k.score > (plugin.cfg.thresholds.positive || 3)) {
    plugin.increment(connection, 'good', 1);
  }
  if (k.score < 0) {
    plugin.increment(connection, 'bad', 1);
  }

  connection.results.add(plugin, {emit: true });
  return next();
};

exports.get_award_loc_from_note = function (connection, award) {
  const plugin = this;

  if (connection.transaction) {
    const obj = plugin.assemble_note_obj(connection.transaction, award);
    if (obj) { return obj; }
  }

  // connection.logdebug(plugin, 'no txn note: ' + award);
  const obj = plugin.assemble_note_obj(connection, award);
  if (obj) return obj;

  // connection.logdebug(plugin, 'no conn note: ' + award);
  return;
};

exports.get_award_loc_from_results = function (connection, loc_bits) {

  let pi_name = loc_bits[1];
  let notekey = loc_bits[2];

  if (phase_prefixes[pi_name]) {
    pi_name = loc_bits[1] + '.' + loc_bits[2];
    notekey = loc_bits[3];
  }

  let obj;
  if (connection.transaction) {
    obj = connection.transaction.results.get(pi_name);
  }
  if (!obj) {
    // connection.logdebug(plugin, 'no txn results: ' + pi_name);
    obj = connection.results.get(pi_name);
  }
  if (!obj) {
    // connection.logdebug(plugin, 'no conn results: ' + pi_name);
    return;
  }

  // connection.logdebug(plugin, 'found results for ' + pi_name +
  //     ', ' + notekey);
  if (notekey) { return obj[notekey]; }
  return obj;
};

exports.get_award_location = function (connection, award_key) {
  // based on award key, find the requested note or result
  const plugin = this;
  const bits = award_key.split('@');
  const loc_bits = bits[0].split('.');
  if (loc_bits.length === 1) {          // ex: relaying
    return connection[bits[0]];
  }

  if (loc_bits[0] === 'notes') {        // ex: notes.spf_mail_helo
    return plugin.get_award_loc_from_note(connection, bits[0]);
  }

  if (loc_bits[0] === 'results') {   // ex: results.geoip.distance
    return plugin.get_award_loc_from_results(connection, loc_bits);
  }

  // ex: transaction.results.spf
  if (connection.transaction &&
    loc_bits[0] === 'transaction' &&
    loc_bits[1] === 'results') {
    loc_bits.shift();
    return plugin.get_award_loc_from_results(connection.transaction, loc_bits);
  }

  connection.logdebug(plugin, 'unknown location for ' + award_key);
};

exports.get_award_condition = function (note_key, note_val) {
  let wants;
  const keybits = note_key.split('@');
  if (keybits[1]) { wants = keybits[1]; }

  const valbits = note_val.split(/\s+/);
  if (!valbits[1]) { return wants; }
  if (valbits[1] !== 'if') { return wants; }  // no if condition

  if (valbits[2].match(/^(equals|gt|lt|match)$/)) {
    if (valbits[3]) { wants = valbits[3]; }
  }
  return wants;
};

exports.check_awards = function (connection) {
  const plugin = this;
  const karma  = connection.results.get('karma');
  if (!karma     ) return;
  if (!karma.todo) return;

  for (const key in karma.todo) {
    //     loc                     =     terms
    // note_location [@wants]      = award [conditions]
    // results.geoip.too_far       = -1
    // results.geoip.distance@4000 = -1 if gt 4000
    const award_terms = karma.todo[key];

    const note = plugin.get_award_location(connection, key);
    if (note === undefined) { continue; }
    let wants = plugin.get_award_condition(key, award_terms);

    // test the desired condition
    const bits = award_terms.split(/\s+/);
    const award = parseFloat(bits[0]);
    if (!bits[1] || bits[1] !== 'if') {    // no if conditions
      if (!note) { continue; }             // failed truth test
      if (!wants) {                        // no wants, truth matches
        plugin.apply_award(connection, key, award);
        delete karma.todo[key];
        continue;
      }
      if (note !== wants) { continue; }    // didn't match
    }

    // connection.loginfo(plugin, 'check_awards, case matching for: ' +
    //    wants);

    // the matching logic here is inverted, weeding out misses (continue)
    // Matches fall through (break) to the apply_award below.
    const condition = bits[2];
    switch (condition) {
      case 'equals':
        if (wants != note) continue;
        break;
      case 'gt':
        if (parseFloat(note) <= parseFloat(wants)) { continue; }
        break;
      case 'lt':
        if (parseFloat(note) >= parseFloat(wants)) { continue; }
        break;
      case 'match':
        if (Array.isArray(note)) {
          // connection.logerror(plugin, 'matching an array');
          if (new RegExp(wants, 'i').test(note)) { break; }
        }
        if (note.toString().match(new RegExp(wants, 'i'))) { break; }
        continue;
      case 'length': {
        const operator = bits[3];
        if (bits[4]) { wants = bits[4]; }
        switch (operator) {
          case 'gt':
            if (note.length <= parseFloat(wants)) { continue; }
            break;
          case 'lt':
            if (note.length >= parseFloat(wants)) { continue; }
            break;
          case 'equals':
            if (note.length !== parseFloat(wants)) { continue; }
            break;
          default:
            connection.logerror(plugin, 'length operator "' +
              operator + '" not supported.');
            continue;
        }
        break;
      }
      case 'in':              // if in pass whitelisted
        // let list = bits[3];
        if (bits[4]) { wants = bits[4]; }
        if (!Array.isArray(note)) { continue; }
        if (!wants) { continue; }
        if (note.indexOf(wants) !== -1) { break; } // found!
        continue;
      default:
        continue;
    }
    plugin.apply_award(connection, key, award);
    delete karma.todo[key];
  }
};

exports.apply_award = function (connection, nl, award) {
  const plugin = this;
  if (!award) { return; }
  if (isNaN(award)) {    // garbage in config
    connection.logerror(plugin, 'non-numeric award from: ' + nl + ':' +
              award);
    return;
  }

  const bits = nl.split('@'); nl = bits[0];  // strip off @... if present

  connection.results.incr(plugin, {score: award});
  connection.logdebug(plugin, 'applied ' + nl + ':' + award);

  let trimmed = nl.substring(0, 5) === 'notes' ? nl.substring(6) :
    nl.substring(0, 7) === 'results' ? nl.substring(8) :
      nl.substring(0,19) === 'transaction.results' ?
        nl.substring(20) : nl;

  if (trimmed.substring(0,7) === 'rcpt_to') trimmed = trimmed.substring(8);
  if (trimmed.substring(0,7) === 'mail_from') trimmed = trimmed.substring(10);
  if (trimmed.substring(0,7) === 'connect') trimmed = trimmed.substring(8);
  if (trimmed.substring(0,4) === 'data') trimmed = trimmed.substring(5);

  if (award > 0) { connection.results.add(plugin, {pass: trimmed}); }
  if (award < 0) { connection.results.add(plugin, {fail: trimmed}); }
};

exports.check_spammy_tld = function (mail_from, connection) {
  const plugin = this;
  if (!plugin.cfg.spammy_tlds) { return; }
  if (mail_from.isNull()) { return; }         // null sender (bounce)

  const from_tld = mail_from.host.split('.').pop();
  // connection.logdebug(plugin, 'from_tld: ' + from_tld);

  const tld_penalty = parseFloat(plugin.cfg.spammy_tlds[from_tld] || 0);
  if (tld_penalty === 0) { return; }

  connection.results.incr(plugin, {score: tld_penalty});
  connection.results.add(plugin, {fail: 'spammy.TLD'});
};

exports.check_syntax_RcptTo = function (connection) {
  const plugin = this;

  // look for an illegal (RFC 5321,(2)821) space in envelope recipient
  const full_rcpt = connection.current_line;
  if (full_rcpt.toUpperCase().substring(0,9) === 'RCPT TO:<') { return; }

  connection.loginfo(plugin, 'illegal envelope address format: ' +
          full_rcpt );
  connection.results.add(plugin, {fail: 'rfc5321.RcptTo'});
};

exports.assemble_note_obj = function (prefix, key) {
  let note = prefix;
  const parts = key.split('.');
  while (parts.length > 0) {
    let next = parts.shift();
    if (phase_prefixes[next]) {
      next = next + '.' + parts.shift();
    }
    note = note[next];
    if (note === null || note === undefined) { break; }
  }
  return note;
};

exports.check_asn = function (connection, asnkey) {
  const plugin = this;
  if (!plugin.db) return;

  const report_as = { name: plugin.name };

  if (plugin.cfg.asn.report_as) {
    report_as.name = plugin.cfg.asn.report_as;
  }

  plugin.db.hgetall(asnkey, (err, res) => {
    if (err) {
      connection.results.add(plugin, {err: err});
      return;
    }

    if (res === null) {
      const expire = (plugin.cfg.redis.expire_days || 60) * 86400; // days
      plugin.init_asn(asnkey, expire);
      return;
    }

    plugin.db.hincrby(asnkey, 'connections', 1);
    const asn_score = parseInt(res.good || 0) - (res.bad || 0);
    const asn_results = {
      asn_score: asn_score,
      asn_connections: res.connections,
      asn_good: res.good,
      asn_bad: res.bad,
      emit: true,
    }

    if (asn_score) {
      if (asn_score < -5) {
        asn_results.fail = 'asn:history';
      }
      else if (asn_score > 5) {
        asn_results.pass = 'asn:history';
      }
    }

    if (parseInt(res.bad) > 5 && parseInt(res.good) === 0) {
      asn_results.fail = 'asn:all_bad';
    }
    if (parseInt(res.good) > 5 && parseInt(res.bad) === 0) {
      asn_results.pass = 'asn:all_good';
    }

    connection.results.add(report_as, asn_results);
  });
};

exports.init_ip = function (dbkey, rip, expire) {
  const plugin = this;
  if (!plugin.db) return;
  plugin.db.multi()
    .hmset(dbkey, {'bad': 0, 'good': 0, 'connections': 1})
    .expire(dbkey, expire)
    .exec();
};

exports.get_asn_key = function (connection) {
  const plugin = this;
  if (!plugin.cfg.asn.enable) { return; }
  let asn = connection.results.get('asn');
  if (!asn || !asn.asn) {
    asn = connection.results.get('geoip');
  }
  if (!asn || !asn.asn || isNaN(asn.asn)) { return; }
  return 'as' + asn.asn;
};

exports.init_asn = function (asnkey, expire) {
  const plugin = this;
  if (!plugin.db) return;
  plugin.db.multi()
    .hmset(asnkey, {'bad': 0, 'good': 0, 'connections': 1})
    .expire(asnkey, expire * 2)    // keep ASN longer
    .exec();
};
