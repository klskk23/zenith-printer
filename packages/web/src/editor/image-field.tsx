/**
 * Picking the file behind an image element.
 *
 * The image element, the storage endpoint and the renderer's `resolveImage`
 * hook all existed before this did — which meant an image could be added to a
 * label, drawn as an empty box, and never given a picture, because nothing in
 * the interface ever asked for one.
 */
import { useRef, useState } from 'react'
import type { ImageElement } from '@zenith/shared'
import { copy } from '../i18n/index.ts'
import { Button } from '../components/ui/button.tsx'
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_IMAGE_BYTES,
  imageRejectionReason,
  naturalSizeOf,
  useUploadImage,
} from '../features/images/hooks.ts'
import { ApiRequestError } from '../api/client.ts'

/** Leaves the element's box exactly as it is; see `imageBoxMm`. */
const NO_NATURAL_SIZE = { width: 0, height: 0 }

export interface ImageFieldProps {
  element: ImageElement
  /**
   * Given the stored asset and the picture's own pixel dimensions, so the
   * caller can correct the element's proportions. Without the natural size the
   * picture is letterboxed into whatever box the element happened to have.
   */
  onChange: (assetId: string, natural: { width: number; height: number }) => void
}

export function ImageField({ element, onChange }: ImageFieldProps): React.JSX.Element {
  const input = useRef<HTMLInputElement>(null)
  const [error, setError] = useState<string | null>(null)
  const uploader = useUploadImage()
  const chosen = element.assetId.length > 0

  const send = (file: File): void => {
    const rejection = imageRejectionReason(file)
    if (rejection !== null) {
      setError(
        rejection === 'type'
          ? copy.editor.image.rejectedType
          : copy.editor.image.rejectedSize(Math.round(MAX_IMAGE_BYTES / 1024 / 1024)),
      )
      return
    }
    setError(null)

    // Measured alongside the upload, not before it. Awaiting the measurement
    // first means a picture the browser is slow to decode — or one whose load
    // event never arrives at all — takes the upload down with it, and the user
    // gets no image and no error, just nothing.
    const measuring = naturalSizeOf(file)
    uploader.mutate(file, {
      onSuccess: (asset) => {
        onChange(asset.id, NO_NATURAL_SIZE)
        void measuring.then((natural) => {
          if (natural.width > 0 && natural.height > 0) {
            onChange(asset.id, natural)
          }
        })
      },
      // The server words its own failures; repeating them here in different
      // prose would give one fault two descriptions.
      onError: (cause) => setError(cause instanceof ApiRequestError ? cause.body.what : null),
    })
  }

  return (
    <div className="space-y-2">
      <input
        ref={input}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(',')}
        className="hidden"
        aria-label={copy.editor.fields.image}
        onChange={(event) => {
          const file = event.target.files?.[0]
          if (file !== undefined) {
            send(file)
          }
          // Cleared so choosing the same file twice in a row still fires a
          // change event — otherwise a failed upload cannot be retried with
          // the same file.
          event.target.value = ''
        }}
      />
      <Button
        variant="outline"
        size="sm"
        className="w-full"
        disabled={uploader.isPending}
        onClick={() => input.current?.click()}
      >
        {uploader.isPending
          ? copy.editor.image.uploading
          : chosen
            ? copy.editor.image.replace
            : copy.editor.image.choose}
      </Button>

      {chosen ? (
        <img
          src={`/api/images/${element.assetId}/content`}
          alt=""
          className="max-h-24 w-full rounded border border-border object-contain"
        />
      ) : (
        <p className="text-xs text-muted-foreground">{copy.editor.image.notChosen}</p>
      )}

      <p className="text-2xs text-muted-foreground">{copy.editor.image.pasteHint}</p>
      {error !== null && <p className="text-xs text-destructive">{error}</p>}
    </div>
  )
}
