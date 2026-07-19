import { describe, it, expect } from 'vitest';
import { DomainError } from '../errors.js';

describe('DomainError', () => {
  it('sets code, message and name', () => {
    const err = new DomainError('test_code', 'test message');
    expect(err.code).toBe('test_code');
    expect(err.message).toBe('test message');
    expect(err.name).toBe('DomainError');
    expect(err instanceof Error).toBe(true);
  });
});
