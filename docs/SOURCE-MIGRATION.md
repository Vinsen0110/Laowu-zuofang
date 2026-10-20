# 源码移植路线图

## 背景

老屋作坊基于开源项目 [basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT 许可证）。
线上运行的不是源码，而是一份已经构建好的 bundle（`assets/index-B2KJ37fm.js`，约 1.8MB），
外加仓库根目录下的一批补丁模块。所有定制功能都是直接改在这些文件上的，上游源码里没有。

`web/` 目录是上游源码的拷贝（见 `web/UPSTREAM.md`），用来作为把定制功能移植回真实源码的基础。
**它目前不参与部署**（`.vercelignore` 已排除），线上行为不受影响。

## 已确认的事实

- 上游源码用 bun 可以正常构建（`bun install --frozen-lockfile && bun run build`，约 25 秒）。
- 上游最新构建的主 JS 约 3.7MB，现有 bundle 约 1.8MB：你的版本与上游最新版差距较大，
  并且删掉了一部分上游功能（聊天面板、本地 Canvas Agent、Apilio 站点，见 `tests/removed-*.test.mjs`）。
- 上游源码中没有以下任何定制功能（已逐项搜索确认）。
- 现有 bundle 具体基于上游哪个版本，目前不能确定。

## 定制功能清单

| 功能 | 现有文件 | 相关测试 | 移植状态 |
|---|---|---|---|
| Mart（APIMart）接口 | `apimart-api.js`、`apimart-result-image.js`、`api/apimart-image.js` | `apimart-api`、`apimart-result-image` | 未移植 |
| Tudou 接口（含直连、流式、参考图内联） | `api/tudou-proxy.js`、`tudou-reference-images.js` | `tudou-*`（7 个） | 未移植 |
| RunningHub 接口 | `runninghub-api.js` | `runninghub-*`（4 个） | 未移植 |
| Grsai 接口 | `grsai-api.js` | `grsai-api` | 未移植 |
| Soon 接口 | `soon-api.js` | `soon-api` | 未移植 |
| Cloudinary 参考图上传（自带密钥） | `cloudinary-reference-upload.js`、`CLOUDINARY-SETUP.md` | `cloudinary-reference-upload` | 未移植 |
| 本地存储与工程文件读写 | `app-state-storage.js` | `app-state-storage`、`asset-state-storage-contract`、`project-generation-settings` | 未移植 |
| 画布分组 | `canvas-groups.js`、`canvas-groups.css` | `canvas-group*`（5 个） | 未移植 |
| 价格表 | `canvas-price-table.js` | `price-table`、`tudou-pricing` | 未移植 |
| 参考图界面、面板尺寸、菜单与交互补丁 | `canvas-reference-ui.js`、`canvas-panel-size.js`、`canvas-interaction.css`、`canvas-menus.css` | `canvas-*`（约 20 个） | 未移植 |
| 模型显示名与排序 | `display-model-names.js`、`display-order.js` | `display-model-names*`、`display-order` | 未移植 |
| 主题与启动页 | `theme.css`、`startup-entry.css`、`index.html` 内联样式 | `theme-*`、`startup-entry-contract` | 未移植 |
| 防止拖拽下载 | `prevent-canvas-drag-download.js` | `canvas-drag-download-contract` | 未移植 |
| 站点切换（多渠道） | bundle 内部 + `index.html` 内联脚本 | `site-switching-contract` | 未移植 |
| 本地预览服务器 | `local-preview-server.mjs` | `local-preview-static-cache-contract` | 不需要移植（改用 Vite 开发服务器） |

## 阶段

- 阶段 0（已完成）：补 `LICENSE`，引入 `web/` 上游源码，加 `.vercelignore`。
- 阶段 1：确定移植基线。判断是基于上游最新版移植，还是先找到 bundle 对应的旧版本。
- 阶段 2：移植各家接口（Mart、Tudou、RunningHub、Grsai、Soon）和 Cloudinary 上传，带上原有测试。
- 阶段 3：移植画布界面补丁（分组、价格表、参考图界面、菜单、主题）。
- 阶段 4：移植存储层和站点切换，并核对 bundle 里没有被补丁文件覆盖到的改动。
- 阶段 5：切换部署，改用 Vite 构建产物，保留 `api/` 函数，更新 `vercel.json`，旧补丁文件下线。

## 风险与未知

- Codex 在 bundle 里直接做的改动，不一定都有对应的补丁文件，需要按功能逐项对照，不能靠文件对比。
- 现有 517 个测试大多是针对旧 bundle 的字符串契约，移植后需要改写成针对源码的测试。
- 每个阶段结束都要保证线上版本仍可正常使用，直到阶段 5 才切换。
