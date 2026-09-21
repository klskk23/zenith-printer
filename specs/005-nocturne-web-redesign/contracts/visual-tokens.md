# Contract: 视觉令牌（Nocturne → Tailwind `@theme`）

**Feature**: `005-nocturne-web-redesign` | 文件：`packages/web/src/index.css`

Nocturne 的 `:root` 是权威来源；下表是它到本项目 shadcn 语义令牌的**唯一**映射。测试 `design-tokens.test.ts` 读 `index.css` 断言这些值与对比度；改任何一格都要同时改表和测试。

---

## 语义令牌（shadcn 用到的）

| `@theme` 变量 | 值 | Nocturne 来源 | 对比度门槛（对 `background`） |
|---|---|---|---|
| `--color-background` | `#161826` | `--color-bg` | — |
| `--color-foreground` | `#e9e9ed` | `--color-text` | ≥ 4.5（实测 ~14） |
| `--color-card` | `#232532` | `--color-surface` | — |
| `--color-card-foreground` | `#e9e9ed` | `--color-text` | ≥ 4.5 对 `card` |
| `--color-popover` / `-foreground` | 同 card | | |
| `--color-primary` | `#9184d9` | `--color-accent` | ≥ 3（只做线、描边、焦点环、大字） |
| `--color-primary-foreground` | `#161826` | `--color-bg` | 仅 hover 淡染时用不到实心 |
| `--color-accent-300` | `#d2cefd` | `--color-accent-300` | ≥ 4.5（正文字号的强调文字） |
| `--color-secondary` | `#3f424d` | `--color-neutral-800` | — |
| `--color-secondary-foreground` | `#f3f5fe` | `--color-neutral-100` | ≥ 4.5 对 secondary |
| `--color-muted` | `#292b31` | `--color-neutral-900` | — |
| `--color-muted-foreground` | `#9397ab` | `--color-neutral-500` | ≥ 4.5 |
| `--color-accent` / `-foreground` | `#2b2741` / `#e7e5fe` | `--color-accent-900` / `-200` | hover 淡染面 |
| `--color-destructive` | `#e07a7a`（见注 1） | 无 | ≥ 4.5 |
| `--color-border` | `color-mix(in srgb, #e9e9ed 16%, transparent)` | `--color-divider` | 无门槛（装饰线） |
| `--color-input` | `color-mix(in srgb, #e9e9ed 45%, transparent)` | `.input:hover` 的边 | ≥ 3（可输入控件的边界） |
| `--color-ring` | `#9184d9` | `--color-accent` | |
| `--color-warning` | `#d9a441`（见注 1） | 无 | ≥ 4.5 |
| `--color-info` | `#9184d9` | `--color-accent` | |
| `--color-success` | `#7fb58a`（见注 1） | 无 | ≥ 4.5 |
| `--color-neutral-100…900` | Nocturne 阶梯原值 | `--color-neutral-*` | |
| `--color-accent-100…900` | Nocturne 阶梯原值 | `--color-accent-*` | |

**注 1**：Nocturne 只有一个强调色，没有语义状态色。`destructive/warning/success` 是本应用已有的三个状态角色（"失败与不可逆 / 印了但不对 / 完成"），Nocturne 没给，必须补。补的原则：**低饱和、只做文字与线**、与 Nocturne 同一 OKLCH 亮度带，测过 ≥ 4.5。这是"一个 token 不动"之外**新增**的三个，不是改动。

---

## 圆角、间距、阴影、字体

| `@theme` 变量 | 值 | 来源 |
|---|---|---|
| `--radius-sm` / `-md` / `-lg` | `4px` / `8px` / `14px` | `--radius-sm/md/lg` |
| `--radius` | `8px` | shadcn 的基数 = `md` |
| `--shadow-sm` | `0 0 0 1px #3f424d` | `--shadow-sm` |
| `--shadow-md` | `0 0 0 1px #595d6c, 0 6px 18px rgba(0,0,0,.55)` | `--shadow-md` |
| `--shadow-lg` | `0 0 0 1px #9397ab, 0 16px 40px rgba(0,0,0,.65)` | `--shadow-lg` |
| `--font-sans` | `'Inter', 'Noto Sans CJK SC', system-ui, sans-serif` | `--font-body` + 本项目中文字体 |
| `--font-mono` | `'DejaVu Sans Mono', ui-monospace, monospace` | 既有 |
| `--text-2xs` / `--text-xs` | 保留现值 | 既有密度阶梯 |
| 壳层间距 | `2.8 / 5.6 / 8.4 / 11.2 / 16.8 / 22.4 px` | `--space-1…8`；以 `--spacing-n1…n8` 命名暴露，只在壳层组件使用（见 research R1） |

**标题**：`h1–h6` 与 `PageHeader` 字重 500，无衬线。**删除** `--font-display`。

---

## 纸（唯一的白）

```css
.paper {
  background: #ffffff;
  color: #14151c;                      /* 墨：非纯黑 */
  border-radius: 3px;                  /* 模切标签的小圆角，不用 --radius */
  box-shadow: 0 0 0 1px rgba(255,255,255,.30),
              0 0 22px -1px rgba(233,233,237,.26),
              0 0 70px -6px rgba(233,233,237,.16),
              0 10px 30px rgba(0,0,0,.6);   /* 灯箱：微光 + 落影 */
}
.paper-lg { border-radius: 5px; box-shadow: /* 更大的光晕，画布用 */ }
```

**规则**：`#ffffff`、`white`、`bg-white` 在 `src/**` 只允许出现在 `.paper` 的定义处（`index.css`）。`[data-label-canvas]` 改为携带 `.paper.paper-lg`。缩略图、打印预览、历史快照的容器一律 `.paper`。

---

## 组件形态（通过 `cva` 变体，不新增类体系）

| 组件 | Nocturne 形态 | 落点 |
|---|---|---|
| Button `default` | 强调色 1px 描边、透明底、hover 12% 淡染 | `button.tsx` 变体（已是描边，调色即可） |
| Button `secondary` | `border-border`、hover 7% 文字色淡染 | 同上 |
| Button `ghost` | 强调色文字、无边 | 同上 |
| Card | `bg-card` + `shadow-sm`（1px 边线阴影） | `card.tsx` |
| Input | `bg-transparent` + `border-input`；focus `border-ring` | `input.tsx` |
| Separator（横向、独立） | 两端淡出：`linear-gradient(90deg, transparent, var(--color-border) 48px, var(--color-border) calc(100% - 48px), transparent)` | `separator.tsx` 新增 `fade` 属性 |
| Table 行线 | 同上淡出 | `table.tsx` |
| Dialog | `bg-card` + `shadow-lg` + `rounded-lg`(14px) | `dialog.tsx`、`alert-dialog.tsx` |
| focus-visible | `outline: 2px solid var(--color-ring); outline-offset: 2px` | 全局一条规则 |
| 图片 | `mix-blend-mode: lighten` 仅对**非标签**图片（当前无此类图片，预留 `.lighten`） | 不适用于纸 |

被删除：所有 `[data-classical-*]` 选择器与 `.classical-*` 类、`--color-classical-*`、`--shadow-sheet`、`--font-display`。
