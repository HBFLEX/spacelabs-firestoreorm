export default {
    preset: 'ts-jest/presets/default-esm',
    testEnvironment: 'node',
    extensionsToTreatAsEsm: ['.ts'],
    moduleNameMapper: {
        '^(\\.{1,2}/.*)\\.js$': '$1',
    },
    transform: {
        '^.+\\.ts$': [
            'ts-jest',
            {
                useESM: true,
                isolatedModules: true,
                tsconfig: {
                    module: 'ES2022',
                    target: 'ES2022',
                    moduleResolution: 'node',
                    esModuleInterop: true,
                    allowSyntheticDefaultImports: true,
                },
            },
        ],
    },
    testMatch: [
        '**/tests/**/*.test.ts',
        '**/tests/**/*.spec.ts'
    ],
    collectCoverageFrom: [
        'src/**/*.ts',
        '!src/**/*.test.ts',
        '!src/**/*.spec.ts',
        '!src/benchmarks/**'
    ],
    moduleFileExtensions: ['ts', 'tsx', 'js', 'jsx', 'json', 'node'],
    modulePathIgnorePatterns: ['<rootDir>/package/', '<rootDir>/dist/'],
    testPathIgnorePatterns: ['/node_modules/', '/package/', '/dist/'],
};