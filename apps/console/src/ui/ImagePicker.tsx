import { useId, useState } from 'react'
import { type ResizeOptions, resizeImage } from '../lib/image.ts'
import { Button } from './kit.tsx'

/** A file input that resizes the picked image and hands back a data URL. */
export const ImagePicker = ({
  label,
  value,
  options,
  onChange,
  hint,
}: {
  readonly label: string
  readonly value: string | undefined
  readonly options: ResizeOptions
  readonly onChange: (dataUrl: string | undefined) => void
  readonly hint?: string
}) => {
  const id = useId()
  const [error, setError] = useState<string>()
  return (
    <div className="field">
      <label htmlFor={id}>
        {label} <span className="optional">(optional)</span>
      </label>
      <div className="dropzone">
        {value ? <img src={value} alt="" /> : <div className="muted tiny">No image</div>}
        <div className="row">
          <input
            id={id}
            className="visually-hidden"
            type="file"
            accept="image/*"
            onChange={async (event) => {
              const file = event.target.files?.[0]
              event.target.value = ''
              if (!file) return
              setError(undefined)
              try {
                onChange(await resizeImage(file, options))
              } catch (e) {
                setError((e as Error).message)
              }
            }}
          />
          <label htmlFor={id} className="button button-small button-quiet">
            {value ? 'Replace' : 'Choose image'}
          </label>
          {value && (
            <Button small variant="quiet" onClick={() => onChange(undefined)}>
              Remove
            </Button>
          )}
        </div>
      </div>
      {hint && <p className="field-hint">{hint}</p>}
      {error && <p className="field-error">{error}</p>}
    </div>
  )
}
