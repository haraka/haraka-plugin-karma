# Changelog

The format is based on [Keep a Changelog](https://keepachangelog.com/).

### Unreleased

### [2.1.5] - 2024-04-23

- doc(README): remove spurious markdown link
- doc(CONTRIBUTORS): added

### [2.1.4] - 2024-04-06

- eslint: reduce config to depending on @haraka
- package.json: added scripts
- doc(CHANGELOG): ordered urls
- doc(Changes) -> CHANGELOG
- prettier & eslint configs
- chore: populate package.json [files]

### [2.1.3] - 2023-12-12

- ci: use shared configs
- style(es6): replace for..i with for...of
- deps(\*): bump versions to latest

### [2.1.2] - 2023-12-11

- config: update several plugin names
- style(es6): refer to plugin as 'this'

### [2.1.1] - 2023-08-22

- fix: check_result unexpected return #50

### [2.1.0] - 2022-11-29

- fix: in disconnect, call redis_unsub after skip check
- dep(redis): 4 -> 4.1
- dep(pi-redis): 2 -> 2.0.5

#### [2.0.4] - 2022-05-28

- use .release as submodule

#### [2.0.3] - 2022-05-28

- fix: depend directly on redis
- fix: update redis command names for v4 compatibility
- fix: update redis commands to be async

#### [2.0.1] - 2022-05-27

- chore(ci): depend on shared GHA workflows

#### [2.0.0] - 2022-03-29

- remove lots of plugin=this
- remove unnecessary braces and trailing ;
- some promises.

#### 1.0.14 - 2022-02-14

- try to unsubscribe in case connection is marked to skip during transaction

#### 1.0.13 - 2019-04-23

- add 'exists' pattern

#### 1.0.12 - 2019-03-08

- don't interfere with STARTLS and AUTH when karma is listed above those plugins in config/plugins

#### 1.0.11 - 2017-10-25

- private addresses and flagged connections exemption

#### 1.0.10 - 2017-08-30

- add TLS awards #19

#### 1.0.9 - 2017-07-29

- splash on some es6
- add AppVeyor CI testing

#### 1.0.8 - 2017-06-26

- revert #9, it breaks current Haraka deployments

#### 1.0.7 - 2017-06-16

- update for eslint 4 compat
- Add results_redis_publish=true for haraka-results changes #9

#### 1.0.6 - 2017-05-04

- emit error if redis plugin didn't create connection

#### 1.0.5 - 2017-02-06

- move merge_redis_ini into load_karma_ini, so it also gets applied
  after a karma.ini change
- skip redis operations when no connection exists

#### 1.0.4 - 2017-01-29

- use the new haraka-plugin-redis
- remove exceptions for soft denials. This makes denial time simpler.
- rules updates

#### 1.0.3 - 2017-01-27

- add rule #280 for known-senders
- add support for 'length' type, with eq, gt, and lt operators
- use shared haraka-eslint

#### 1.0.2 - 2017-01-24

- use redis.merge_redis_ini()

[2.0.0]: https://github.com/haraka/haraka-plugin-karma/releases/tag/2.0.0
[2.0.1]: https://github.com/haraka/haraka-plugin-karma/releases/tag/2.0.1
[2.0.2]: https://github.com/haraka/haraka-plugin-karma/releases/tag/2.0.2
[2.0.3]: https://github.com/haraka/haraka-plugin-karma/releases/tag/2.0.3
[2.0.4]: https://github.com/haraka/haraka-plugin-karma/releases/tag/2.0.4
[2.1.0]: https://github.com/haraka/haraka-plugin-karma/releases/tag/v2.1.0
[2.1.1]: https://github.com/haraka/haraka-plugin-karma/releases/tag/v2.1.1
[2.1.2]: https://github.com/haraka/haraka-plugin-karma/releases/tag/v2.1.2
[2.1.3]: https://github.com/haraka/haraka-plugin-karma/releases/tag/v2.1.3
[2.1.4]: https://github.com/haraka/haraka-plugin-karma/releases/tag/v2.1.4
[2.1.5]: https://github.com/haraka/haraka-plugin-karma/releases/tag/v2.1.5
