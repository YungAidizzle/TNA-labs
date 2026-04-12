"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { useRouteFeedback } from "@/components/navigation/route-feedback-provider";
import { joinClasses } from "@/components/ui/button";

type InteractiveLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  pendingLabel?: ReactNode;
  navigationLabel?: string;
  target?: string;
  rel?: string;
  ariaLabel?: string;
  active?: boolean;
};

function isModifiedEvent(event: MouseEvent<HTMLAnchorElement>) {
  return Boolean(
    event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0,
  );
}

export function InteractiveLink({
  href,
  children,
  className,
  pendingLabel,
  navigationLabel,
  target,
  rel,
  ariaLabel,
  active = false,
}: InteractiveLinkProps) {
  const pathname = usePathname();
  const { startNavigation } = useRouteFeedback();
  const [pending, setPending] = useState(false);

  useEffect(() => {
    setPending(false);
  }, [pathname]);

  function handleClick(event: MouseEvent<HTMLAnchorElement>) {
    if (event.defaultPrevented || isModifiedEvent(event) || target === "_blank") {
      return;
    }

    if (!href.startsWith("/") && !href.startsWith("#")) {
      return;
    }

    const currentUrl = new URL(window.location.href);
    const nextUrl = new URL(href, window.location.origin);
    const hashOnlyChange =
      nextUrl.pathname === currentUrl.pathname &&
      nextUrl.search === currentUrl.search &&
      nextUrl.hash.length > 0;

    if (hashOnlyChange) {
      return;
    }

    setPending(true);
    startNavigation(navigationLabel ?? (typeof pendingLabel === "string" ? pendingLabel : null));
  }

  return (
    <Link
      href={href}
      target={target}
      rel={rel}
      aria-busy={pending || undefined}
      aria-label={ariaLabel}
      data-active={active ? "true" : undefined}
      data-pending={pending ? "true" : "false"}
      onClick={handleClick}
      className={joinClasses(
        "transition-[opacity,border-color,background-color,color,transform] duration-200",
        pending && "pointer-events-none opacity-80",
        className,
      )}
    >
      {pending && pendingLabel ? pendingLabel : children}
    </Link>
  );
}
