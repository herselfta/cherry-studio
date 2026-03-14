# 🖥️ 开发指南

## IDE 配置

### VSCode like

- 编辑器：[Cursor](https://www.cursor.com/) 等，任何 VS Code 兼容编辑器均可。
- 推荐扩展见 [`.vscode/extensions.json`](/.vscode/extensions.json)。

### Zed

1. 安装扩展：[Biome](https://github.com/biomejs/biome-zed)、[oxc](https://github.com/oxc-project/zed-oxc)
2. 复制示例配置文件到本地 Zed 配置目录：
   ```bash
   cp .zed/settings.json.example .zed/settings.json
   ```
3. 按需自定义 `.zed/settings.json`（该文件已被 git 忽略）。

## 项目配置

### 安装 Node.js

项目所需的 Node.js 版本定义在 `.node-version` 文件中。推荐使用 [nvm](https://github.com/nvm-sh/nvm)、[fnm](https://github.com/Schniz/fnm) 等版本管理工具自动切换：

```bash
nvm install
```

### 安装 pnpm

pnpm 版本已锁定在 `package.json` 的 `packageManager` 字段中，通过 corepack 即可自动安装对应版本：

```bash
corepack enable
```

### 安装依赖

```bash
pnpm install
```

### 环境变量

```bash
cp .env.example .env
```

### 启动开发

```bash
pnpm dev
```

### 调试

```bash
pnpm debug
```

然后在浏览器中访问 chrome://inspect

### 测试

```bash
pnpm test
```

### 构建

```bash
# Windows
$ pnpm build:win

# macOS
$ pnpm build:mac

# Linux
$ pnpm build:linux
```

### macOS 本地签名

现在 `pnpm build:mac` 默认会拒绝生成 `ad hoc` 签名包。这样可以避免 macOS TCC 的一个问题：每次你用新的 `ad hoc` `.app` 覆盖安装后，划词助手的辅助功能权限都会被系统当成新的应用身份而失效。

如果你想在本地打出可稳定更新的 macOS 包，请先在 `钥匙串访问` 里创建一个会长期复用的 `Code Signing` 证书：

1. 打开 `钥匙串访问` -> `证书助理` -> `创建证书...`
2. 证书名称填写 `Cherry Studio Local Code Signing`
3. `Identity Type` 选择 `Self Signed Root`
4. `Certificate Type` 选择 `Code Signing`
5. 保存到 `login` 钥匙串，然后重新执行 `pnpm build:mac`

mac 构建脚本会自动选择合适的签名身份；如果你想强制指定某个证书，可以设置 `CSC_NAME`。

```bash
# 可选：强制使用指定的本地签名身份
$ CSC_NAME='Cherry Studio Local Code Signing' pnpm build:mac

# 明确需要 ad hoc 包时使用（替换更新后仍会重置划词助手的辅助功能权限）
$ pnpm build:mac:adhoc
```
