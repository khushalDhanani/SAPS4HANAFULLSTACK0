'use strict';

const cds = require('@sap/cds');
const getLogger = require('../../../srv/common/logger');
const { correlationPlainFormat, configureLogger } = require('../../../srv/common/logger');

describe('Unit: Logger Module (srv/common/logger.js)', () => {
  let origEnvLog;
  let origCdsLogFormat;
  let origCdsLogPlain;
  let origContext;

  beforeEach(() => {
    origEnvLog = cds.env.log;
    origCdsLogFormat = cds.log.format;
    origCdsLogPlain = cds.log.formatters.plain;
    origContext = cds.context;
  });

  afterEach(() => {
    cds.env.log = origEnvLog;
    cds.log.format = origCdsLogFormat;
    cds.log.formatters.plain = origCdsLogPlain;
    cds.context = origContext;
  });

  describe('getLogger instantiation & delegation', () => {
    it('returns a valid CAP cds.log logger instance', () => {
      const log = getLogger('test-service');
      expect(log).toBeDefined();
      expect(typeof log.error).toBe('function');
      expect(typeof log.warn).toBe('function');
      expect(typeof log.info).toBe('function');
      expect(typeof log.debug).toBe('function');
      expect(typeof log.trace).toBe('function');
      expect(log.id).toBe('test-service');
      expect(log.label).toBe('test-service');
    });

    it('returns the same cached logger when called repeatedly with identical label', () => {
      const log1 = getLogger('cached-logger');
      const log2 = getLogger('cached-logger');
      expect(log1).toBe(log2);
    });
  });

  describe('correlationPlainFormat', () => {
    it('formats single string argument without correlation ID when cds.context is not set', () => {
      delete cds.context;
      const formatted = correlationPlainFormat('my-service', 3, 'Processing order 1001');
      expect(formatted).toEqual(['[my-service] - Processing order 1001']);
    });

    it('formats single string argument with correlation ID when cds.context.id is present', () => {
      cds.context = { id: 'req-corr-12345' };
      const formatted = correlationPlainFormat('my-service', 3, 'Processing order 1001');
      expect(formatted).toEqual(['[my-service] [req-corr-12345] - Processing order 1001']);
    });

    it('prefers cds.context.id as the authoritative request correlation identifier', () => {
      cds.context = { id: 'req-auth-9999' };
      const formatted = correlationPlainFormat('my-service', 3, 'Task completed');
      expect(formatted).toEqual(['[my-service] [req-auth-9999] - Task completed']);
    });

    it('formats multiple arguments cleanly with first argument prefixed', () => {
      cds.context = { id: 'req-multi-1' };
      const err = new Error('Connection refused');
      const formatted = correlationPlainFormat('s4-adapter', 1, 'Failed to fetch:', err);
      expect(formatted[0]).toBe('[s4-adapter] [req-multi-1] - Failed to fetch:');
      expect(formatted[1]).toBe(err);
    });

    it('formats non-string first argument cleanly', () => {
      cds.context = { id: 'req-obj-1' };
      const payload = { status: 'OK', count: 42 };
      const formatted = correlationPlainFormat('diag', 3, payload);
      expect(formatted[0]).toBe('[diag] [req-obj-1] -');
      expect(formatted[1]).toBe(payload);
    });
  });

  describe('Log Level Control', () => {
    it('respects CAP log levels dynamically', () => {
      const log = getLogger('dynamic-level-test', 'warn');
      expect(log.level).toBe(cds.log.levels.WARN);
      expect(log._info).toBe(false);
      expect(log._warn).toBe(true);
      expect(log._error).toBe(true);
    });

    it('suppresses logs below the configured level', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const infoSpy = jest.spyOn(console, 'info').mockImplementation(() => {});

      const log = getLogger('suppress-test', 'warn');
      log.info('This info log should be suppressed');
      expect(infoSpy).not.toHaveBeenCalled();

      log.warn('This warn log should be emitted');
      expect(warnSpy).toHaveBeenCalledTimes(1);

      warnSpy.mockRestore();
      infoSpy.mockRestore();
    });
  });

  describe('Structured JSON Output', () => {
    it('uses CAP JSON formatter when cds.env.log.format is json and attaches correlation_id', () => {
      cds.env.log = { format: 'json', levels: {} };
      configureLogger();

      const origInfo = console.info;
      let jsonOutput = null;
      console.info = (arg) => {
        try {
          jsonOutput = JSON.parse(arg);
        } catch (_) {
          jsonOutput = arg;
        }
      };

      try {
        cds.context = { id: 'json-req-456' };
        const log = getLogger('json-test');
        log.info('Structured message in JSON');

        expect(jsonOutput).toBeDefined();
        expect(jsonOutput.level).toBe('info');
        expect(jsonOutput.logger).toBe('json-test');
        expect(jsonOutput.correlation_id).toBe('json-req-456');
        expect(jsonOutput.msg).toBe('Structured message in JSON');
        expect(jsonOutput.timestamp).toBeDefined();
      } finally {
        console.info = origInfo;
      }
    });
  });

  describe('Jest Spy Compatibility', () => {
    it('passes toHaveBeenCalledWith(expect.stringContaining(...)) on console.warn', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      configureLogger();

      const log = getLogger('jest-compat');
      log.warn('Important security notification: unauthorized access');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('unauthorized access'));
      warnSpy.mockRestore();
    });

    it('passes toHaveBeenCalledWith(expect.stringContaining(...)) with active correlation context', () => {
      const warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      configureLogger();
      cds.context = { id: 'TRACE-001' };

      const log = getLogger('jest-compat-corr');
      log.warn('S4_TECHNICAL_USERNAME is the same user as S4_USERNAME');

      expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('S4_TECHNICAL_USERNAME is the same user as S4_USERNAME'));
      warnSpy.mockRestore();
    });
  });
});
