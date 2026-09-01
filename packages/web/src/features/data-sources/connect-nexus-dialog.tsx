/**
 * Connecting a data source to a category of the asset ledger.
 *
 * **One choice, and nothing else to fill in.** The address and the key belong
 * to the deployment and come from the environment; which column identifies a
 * device is the ledger's own answer, not a question. Every field this dialog
 * does not have is a field nobody can get wrong, and a value nobody has to keep
 * in step with the environment it was copied from.
 *
 * The columns of the chosen category are shown before anything is created,
 * because the next thing somebody does is write `${…}` into a design — and
 * without this they would have to create the source, refresh it, and then go
 * and look.
 */
import { useState } from 'react'
import { ApiRequestError } from '../../api/client.ts'
import { copy } from '../../i18n/index.ts'
import { Alert } from '../../components/ui/alert.tsx'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { Skeleton } from '../../components/ui/skeleton.tsx'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/select.tsx'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '../../components/ui/dialog.tsx'
import {
  useCreateNexusSource,
  useNexusCategories,
  useNexusCategoryColumns,
  type NexusCategory,
} from './hooks.ts'

/**
 * How deep a category sits, from its own path.
 *
 * `/ancestor/…/self/` — so the separators minus one is the depth. Indenting is
 * cosmetic and the list reads fine without it, which is why a missing or
 * malformed path simply means no indent rather than an error.
 */
export function depthOf(category: NexusCategory): number {
  const path = category.path
  if (path === undefined || path.length === 0) {
    return 0
  }
  return Math.max(0, path.split('/').filter(Boolean).length - 1)
}

export function ConnectNexusDialog({
  open,
  onOpenChange,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
}): React.JSX.Element {
  const [categoryId, setCategoryId] = useState<string | null>(null)
  const [name, setName] = useState('')
  const categories = useNexusCategories()
  const columns = useNexusCategoryColumns(open ? categoryId : null)
  const create = useCreateNexusSource()

  /**
   * Read once, defensively.
   *
   * `data.categories.length` on an answer that did not carry the field throws
   * during render, and a throw in a dialog takes the whole page with it —
   * blank, with the error only in the console. A dropdown is not worth that.
   */
  const list = categories.data?.categories ?? []
  const chosen = list.find((category) => category.id === categoryId)

  const submit = (): void => {
    if (categoryId === null) {
      return
    }
    create.mutate(
      { categoryId, ...(name.trim().length > 0 ? { name: name.trim() } : {}) },
      {
        onSuccess: () => {
          setCategoryId(null)
          setName('')
          onOpenChange(false)
        },
      },
    )
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent data-connect-nexus>
        <DialogHeader>
          <DialogTitle>{copy.dataSources.nexusTitle}</DialogTitle>
          <DialogDescription>{copy.dataSources.nexusExplain}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {categories.isPending && <Skeleton className="h-9" />}

          {/* Said plainly rather than shown as an empty dropdown. A select with
              no options is a dead end that looks like a loading state. */}
          {categories.isError && (
            <Alert variant="destructive" className="text-xs" data-nexus-unreachable>
              {categories.error instanceof ApiRequestError
                ? categories.error.body.what
                : copy.dataSources.nexusUnreachable}
            </Alert>
          )}

          {categories.data !== undefined && list.length === 0 && (
            <Alert className="text-xs">{copy.dataSources.nexusNoCategories}</Alert>
          )}

          {list.length > 0 && (
            <Label className="block space-y-1">
              <span className="text-2xs text-muted-foreground">{copy.dataSources.nexusCategory}</span>
              <Select value={categoryId ?? ''} onValueChange={setCategoryId}>
                <SelectTrigger aria-label={copy.dataSources.nexusCategory}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {list.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {/* Indented by its place in the tree, which the ledger
                          already told us in `path`. */}
                      {' '.repeat(depthOf(category) * 2)}
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </Label>
          )}

          {/* Optional: the category already has a name somebody chose. */}
          <Label className="block space-y-1">
            <span className="text-2xs text-muted-foreground">
              {copy.dataSources.nexusName(chosen?.name ?? '')}
            </span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Label>

          {categoryId !== null && columns.isSuccess && (
            <p className="text-2xs text-muted-foreground" data-nexus-columns>
              {copy.dataSources.nexusColumns(columns.data.columns, columns.data.total)}
            </p>
          )}

          {create.isError && (
            <Alert variant="destructive" className="text-xs">
              {create.error instanceof ApiRequestError
                ? create.error.body.what
                : copy.dataSources.nexusTitle}
            </Alert>
          )}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            {copy.common.cancel}
          </Button>
          <Button disabled={categoryId === null || create.isPending} onClick={submit}>
            {copy.dataSources.nexusConnect}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
