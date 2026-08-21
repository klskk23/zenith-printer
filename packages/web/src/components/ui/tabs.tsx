/**
 * shadcn/ui Tabs.
 *
 * Note: the workspace tab bar does NOT use this. Radix Tabs unmounts inactive
 * panels, which would discard the editing state FR-024 requires be kept. This
 * is here for in-page section switching only (e.g. the inspector's panels).
 */
import * as TabsPrimitive from '@radix-ui/react-tabs'
import { cn } from '../../lib/utils.ts'

export const Tabs = TabsPrimitive.Root

export function TabsList({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>): React.JSX.Element {
  return (
    <TabsPrimitive.List
      className={cn('inline-flex items-center justify-center gap-1 rounded-md bg-muted p-1', className)}
      {...props}
    />
  )
}

export function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>): React.JSX.Element {
  return (
    <TabsPrimitive.Trigger
      className={cn(
        'inline-flex items-center justify-center whitespace-nowrap rounded-sm px-3 py-1 text-xs font-medium transition-all',
        'data-[state=active]:bg-background data-[state=active]:shadow-sm',
        className,
      )}
      {...props}
    />
  )
}

export function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>): React.JSX.Element {
  return <TabsPrimitive.Content className={cn('mt-2 focus-visible:outline-none', className)} {...props} />
}
