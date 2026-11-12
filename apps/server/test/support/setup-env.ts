/**
 * A session's base is fetched from the clone's `origin` before its worktree is created. Test clones
 * name GitHub over SSH, so this makes that transport fail at once, without touching the network.
 * Suites that test the fetch use local origins, which don't go through SSH.
 */
process.env.GIT_SSH_COMMAND = '/usr/bin/false';
