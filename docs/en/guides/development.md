# 🖥️ Develop

## IDE Setup

### VSCode like

- Editor: [Cursor](https://www.cursor.com/), etc. Any VS Code compatible editor.
- Recommended extensions are listed in [`.vscode/extensions.json`](/.vscode/extensions.json).

### Zed

1. Install extensions: [Biome](https://github.com/biomejs/biome-zed), [oxc](https://github.com/oxc-project/zed-oxc)
2. Copy the example settings file to your local Zed config:
   ```bash
   cp .zed/settings.json.example .zed/settings.json
   ```
3. Customize `.zed/settings.json` as needed (it is git-ignored).

## Project Setup

### Install

```bash
pnpm install
```

### Development

### Setup Node.js

The required Node.js version is defined in `.node-version`. Use a version manager like [nvm](https://github.com/nvm-sh/nvm) or [fnm](https://github.com/Schniz/fnm) to install it automatically:

```bash
nvm install
```

### Setup pnpm

The pnpm version is locked in the `packageManager` field of `package.json`. Just enable corepack and it will use the correct version automatically:

```bash
corepack enable
```

### Install Dependencies

```bash
pnpm install
```

### ENV

```bash
cp .env.example .env
```

### Start

```bash
pnpm dev
```

### Debug

```bash
pnpm debug
```

Then input chrome://inspect in browser

### Test

```bash
pnpm test
```

### Build

```bash
# For windows
$ pnpm build:win

# For macOS
$ pnpm build:mac

# For Linux
$ pnpm build:linux
```

### macOS Local Signing

`pnpm build:mac` now refuses to produce ad hoc-signed packages by default. This avoids a macOS TCC issue where replacing an ad hoc-signed `.app` causes Selection Assistant to lose its Accessibility permission after each update.

To build a stable local package, create a persistent `Code Signing` certificate in Keychain Access and keep reusing the same identity:

1. Open `Keychain Access` -> `Certificate Assistant` -> `Create a Certificate...`
2. Use `Cherry Studio Local Code Signing` as the certificate name
3. Set `Identity Type` to `Self Signed Root`
4. Set `Certificate Type` to `Code Signing`
5. Save it to your `login` keychain, then rerun `pnpm build:mac`

The mac build script will automatically pick the first suitable signing identity. If you need to force a specific one, set `CSC_NAME`.

```bash
# Optional: force a specific local identity
$ CSC_NAME='Cherry Studio Local Code Signing' pnpm build:mac

# Intentional ad hoc build (Selection Assistant Accessibility permission will reset after replacement updates)
$ pnpm build:mac:adhoc
```
