import { describe, expect, it } from 'vitest';
import {
  parseEnvironment,
  configuredDependencies,
} from '../../apps/api/src/config/environment.js';
describe('server configuration', () => {
  it('keeps health bootable without credentials', () => {
    expect(configuredDependencies(parseEnvironment({}))).toEqual({
      database: false,
      authentication: false,
      storage: false,
      webhook: false,
      maintenance: false,
    });
  });
  it('does not reveal malformed secret values in errors', () => {
    const secret = 'postgresql://private-user:private-password@';
    expect(() => parseEnvironment({ DATABASE_URL: secret })).toThrow(
      'DATABASE_URL',
    );
    try {
      parseEnvironment({ DATABASE_URL: secret });
    } catch (error) {
      expect(String(error)).not.toContain('private-password');
    }
  });
  it('rejects credential-bearing origins and weak maintenance secrets', () => {
    expect(() =>
      parseEnvironment({ WEB_ORIGIN: 'https://user:password@example.com' }),
    ).toThrow('WEB_ORIGIN');
    expect(() => parseEnvironment({ CRON_SECRET: 'short' })).toThrow(
      'CRON_SECRET',
    );
  });
});
