/**
 * The two JSON encodings of the protocol:
 *
 * - OLPC canonical JSON (securesystemslib `cjson`): the bytes that get signed.
 * - Go `encoding/json` pretty output: the bytes that get written. go-tuf writes
 *   metadata with `json.MarshalIndent(meta, "", "\t")` and the Go SDK writes items
 *   with a two-space `json.Encoder` without HTML escaping. go-tuf re-marshals what it
 *   loads before checking snapshot hashes, so metadata files must match it exactly.
 *
 * Both sort object keys by UTF-8 bytes (Go's string order) and drop `undefined`
 * members. Only integers are allowed (TUF tooling rejects floats).
 */

const loneSurrogate = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

/** UTF-16 code point order equals UTF-8 byte order. */
const compareCodePoints = (a: string, b: string): number => {
  const left = a[Symbol.iterator]()
  const right = b[Symbol.iterator]()
  for (;;) {
    const x = left.next()
    const y = right.next()
    if (x.done || y.done) return x.done === y.done ? 0 : x.done ? -1 : 1
    const cx = x.value.codePointAt(0) ?? 0
    const cy = y.value.codePointAt(0) ?? 0
    if (cx !== cy) return cx - cy
  }
}

const checkString = (value: string): string => {
  if (loneSurrogate.test(value)) throw new TypeError('JSON: string contains a lone surrogate')
  return value
}

const checkInteger = (value: number): string => {
  if (!Number.isSafeInteger(value)) throw new TypeError(`JSON: ${value} is not a safe integer`)
  return String(value)
}

const sortedEntries = (value: object): Array<[string, unknown]> =>
  Object.entries(value)
    .filter(([, member]) => member !== undefined)
    .sort(([a], [b]) => compareCodePoints(a, b))

const isPlainObject = (value: object): boolean => {
  const proto = Object.getPrototypeOf(value)
  return proto === Object.prototype || proto === null
}

const canonicalString = (value: string): string =>
  `"${checkString(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`

const encodeCanonical = (value: unknown): string => {
  if (value === null) return 'null'
  switch (typeof value) {
    case 'boolean':
      return value ? 'true' : 'false'
    case 'number':
      return checkInteger(value)
    case 'string':
      return canonicalString(value)
    case 'object':
      if (Array.isArray(value)) return `[${value.map(encodeCanonical).join(',')}]`
      if (!isPlainObject(value)) break
      return `{${sortedEntries(value)
        .map(([key, member]) => `${canonicalString(key)}:${encodeCanonical(member)}`)
        .join(',')}}`
  }
  throw new TypeError(`JSON: cannot encode ${typeof value}`)
}

/** OLPC canonical JSON text. */
export const canonicalJson = (value: unknown): string => encodeCanonical(value)

const shortEscapes: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
}

/** A string as Go's `encoding/json` writes it. */
export const goString = (value: string, escapeHtml: boolean): string => {
  let out = '"'
  for (const char of checkString(value)) {
    const code = char.codePointAt(0) ?? 0
    const needsUnicode =
      code < 0x20 || code === 0x2028 || code === 0x2029 || (escapeHtml && '<>&'.includes(char))
    out += shortEscapes[char] ?? (needsUnicode ? `\\u${code.toString(16).padStart(4, '0')}` : char)
  }
  return `${out}"`
}

export interface GoJsonOptions {
  readonly indent: string
  readonly escapeHtml: boolean
}

/** Byte-compatible with Go's `json.MarshalIndent` / indenting `json.Encoder` (no trailing newline). */
export const goJson = (value: unknown, options: GoJsonOptions): string => {
  const encode = (member: unknown, depth: number): string => {
    if (member === null) return 'null'
    switch (typeof member) {
      case 'boolean':
        return member ? 'true' : 'false'
      case 'number':
        return checkInteger(member)
      case 'string':
        return goString(member, options.escapeHtml)
      case 'object': {
        const inner = options.indent.repeat(depth + 1)
        const outer = options.indent.repeat(depth)
        if (Array.isArray(member)) {
          if (member.length === 0) return '[]'
          return `[\n${member.map((item) => inner + encode(item, depth + 1)).join(',\n')}\n${outer}]`
        }
        if (!isPlainObject(member)) break
        const entries = sortedEntries(member)
        if (entries.length === 0) return '{}'
        const lines = entries.map(
          ([key, item]) =>
            `${inner}${goString(key, options.escapeHtml)}: ${encode(item, depth + 1)}`,
        )
        return `{\n${lines.join(',\n')}\n${outer}}`
      }
    }
    throw new TypeError(`JSON: cannot encode ${typeof member}`)
  }
  return encode(value, 0)
}
