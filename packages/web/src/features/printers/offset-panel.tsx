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
import { Check } from 'lucide-react'
import { ApiRequestError } from '../../api/client.ts'
import { Alert } from '../../components/ui/alert.tsx'
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
import { NONE, Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '../../components/ui/select.tsx'
import { useProfiles } from '../profiles/hooks.ts'
import { usePrintCalibrationPage, useSetOffset } from './hooks.ts'

/**
 * Keys only. The labels are read at render time.
 *
 * Holding the text here would freeze it at module load: `copy` resolves against
 * whichever bundle is active *when it is read*, and a module-level constant is
 * read exactly once, before anyone has chosen a language.
 */
const DIRECTIONS = ['upDots', 'rightDots', 'downDots', 'leftDots'] as const satisfies readonly (keyof OffsetDirections)[]

const DIRECTION_LABELS = {
  upDots: 'up',
  rightDots: 'right',
  downDots: 'down',
  leftDots: 'left',
} as const

export function OffsetPanel({ printer }: { printer: Printer }): React.JSX.Element {
  const save = useSetOffset()
  const calibrate = usePrintCalibrationPage()
  const profiles = useProfiles(printer.id)
  const [directions, setDirections] = useState<OffsetDirections>(() => offsetToDirections(printer))
  const [confirming, setConfirming] = useState(false)
  const [profileId, setProfileId] = useState<string | null>(null)

  /**
   * Which roll the calibration page is for.
   *
   * The page is measured against the edges of the paper, so it has to be the
   * size of the paper — and the size of a roll is what a profile records.
   * Defaults to the printer's default profile, which is the roll most likely
   * to be loaded.
   */
  const stock =
    profiles.data?.find((p) => p.id === profileId) ??
    profiles.data?.find((p) => p.isDefault) ??
    profiles.data?.[0] ??
    null

  useEffect(() => {
    setDirections(offsetToDirections(printer))
  }, [printer.offsetXDots, printer.offsetYDots])

  return (
    <div className="space-y-2 rounded-md border border-border p-3">
      <div className="flex items-center justify-between">
        <h4 className="text-xs font-semibold">{copy.offset.heading}</h4>
        <div className="flex items-end gap-2">
          {/*
            Choosing the stock rather than typing its size: the size is already
            recorded on the profile, and a second place to enter it is a second
            place for it to be wrong.
          */}
          <Select
            value={stock?.id ?? NONE}
            disabled={(profiles.data?.length ?? 0) === 0}
            onValueChange={(value) => setProfileId(value === NONE ? null : value)}
          >
            <SelectTrigger className="h-8 w-44 text-xs" aria-label={copy.offset.stock}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {profiles.data?.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} · {p.labelWidthMm}×{p.labelHeightMm}mm
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Button size="sm" variant="outline" disabled={stock === null} onClick={() => setConfirming(true)}>
            {copy.offset.printCalibration}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {DIRECTIONS.map((key) => (
          <div key={key} className="space-y-1">
            <Label className="text-[11px]">{copy.offset[DIRECTION_LABELS[key]]}</Label>
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

      {(profiles.data?.length ?? 0) === 0 && (
        // Refused rather than guessed: a calibration page at the printhead's
        // full width on a 50 mm roll is a wasted label that cannot be measured.
        <Alert className="text-xs">{copy.offset.needsProfile}</Alert>
      )}

      {calibrate.error instanceof ApiRequestError && (
        <Alert variant="destructive" className="text-xs">
          <p className="font-medium">{calibrate.error.body.what}</p>
          <p className="mt-1 opacity-90">{calibrate.error.body.why}</p>
          <p className="mt-1 font-medium">{calibrate.error.body.next}</p>
        </Alert>
      )}

      <div className="flex items-center gap-2">
        <Button
          size="sm"
          disabled={save.isPending}
          onClick={() => save.mutate({ id: printer.id, ...directionsToOffset(directions) })}
        >
          {copy.offset.save}
        </Button>
        {/*
          Saving a correction produces no visible change anywhere — the printer
          list looks identical afterwards — so without this the operator has no
          way to know it took. The copy for it existed and was never rendered.
        */}
        {save.isSuccess && !save.isPending && (
          <span className="flex items-center gap-1 text-[11px] text-muted-foreground">
            <Check className="h-3 w-3" />
            {copy.offset.saved}
          </span>
        )}
      </div>

      {save.error instanceof ApiRequestError && (
        <Alert variant="destructive" className="text-xs">
          <p className="font-medium">{save.error.body.what}</p>
          <p className="mt-1 font-medium">{save.error.body.next}</p>
        </Alert>
      )}

      <AlertDialog open={confirming} onOpenChange={setConfirming}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{copy.offset.confirmTitle}</AlertDialogTitle>
            {/* Consuming stock is irreversible; the confirmation says so plainly,
                and names the size so a wrong roll is caught before the label is. */}
            <AlertDialogDescription>
              {copy.offset.confirmBody}
              {stock !== null && ` ${copy.offset.confirmSize(stock.labelWidthMm, stock.labelHeightMm)}`}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{copy.offset.confirmCancel}</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                calibrate.mutate({
                  id: printer.id,
                  ...(stock === null ? {} : { profileId: stock.id }),
                })
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
