import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // dev-dist is the PWA plugin's generated dev bundle (gitignored), not our code
  globalIgnores(['dist', 'dev-dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
  {
    // These files export plain helpers/constants next to their components. That only affects dev hot-reload
    // (a full reload instead of a patch), never behaviour, and moving them would touch many importers.
    files: ['src/components/Cleaning/CleaningPage.tsx', 'src/components/PWA/InstallPrompt.tsx', 'src/components/RoomManagement/RoomStatusDashboard.tsx'],
    rules: { 'react-refresh/only-export-components': 'off' },
  },
  {
    // Tests read untyped JSON bodies from fake responses; `any` there is fine and keeps them readable.
    files: ['**/*.test.{ts,tsx}'],
    rules: { '@typescript-eslint/no-explicit-any': 'off' },
  },
])