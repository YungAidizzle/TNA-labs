import type { ButtonHTMLAttributes, ReactNode } from "react";

export type ButtonTone = "primary" | "secondary" | "quiet";
export type ButtonSize = "sm" | "md" | "lg";

type ButtonClassOptions = {
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidth?: boolean;
  pending?: boolean;
  className?: string;
};

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidth?: boolean;
  pending?: boolean;
  pendingLabel?: ReactNode;
  leadingAdornment?: ReactNode;
  trailingAdornment?: ReactNode;
};

export function joinClasses(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(" ");
}

export function buttonClassName({
  tone = "primary",
  size = "md",
  fullWidth = false,
  pending = false,
  className,
}: ButtonClassOptions = {}) {
  return joinClasses(
    "app-button group relative inline-flex cursor-pointer select-none items-center justify-center overflow-hidden border font-semibold uppercase tracking-[0.16em] transition-[transform,border-color,background-color,color,opacity,box-shadow] duration-200",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan/45 focus-visible:ring-offset-2 focus-visible:ring-offset-[#020508]",
    "disabled:cursor-not-allowed disabled:opacity-60",
    size === "sm" && "h-10 px-4 text-[11px]",
    size === "md" && "h-11 px-5 text-[12px]",
    size === "lg" && "h-12 px-6 text-[12px]",
    tone === "primary" &&
      "border-cyan/30 bg-[linear-gradient(180deg,rgba(17,57,71,0.94),rgba(7,20,29,0.98))] text-[#effdff] shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_18px_32px_rgba(0,0,0,0.24)] hover:-translate-y-px hover:border-cyan/46 hover:bg-[linear-gradient(180deg,rgba(22,66,82,0.98),rgba(8,22,31,0.99))] hover:text-white hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.1),0_22px_38px_rgba(0,0,0,0.28),0_0_0_1px_rgba(86,217,255,0.08)] active:translate-y-[1px] active:border-cyan/55 active:bg-[linear-gradient(180deg,rgba(14,46,59,0.98),rgba(6,17,24,1))] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.08),0_12px_22px_rgba(0,0,0,0.24)]",
    tone === "secondary" &&
      "border-white/[0.12] bg-white/[0.03] text-[#d6e0ee] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] hover:-translate-y-px hover:border-white/[0.24] hover:bg-white/[0.055] hover:text-[#f4f8ff] hover:shadow-[inset_0_1px_0_rgba(255,255,255,0.06),0_14px_28px_rgba(0,0,0,0.16)] active:translate-y-[1px] active:border-white/[0.2] active:bg-white/[0.04] active:shadow-[inset_0_1px_0_rgba(255,255,255,0.04),0_10px_18px_rgba(0,0,0,0.14)]",
    tone === "quiet" &&
      "border-transparent bg-transparent text-[#8fa5bd] hover:-translate-y-px hover:border-white/[0.08] hover:bg-white/[0.03] hover:text-[#f4f8ff] active:translate-y-[1px] active:border-white/[0.08] active:bg-white/[0.025]",
    fullWidth && "w-full",
    pending &&
      "pointer-events-none translate-y-0 border-cyan/28 shadow-[inset_0_1px_0_rgba(255,255,255,0.07),0_16px_28px_rgba(0,0,0,0.2)]",
    className,
  );
}

function PendingBars() {
  return (
    <span aria-hidden="true" className="inline-flex h-3 items-end gap-[3px]">
      <span className="h-[8px] w-[3px] animate-pulse bg-current opacity-70" />
      <span
        className="h-[11px] w-[3px] animate-pulse bg-current opacity-90"
        style={{ animationDelay: "120ms" }}
      />
      <span
        className="h-[6px] w-[3px] animate-pulse bg-current opacity-60"
        style={{ animationDelay: "240ms" }}
      />
    </span>
  );
}

export function Button({
  tone = "primary",
  size = "md",
  fullWidth = false,
  pending = false,
  pendingLabel,
  leadingAdornment,
  trailingAdornment,
  className,
  children,
  disabled,
  type = "button",
  ...props
}: ButtonProps) {
  const content = pending && pendingLabel ? pendingLabel : children;

  return (
    <button
      {...props}
      type={type}
      aria-busy={pending || undefined}
      disabled={disabled || pending}
      className={buttonClassName({
        tone,
        size,
        fullWidth,
        pending,
        className,
      })}
      data-pending={pending ? "true" : "false"}
    >
      <span className="pointer-events-none absolute inset-0 border-t border-white/[0.06]" />
      <span className="relative z-[1] inline-flex items-center gap-2">
        {pending ? <PendingBars /> : leadingAdornment}
        <span>{content}</span>
        {!pending ? trailingAdornment : null}
      </span>
    </button>
  );
}
