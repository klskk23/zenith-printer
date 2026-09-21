# Architecture & Technical Constraints / 架构与技术约束

全栈使用严格模式 TypeScript，前后端同仓，单进程部署。后端为 Node.js + Fastify + zod + SQLite；前端为 Vite + React + Tailwind CSS + shadcn/ui。 The stack uses strict TypeScript in one repository and a single process: Node.js + Fastify + zod + SQLite on the backend, and Vite + React + Tailwind CSS + shadcn/ui on the frontend.

编辑器使用 SVG DOM，不使用 canvas。UI 优先使用 shadcn/ui；自建组件必须复用 Tailwind 主题变量、`cn()` 与 Radix 原语，并在评审中说明缺少的 shadcn/ui 替代。 The editor uses SVG DOM rather than canvas. Prefer shadcn/ui; custom components must reuse Tailwind theme variables, `cn()`, and Radix primitives, with the missing shadcn/ui alternative explained in review.

渲染使用 `@resvg/resvg-js`（打包字体，`loadSystemFonts: false`）和 `bwip-js`；`sharp` 只用于二值化与格式转换，不得用于渲染 SVG 文字。 Rendering uses `@resvg/resvg-js` with bundled fonts and `loadSystemFonts: false`, plus `bwip-js`; `sharp` is only for binarization and format conversion and must not render SVG text.

精臣使用 `@mmote/niimbluelib` 的 B1 打印任务与 `/dev/ttyACM0`；霍尼韦尔使用 ZSim/ZPL over raw TCP 9100。单位以 mm 存储，先把画布转为整数 dot：`dot = round(mm × dpi / 25.4)`，元素坐标基于该 dot 网格计算。 The supported printer paths are Niimbot B1 over `/dev/ttyACM0` and Honeywell ZSim/ZPL over raw TCP 9100. Store units in mm, convert the canvas to integer dots first with `dot = round(mm × dpi / 25.4)`, and calculate element coordinates on that dot grid.
