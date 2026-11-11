import { describe, expect, it } from 'vitest';
import { ApiRequestError } from '../src/lib/api';
import { errorText } from '../src/lib/error-text';

describe('errorText', () => {
  it.each([
    ['SESSION_NOT_RESUMABLE', 'Start a new session'],
    ['SESSION_ACTIVE', 'still running'],
    ['SOURCE_DISCONNECTED', 'Reconnect'],
    ['REPO_CHOICE_REQUIRED', 'Choose the repo'],
  ] as const)('gives %s a readable message', (code, expected) => {
    const message = errorText(new ApiRequestError(409, code, code));
    expect(message).toContain(expected);
    expect(message).not.toContain(code);
  });

  it("keeps the server's own message for other codes", () => {
    expect(
      errorText(new ApiRequestError(503, 'RUNTIME_NOT_READY', 'Run `claude auth login`.')),
    ).toBe('Run `claude auth login`.');
  });

  it('falls back for something that is not an error', () => {
    expect(errorText('nope')).toBe('Something went wrong.');
  });
});
