'use strict';

const { EventEmitter } = require('events');
const { LoginThrottle } = require('../../../srv/auth/loginThrottle');
const { createBasicAuthThrottle } = require('../../../srv/auth/basicAuthThrottle');

/** A mocked user store standing in for CAP's Basic handler: one user, one made-up password. */
const PASSWORD = 'made-up-local-pass';

describe('Unit: basicAuthThrottle (failed sign-in limit for HTTP Basic on a development server)', () => {
  let throttle;
  let middleware;

  beforeEach(() => {
    throttle = new LoginThrottle({ env: {} });
    middleware = createBasicAuthThrottle(throttle);
  });

  const basic = (user, password) => 'Basic ' + Buffer.from(`${user}:${password}`).toString('base64');

  /** Sends one request through the limiter and then through the stand-in Basic handler. */
  function send(authorization, ip = '10.0.0.7') {
    const req = { headers: authorization ? { authorization } : {}, ip };
    const res = new EventEmitter();
    res.statusCode = 200;
    res.headers = {};
    res.status = (code) => { res.statusCode = code; return res; };
    res.set = (name, value) => { res.headers[name] = value; return res; };
    res.json = (body) => { res.body = body; res.emit('finish'); return res; };

    let reachedCap = false;
    middleware(req, res, () => {
      reachedCap = true;
      const [, encoded] = /^basic\s+(.+)$/i.exec(authorization || '') || [];
      if (encoded) {
        const [id, password] = Buffer.from(encoded, 'base64').toString().split(':');
        if (id === 'khushal' && password === PASSWORD) req.user = { id };
        else res.statusCode = 401;
      }
      res.emit('finish');
    });
    return { status: res.statusCode, reachedCap, res };
  }

  it('lets a request without a Basic header through and counts nothing', () => {
    expect(send(undefined)).toMatchObject({ status: 200, reachedCap: true });
    expect(send('Bearer some.signed.token')).toMatchObject({ status: 200, reachedCap: true });
    expect(throttle._failures.size).toBe(0);
  });

  it('answers 429 after three wrong passwords for a user, before the password is looked at', () => {
    for (const guess of ['guess-1', 'guess-2', 'guess-3']) expect(send(basic('khushal', guess)).status).toBe(401);

    const blocked = send(basic('khushal', PASSWORD));
    expect(blocked).toMatchObject({ status: 429, reachedCap: false });
    expect(blocked.res.headers['Retry-After']).toBe('900');
    expect(blocked.res.body.error.message).toContain('Too many failed sign-in attempts');
    // the user name is blocked from every address, as in the login action
    expect(send(basic('KHUSHAL', PASSWORD), '10.0.0.99')).toMatchObject({ status: 429, reachedCap: false });
  });

  it('uses the counters of the login action: failures there block Basic, and failures here block the login', () => {
    for (let i = 0; i < 3; i++) throttle.recordFailure('khushal', '10.0.0.1');   // three failed logins
    expect(send(basic('khushal', PASSWORD))).toMatchObject({ status: 429, reachedCap: false });

    for (const guess of ['a', 'b', 'c']) send(basic('other-user', guess));
    expect(throttle.check('other-user', '').allowed).toBe(false);
  });

  it('a request signed in as the user clears the user counter', () => {
    send(basic('khushal', 'guess-1'));
    send(basic('khushal', 'guess-2'));
    expect(send(basic('khushal', PASSWORD))).toMatchObject({ status: 200, reachedCap: true });
    send(basic('khushal', 'guess-3'));
    send(basic('khushal', 'guess-4'));
    expect(send(basic('khushal', PASSWORD)).status).toBe(200);
  });

  it('an answer other than 401 that did not sign the user in does not clear the counter', () => {
    send(basic('khushal', 'guess-1'));
    send(basic('khushal', 'guess-2'));
    const req = { headers: { authorization: basic('khushal', 'guess-x') }, ip: '10.0.0.7' };
    const res = new EventEmitter(); res.statusCode = 200;
    middleware(req, res, () => res.emit('finish'));                              // 200 without req.user
    expect(send(basic('khushal', 'guess-3')).status).toBe(401);
    expect(send(basic('khushal', PASSWORD)).status).toBe(429);
  });

  it('blocks an address after twenty failures across user names', () => {
    for (let i = 0; i < 20; i++) send(basic(`user${i}`, 'x'), '10.0.0.50');
    expect(send(basic('khushal', PASSWORD), '10.0.0.50')).toMatchObject({ status: 429, reachedCap: false });
    expect(send(basic('khushal', PASSWORD), '10.0.0.51').status).toBe(200);
  });
});
