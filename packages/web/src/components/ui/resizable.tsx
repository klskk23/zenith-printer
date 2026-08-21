/**
 * shadcn/ui Resizable, over react-resizable-panels v4.
 *
 * The editor is three columns whose useful widths depend on the work: a label
 * with many elements wants a taller layer list, a barcode-heavy one wants a
 * wider property panel. Fixed widths force a compromise that is wrong for both.
 *
 * **This is not shadcn's published resizable.tsx.** That one is written against
 * v2, whose exports were `PanelGroup` and `PanelResizeHandle`; v4 renamed them
 * to `Group` and `Separator` and changed how sizes are expressed. Copying the
 * published file compiles and then fails at render with "element type is
 * invalid", because the imports resolve to undefined.
 *
 * Two v4 details worth stating, both easy to get silently wrong:
 *
 *   - `defaultSize={16}` means **16 pixels**. Percentages are strings:
 *     `defaultSize="16"`. A number where a percentage was meant produces a
 *     column a few pixels wide rather than an error.
 *   - persistence is `useDefaultLayout`, not an `autoSaveId` prop.
 */
import { GripVertical } from 'lucide-react'
import { Group, Panel, Separator as PanelSeparator, useDefaultLayout } from 'react-resizable-panels'
import { safeLocalStorage } from '../../lib/storage.ts'
import { cn } from '../../lib/utils.ts'

export function ResizablePanelGroup({
  className,
  ...props
}: React.ComponentProps<typeof Group>): React.JSX.Element {
  return (
    <Group
      className={cn('flex h-full w-full data-[orientation=vertical]:flex-col', className)}
      {...props}
    />
  )
}

export const ResizablePanel = Panel

export function ResizableHandle({
  withHandle,
  className,
  ...props
}: React.ComponentProps<typeof PanelSeparator> & { withHandle?: boolean }): React.JSX.Element {
  return (
    <PanelSeparator
      className={cn(
        'relative flex w-px items-center justify-center bg-border transition-colors',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2',
        'hover:bg-primary/40 focus-visible:outline-none focus-visible:ring-1',
        className,
      )}
      {...props}
    >
      {withHandle === true && (
        <div className="z-10 flex h-4 w-3 items-center justify-center rounded-sm border border-border bg-background">
          <GripVertical className="h-2.5 w-2.5" />
        </div>
      )}
    </PanelSeparator>
  )
}

/**
 * Remember a group's column widths for this browser.
 *
 * View layout rather than a setting, so it stays out of the preferences store —
 * nobody goes looking for their column widths on a settings page.
 */
export function useRememberedLayout(id: string): ReturnType<typeof useDefaultLayout> {
  return useDefaultLayout({
    id,
    storage: safeLocalStorage(),
    // Window resizes should not overwrite a width the user chose deliberately.
    onlySaveAfterUserInteractions: true,
  })
}
