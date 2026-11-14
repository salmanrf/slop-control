import type { CredentialStatus, LinkedRepo, RepoPushAccess } from '@slop-control/shared';
import type { Tone } from './session-view';

export interface CredentialWording {
  label: string;
  tone: Tone;
}

/** One line for a stored credential, from its last check. The token itself is never known here. */
export function credentialWording(
  credential: Pick<CredentialStatus, 'isSet' | 'state' | 'login'>,
): CredentialWording {
  if (!credential.isSet) return { label: 'No credential set', tone: 'neutral' };
  switch (credential.state) {
    case 'auth_failed':
      return { label: 'Rejected by GitHub', tone: 'danger' };
    case 'unavailable':
      return { label: "Couldn't be checked", tone: 'warn' };
    default:
      return {
        label: credential.login ? `Working · acts as ${credential.login}` : 'Working',
        tone: 'ok',
      };
  }
}

export interface RepoPushWording {
  linkedRepoId: string;
  name: string;
  canPush: boolean;
}

/** Push access per linked repo, named for display. A repo unlinked since the check is left out. */
export function repoPushWording(access: RepoPushAccess[], repos: LinkedRepo[]): RepoPushWording[] {
  return access.flatMap(({ linkedRepoId, canPush }) => {
    const repo = repos.find((item) => item.id === linkedRepoId);
    return repo ? [{ linkedRepoId, name: `${repo.githubOwner}/${repo.githubRepo}`, canPush }] : [];
  });
}
