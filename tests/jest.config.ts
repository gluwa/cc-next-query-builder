import type { Config } from '@jest/types';
import { resolve } from 'path';

const rootDir = resolve(__dirname, '..');

const config: Config.InitialOptions = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testTimeout: 30_000,
  globalSetup: './tests/globalSetup.ts',
  collectCoverage: true,
  coverageDirectory: 'coverage',
  coverageReporters: ['text', 'html', 'lcov', 'json'],
  collectCoverageFrom: ['src/**/*.ts', '!src/**/*.d.ts', '!src/**/*.test.ts'],
  coveragePathIgnorePatterns: ['/node_modules/', '/tests/', '/dist/'],
  rootDir: rootDir,
  roots: ['<rootDir>/src', '<rootDir>/tests'],
};

export default config;
