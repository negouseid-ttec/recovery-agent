module.exports = {
  testEnvironment: 'node',
  collectCoverageFrom: ['lib/**/*.ts'],
  coverageReporters: ['text', 'lcov', 'json-summary', 'clover'],
  roots: ['<rootDir>/test'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.tsx?$': ['ts-jest', { tsconfig: { esModuleInterop: true, skipLibCheck: true } }],
  },
};
