
## 1.0.6 - 2017-05-04

- emit error if redis plugin didn't create connection

## 1.0.5 - 2017-02-06

- move merge_redis_ini into load_karma_ini, so it also gets applied
  after a karma.ini change 
- skip redis operations when no connection exists


## 1.0.4 - 2017-01-29

- use the new haraka-plugin-redis
- remove exceptions for soft denials. This makes denial time simpler.
- rules updates


## 1.0.3 - 2017-01-27

- add rule #280 for known-senders
- add support for 'length' type, with eq, gt, and lt operators
- use shared haraka-eslint


## 1.0.2 - 2017-01-24

- use redis.merge_redis_ini()
