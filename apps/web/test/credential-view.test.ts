import type { LinkedRepo } from '@slop-control/shared';
import { describe, expect, it } from 'vitest';
import { credentialWording, repoPushWording } from '../src/lib/credential-view';

describe('credentialWording', () => {
  it('says when nothing is stored', () => {
    expect(credentialWording({ isSet: false, state: null, login: null })).toEqual({
      label: 'No credential set',
      tone: 'neutral',
    });
  });

  it('names the login a working credential acts as', () => {
    expect(credentialWording({ isSet: true, state: 'ok', login: 'octocat' })).toEqual({
      label: 'Working · acts as octocat',
      tone: 'ok',
    });
  });

  it('tells a rejected credential from one that could not be checked', () => {
    expect(credentialWording({ isSet: true, state: 'auth_failed', login: 'octocat' }).tone).toBe(
      'danger',
    );
    expect(credentialWording({ isSet: true, state: 'unavailable', login: 'octocat' }).tone).toBe(
      'warn',
    );
  });
});

describe('repoPushWording', () => {
  const repos = [{ id: 'r1', githubOwner: 'acme', githubRepo: 'widgets' }] as LinkedRepo[];

  it('names each linked repo with whether the credential can push to it', () => {
    expect(repoPushWording([{ linkedRepoId: 'r1', canPush: false }], repos)).toEqual([
      { linkedRepoId: 'r1', name: 'acme/widgets', canPush: false },
    ]);
  });

  it('leaves out a repo that is no longer linked', () => {
    expect(repoPushWording([{ linkedRepoId: 'gone', canPush: true }], repos)).toEqual([]);
  });
});
