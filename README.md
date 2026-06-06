# DC Tavern Card Showcase

## Docker VPS deploy

Upload this project folder to your VPS, then run:

```bash
chmod +x deploy.sh
./deploy.sh
```

Default port is `8080`:

```bash
APP_PORT=80 ./deploy.sh
APP_PORT=8088 ./deploy.sh restart
./deploy.sh logs
./deploy.sh status
./deploy.sh stop
```

The script builds and starts a Docker container for the app. The container serves the built React UI and a small same-origin Node API.

Server data is stored in the Docker volume `app-data` at `/app/data`. Public visitors read `/api/state`; only an authenticated admin session can write it.

Admin credentials are read from `.env`:

```bash
ADMIN_ACCOUNT=admin
ADMIN_PASSWORD=change-this
ALLOW_FIRST_ADMIN_SETUP=false
```

When `ADMIN_PASSWORD` is empty, `deploy.sh` generates one and writes it into `.env`. Keep that file private.

### Recover old browser localStorage data

If the old site already has cards in browser `localStorage`, deploy this version to the same origin, open that same URL in the browser that contains the old data, then log in as admin. If the server state is empty, the app automatically publishes the old cards, categories, and title to the server and clears those old content keys from `localStorage`.

If the server is not empty but you still want to restore the old browser data, enter admin edit mode and click `恢复本地存档`.

# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the ESLint configuration

If you are developing a production application, we recommend updating the configuration to enable type-aware lint rules:

```js
export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...

      // Remove tseslint.configs.recommended and replace with this
      tseslint.configs.recommendedTypeChecked,
      // Alternatively, use this for stricter rules
      tseslint.configs.strictTypeChecked,
      // Optionally, add this for stylistic rules
      tseslint.configs.stylisticTypeChecked,

      // Other configs...
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```

You can also install [eslint-plugin-react-x](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-x) and [eslint-plugin-react-dom](https://github.com/Rel1cx/eslint-react/tree/main/packages/plugins/eslint-plugin-react-dom) for React-specific lint rules:

```js
// eslint.config.js
import reactX from 'eslint-plugin-react-x'
import reactDom from 'eslint-plugin-react-dom'

export default defineConfig([
  globalIgnores(['dist']),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      // Other configs...
      // Enable lint rules for React
      reactX.configs['recommended-typescript'],
      // Enable lint rules for React DOM
      reactDom.configs.recommended,
    ],
    languageOptions: {
      parserOptions: {
        project: ['./tsconfig.node.json', './tsconfig.app.json'],
        tsconfigRootDir: import.meta.dirname,
      },
      // other options...
    },
  },
])
```
