# 契约：驱动端口的流式变更

宪章约束的端口契约。本次变更影响**四个驱动**：精臣、ZPL、dry-run、以及搁置在
`tspl-gp3120tu` 分支上的 TSPL。

## 变更

```diff
 export interface PrinterDriver {
   printPages(
-    pages: BinaryBitmap[],
+    pages: PageSource,
     options: PrintOptions,
     onProgress: ProgressHandler,
   ): Promise<void>
 }

+export interface PageSource {
+  /** 总张数。驱动需要提前知道它：TSPL 的 PRINT、进度上报、已印张数都要用。 */
+  readonly total: number
+  /** 按下标取页。渲染是同步的，故此处不异步。 */
+  at(index: number): BinaryBitmap
+}
```

## 为什么不是 `Iterable`

`Iterable` 提供不了**总数**，而总数是驱动的必需品而非便利品。`AsyncIterable` 则会把
整条打印路径异步化——队列、四个驱动、以及 `renderPage` 回调——而渲染本身是同步的，
异步化只是把改动面扩大一圈。

`at(index)` 还让**补打**天然可行：补打的是同一批中的某一段，按下标取即可。

## 驱动侧的义务

- MUST 逐页取用，MUST NOT 在开始输出之前把所有页取完（否则流式失去意义，
  第一张标签仍要等全部渲染完成）
- MUST 在每页发出后上报进度（既有行为不变）
- 失败时 MUST 保持 `pagesPrinted` 的既有语义：已发出的张数，崩溃导致不可知时为 `null`

## 队列侧的义务

- `renderPage` 的调用改为按需，MUST NOT 预先构建整个数组
- MUST 在第一页渲染完成后立刻交给驱动，使 SC-003（一秒内出纸）成立
