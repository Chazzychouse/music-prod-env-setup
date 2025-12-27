module.exports = {
    preset: 'ts-jest',
    testEnvironment: 'node',
    roots: ['<rootDir>'],
    testMatch: ['**/__tests__/**/*.test.ts', '**/?(*.)+(spec|test).ts'],
    collectCoverageFrom: [
        'lib/**/*.ts',
        'main.ts',
        '!**/*.d.ts',
        '!**/__tests__/**',
        '!**/node_modules/**',
        '!**/interfaces/**'
    ],
    coverageDirectory: 'coverage',
    coverageReporters: ['text', 'lcov', 'html'],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json'],
    transform: {
        '^.+\\.ts$': ['ts-jest', {
            tsconfig: {
                types: ['node', 'jest']
            }
        }]
    },
    verbose: true,
    forceExit: true,
    testTimeout: 10000
};

