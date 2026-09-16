const js = require("@eslint/js");
const globals = require("globals");

module.exports = [
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        cds: "readonly",
        SELECT: "readonly",
        INSERT: "readonly",
        UPDATE: "readonly",
        DELETE: "readonly",
        CREATE: "readonly",
        DROP: "readonly",
      },
    },
    rules: {
      "no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_|^(cds|LOG)$",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "no-console": "off",
      "no-empty": ["error", { allowEmptyCatch: true }],
      "no-control-regex": "off",
      "preserve-caught-error": "off",
      "no-useless-assignment": "off",
    },
  },
  {
    files: ["test/**/*.js"],
    languageOptions: {
      globals: {
        ...globals.jest,
        fail: "readonly",
      },
    },
  },
  {
    ignores: [
      "app/**",
      "dist/**",
      "gen/**",
      "mta_archives/**",
      "logs/**",
      "docs/**",
      "node_modules/**",
      "coverage/**",
    ],
  },
];
