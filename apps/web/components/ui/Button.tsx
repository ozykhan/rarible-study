import type { ButtonHTMLAttributes } from "react"
import { cx } from "@/lib/cx"

export type ButtonVariant = "primary" | "secondary" | "ring" | "link"
export type ButtonSize = "lg" | "sm" | "inline"

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** primary: accent fill. secondary: outline. ring: iridescent rim (hero only). link: underlined text. */
  readonly variant?: ButtonVariant
  /** lg: page-level call to action. sm: an action inside a panel. inline: a link sized like its sentence. */
  readonly size?: ButtonSize
}

/**
 * Every button in the app. Pills for actions, a link for small asides.
 * Styles: styles/ui.css (.btn, .btn-<size>, .btn-<variant>).
 */
export function Button({ variant = "primary", size = "sm", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={cx("btn", `btn-${size}`, `btn-${variant}`, className)} {...rest} />
}
