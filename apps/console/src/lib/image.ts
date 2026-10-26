/** Resizes an uploaded image in the browser and returns it as a data URL (mvp-spec C1, A1). */
export interface ResizeOptions {
  readonly maxSize: number
  readonly type: 'image/jpeg' | 'image/png' | 'image/webp'
  readonly quality?: number
}

export const PREVIEW_IMAGE: ResizeOptions = { maxSize: 1200, type: 'image/jpeg', quality: 0.82 }
export const INLINE_IMAGE: ResizeOptions = { maxSize: 1000, type: 'image/jpeg', quality: 0.8 }
export const LOGO_IMAGE: ResizeOptions = { maxSize: 256, type: 'image/png' }

export class ImageError extends Error {}

export const resizeImage = async (file: Blob, options: ResizeOptions): Promise<string> => {
  if (!file.type.startsWith('image/')) throw new ImageError('Choose an image file.')
  let bitmap: ImageBitmap
  try {
    bitmap = await createImageBitmap(file)
  } catch {
    throw new ImageError('This image cannot be read. Try a JPEG or PNG.')
  }
  const scale = Math.min(1, options.maxSize / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  const context = canvas.getContext('2d')
  if (!context) throw new ImageError('This browser cannot resize images.')
  if (options.type === 'image/jpeg') {
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, canvas.width, canvas.height)
  }
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  bitmap.close()
  return canvas.toDataURL(options.type, options.quality)
}

/** Decoded size of a base64 data URL, in bytes. */
export const dataUrlBytes = (dataUrl: string): number => {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1)
  return (
    Math.floor((base64.length * 3) / 4) - (base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0)
  )
}
