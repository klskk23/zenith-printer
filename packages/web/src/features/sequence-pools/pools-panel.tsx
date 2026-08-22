/**
 * Sequence pools.
 *
 * Pools live here rather than inside a design because they are shared: a
 * small-box label and a carton label drawing from one run of numbers is the
 * reason they exist as standalone objects at all.
 *
 * The current value is read-only. It is derived from what was actually printed,
 * and offering an editable field next to it would put a second copy of the
 * number beside the evidence — with no way to say which one is on the labels.
 */
import { useState } from 'react'
import { Button } from '../../components/ui/button.tsx'
import { Card, CardContent, CardHeader, CardTitle } from '../../components/ui/card.tsx'
import { ConfirmButton } from '../../components/ui/confirm-button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import { copy } from '../../i18n/index.ts'
import { useCreatePool, useDeletePool, useResetPool, useSequencePools } from './hooks.ts'

export function PoolsPanel(): React.JSX.Element {
  const pools = useSequencePools()
  const createPool = useCreatePool()
  const resetPool = useResetPool()
  const deletePool = useDeletePool()

  const [name, setName] = useState('')
  const [digits, setDigits] = useState(6)
  const [resetTo, setResetTo] = useState<Record<string, number>>({})

  return (
    <Card data-sequence-pools>
      <CardHeader className="pb-2">
        <CardTitle>{copy.pools.heading}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-[11px] text-muted-foreground">{copy.pools.explain}</p>

        {pools.data?.length === 0 && (
          <p className="text-[11px] text-muted-foreground">{copy.pools.empty}</p>
        )}

        {pools.data?.map((pool) => (
          <div key={pool.id} className="space-y-1 rounded-md border border-border p-2">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-sm font-medium">{pool.name}</span>
              <span className="font-mono text-xs text-muted-foreground">
                {copy.pools.nextIs(String(pool.nextValue).padStart(pool.digits, '0'))}
              </span>
            </div>

            <div className="flex items-end gap-2">
              <Label className="flex-1 space-y-1">
                <span className="text-[11px] text-muted-foreground">
                  {copy.pools.resetTo(String(pool.floor).padStart(pool.digits, '0'))}
                </span>
                <Input
                  type="number"
                  min={0}
                  value={resetTo[pool.id] ?? pool.nextValue}
                  onChange={(event) =>
                    setResetTo({ ...resetTo, [pool.id]: Math.max(0, Number(event.target.value) || 0) })
                  }
                />
              </Label>
              <ConfirmButton
                variant="outline"
                size="sm"
                title={copy.pools.resetTitle(pool.name)}
                // Says what actually happens, not "are you sure": restarting
                // below a number already printed reissues it, and two boxes
                // with the same serial cannot be told apart afterwards.
                description={copy.pools.resetWarning}
                cancelLabel={copy.common.cancel}
                confirmLabel={copy.pools.resetConfirm}
                onConfirm={() =>
                  resetPool.mutate({ id: pool.id, floor: resetTo[pool.id] ?? pool.nextValue })
                }
              >
                {copy.pools.reset}
              </ConfirmButton>
              <ConfirmButton
                variant="ghost"
                size="sm"
                title={copy.pools.deleteTitle(pool.name)}
                description={copy.pools.deleteWarning}
                cancelLabel={copy.common.cancel}
                confirmLabel={copy.pools.deleteConfirm}
                onConfirm={() => deletePool.mutate(pool.id)}
              >
                {copy.pools.delete}
              </ConfirmButton>
            </div>

            {deletePool.isError && (
              <p className="text-[11px] text-destructive">{copy.pools.deleteRefused}</p>
            )}
          </div>
        ))}

        <div className="flex items-end gap-2 border-t border-border pt-2">
          <Label className="flex-1 space-y-1">
            <span className="text-[11px] text-muted-foreground">{copy.pools.name}</span>
            <Input value={name} onChange={(event) => setName(event.target.value)} />
          </Label>
          <Label className="w-24 space-y-1">
            <span className="text-[11px] text-muted-foreground">{copy.pools.digits}</span>
            <Input
              type="number"
              min={1}
              max={12}
              value={digits}
              onChange={(event) => setDigits(Math.max(1, Math.min(12, Number(event.target.value) || 1)))}
            />
          </Label>
          <Button
            size="sm"
            disabled={name.trim().length === 0}
            onClick={() => {
              createPool.mutate({ name: name.trim(), digits, step: 1 })
              setName('')
            }}
          >
            {copy.pools.add}
          </Button>
        </div>
      </CardContent>
    </Card>
  )
}
