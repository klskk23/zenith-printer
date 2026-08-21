/**
 * Position correction.
 *
 * Four direction boxes over two signed values. Someone who has just reloaded a
 * roll perceives the fault as "it printed too high", so "down 2" is the natural
 * thing to type — asking them to work out that this means y = -2 adds a step
 * where mistakes happen. Opposing boxes clear each other, so the contradictory
 * "up 2 and down 3" cannot be entered.
 *
 * It sits on the printer page rather than in a profile because it describes the
 * machine, not the paper — and it is expected to change on every roll reload.
 */
import { useEffect, useState } from 'react'
import { copy } from '../../i18n/index.ts'
import { Button } from '../../components/ui/button.tsx'
import { Input } from '../../components/ui/input.tsx'
import { Label } from '../../components/ui/label.tsx'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../../components/ui/alert-dialog.tsx'
import type { Printer } from '../../api/types.ts'
import {
  directionsToOffset,
  offsetToDirections,
  setDirection,
  type OffsetDirections,
} from './offset-directions.ts'
import { usePrintCalibrationPage, useSetOffset } from './hooks.ts'

const DIRECTIONS: { key: keyof OffsetDirections; label: string }[] = [
  { key: 'upDots', label: copy.offset.up },
  { key: 'rightDots', label: copy.offset.right },
  { key: 'downDots', label: copy.offset.down },
  { key: 'leftDots', label: copy.offset.left },
]

export function OffsetPanel({ printer }: { printer: Printer }): React.JSX.Element {
  const save = useSetOffset()
  const calibrate = usePrintCalibrationPage()
  const [directions, setDirections] = useState<OffsetDirections>(() => offsetToDirections(printer))
  const [confirming, setConfirming] = useState(false)

  useEffect(() => {
    setDirections(offsetToDirections(printer))
  }, [printer.offsetXDots, printer.offsetYDots])

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">{copy.offset.heading}</h4>
        <Button size="sm" variant="outline" onClick={() => setConfirming(true)}>
          {copy.offset.printCalibration}
        </Button>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DIRECTIONS.map(({ key, label }) => (
          <div key={key} className="space-y-1">
            <Label className="text-[11px]">{label}</Label>
            <Input
              type="number"
              min={0}
              step={1}
              value={directions[key]}
              onChange={(event) =>
                // Typing into one box clears the one facing it, so the pair
                // never holds two contradictory corrections.
                setDirections((current) => setDirection(current, key, Number(event.target.value) || 0))
              }
            />
          </div>
        ))}
      </div>

      <p className="text-[11px] text-muted-foreground">{copy.offset.hint}</p>

      <Button
        size="sm"
        disabled={save.isPending}
        onClick={() => save.mutate({ id: printer.id, ...directionsToOffset(directions) })}
      >
        {copy.offset.save}
      </Button>

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.offset.confirmTitle}</AlertDialogTitle>
            {/* Consuming stock is irreversible; the confirmation says so plainly. */}
            <AlertDialogDescription>{copy.offset.confirmBody}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.offset.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                calibrate.mutate({ id: printer.id })
                setConfirming(false)
              }}
            >
              {copy.offset.confirmPrint}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
