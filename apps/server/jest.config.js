/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  rootDir: '.',
  testRegex: 'test/.*\\.spec\\.ts$',
  moduleFileExtensions: ['ts', 'js', 'json'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { tsconfig: 'tsconfig.json' }],
  },
  globalSetup: '<rootDir>/test/support/global-setup.ts',
  setupFiles: ['<rootDir>/test/support/setup-env.ts'],
  // Spec files share one test database.
  maxWorkers: 1,
  testTimeout: 20000,
};
