"use client";

import { useState, type ReactNode } from "react";
import { useRouteFeedback } from "@/components/navigation/route-feedback-provider";
import { Button, type ButtonSize, type ButtonTone } from "@/components/ui/button";

type ActionButtonFormProps = {
  action: string;
  method?: "get" | "post";
  tone?: ButtonTone;
  size?: ButtonSize;
  fullWidth?: boolean;
  disabled?: boolean;
  pendingLabel: string;
  navigationLabel?: string;
  children: ReactNode;
  className?: string;
  formClassName?: string;
  leadingAdornment?: ReactNode;
  trailingAdornment?: ReactNode;
};

export function ActionButtonForm({
  action,
  method = "post",
  tone = "primary",
  size = "md",
  fullWidth = false,
  disabled = false,
  pendingLabel,
  navigationLabel,
  children,
  className,
  formClassName,
  leadingAdornment,
  trailingAdornment,
}: ActionButtonFormProps) {
  const { startNavigation } = useRouteFeedback();
  const [pending, setPending] = useState(false);

  return (
    <form
      action={action}
      method={method}
      className={formClassName}
      onSubmit={() => {
        if (disabled) {
          return;
        }

        setPending(true);
        startNavigation(navigationLabel ?? pendingLabel);
      }}
    >
      <Button
        type="submit"
        tone={tone}
        size={size}
        fullWidth={fullWidth}
        pending={pending}
        pendingLabel={pendingLabel}
        disabled={disabled}
        className={className}
        leadingAdornment={leadingAdornment}
        trailingAdornment={trailingAdornment}
      >
        {children}
      </Button>
    </form>
  );
}
