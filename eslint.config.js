'use strict';

const globals = {
    __dirname: 'readonly',
    __filename: 'readonly',
    Buffer: 'readonly',
    clearInterval: 'readonly',
    clearTimeout: 'readonly',
    console: 'readonly',
    exports: 'writable',
    global: 'readonly',
    module: 'readonly',
    process: 'readonly',
    require: 'readonly',
    setImmediate: 'readonly',
    setInterval: 'readonly',
    setTimeout: 'readonly',
    URL: 'readonly',
};

module.exports = [
    {
        files: ['lib/**/*.js', 'tests/integration/**/*.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals,
        },
        rules: {
            'no-redeclare': 'error',
            'no-undef': 'error',
            'no-unused-vars': 'off',
        },
    },
    {
        files: [
            'lib/dashboard-status-collector.js',
            'lib/workflow-rules-report.js',
            'tests/integration/**/*.js',
        ],
        rules: {
            'no-unused-vars': ['error', {
                argsIgnorePattern: '^_',
                caughtErrorsIgnorePattern: '^_',
                varsIgnorePattern: '^_',
            }],
        },
    },
];
