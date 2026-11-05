/** Joins class names, skipping empty ones. */
export const cx = (...names: ReadonlyArray<string | false | null | undefined>) => names.filter(Boolean).join(" ")
