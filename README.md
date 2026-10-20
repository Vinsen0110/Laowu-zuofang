# 老屋作坊

AI 图像生成无限画布，个人使用。基于开源项目
[basketikun/infinite-canvas](https://github.com/basketikun/infinite-canvas)（MIT 许可证，见 `LICENSE`）修改。

## 结构

线上运行的是已经构建好的前端 `assets/index-*.js`，外加仓库根目录下的补丁模块
（各家接口、价格表、画布分组等）和 `api/` 下的 Vercel 函数。没有前端源码，改动直接做在这些文件上。

## 常用命令

- 跑测试：`node --test tests/*.test.mjs`
- 本地预览：`node local-preview-server.mjs`（默认 http://127.0.0.1:4173）

## 改动后要注意

`vercel.json` 给 `assets/` 设了一年的长期缓存。只要改了 `assets/index-*.js` 的内容，
就要同时更新 `index.html` 里引用它的 `?v=` 版本号，否则已经访问过的浏览器不会拿到新版本。
