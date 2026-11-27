import Image from "next/image";
import Link from "next/link";
import type { ReactNode } from "react";
import { HeaderBack, HeaderCompany } from "@minty/shared/ui";
import { NavMenu } from "@/components/ui/NavMenu";
import { ViewerBadge } from "@/components/ui/ViewerBadge";

type HeaderProps = {
  title?: string;
  showLogo?: boolean;
  brandHref?: string | null;
  /**
   * When set, shows a way back: to the page the person came from (`@minty/shared/backLink` - the
   * list as they left it, or the bill they came from), and to this address when nothing in this
   * app came before (a link, a new tab). Title is not linked to home.
   */
  backHref?: string;
  backLabel?: string;
  statusBadge?: ReactNode;
  titleActions?: ReactNode;
  companyName?: string;
  /** When true, tints the company icon green to indicate an active Xero connection. */
  xeroConnected?: boolean;
  /** Omit top safe-area padding when a row above the header already applies it. */
  suppressTopSafeArea?: boolean;
  /** Drop the bottom border (separator) — e.g. when a sticky pills row sits directly below. */
  noBorder?: boolean;
};

export function Header({
  title = "Payment Request",
  showLogo = false,
  brandHref,
  backHref,
  backLabel = "Back",
  statusBadge,
  titleActions,
  companyName = "Insert Company Here",
  xeroConnected,
  suppressTopSafeArea = false,
  noBorder = false,
}: HeaderProps) {
  const homeHref = brandHref === undefined ? "/" : brandHref;
  const showBack = Boolean(backHref);

  const brand = (
    <>
      {showLogo ? (
        <Image
          src="/minty-mark.png"
          alt=""
          width={40}
          height={40}
          priority
          className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
        />
      ) : null}
      <span className="min-w-0 cursor-default truncate text-base font-semibold text-text-primary sm:text-lg">
        {title}
      </span>
    </>
  );

  const leftSection =
    showBack && backHref ? (
      <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-2 sm:gap-3">
        {/* The way back, the same in every app (@minty/shared's HeaderBack, 2026-11-27). */}
        <HeaderBack href={backHref} label={backLabel} />
        <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
          {showLogo ? (
            <Image
              src="/minty-mark.png"
              alt=""
              width={40}
              height={40}
              priority
              className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
            />
          ) : null}
          <span className="min-w-0 cursor-default truncate text-base font-semibold text-text-primary sm:text-lg">
            {title}
          </span>
          {titleActions ? <div className="flex shrink-0 items-center">{titleActions}</div> : null}
        </div>
      </div>
    ) : homeHref ? (
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">
        {showLogo ? (
          <Link href={homeHref} className="shrink-0">
            <Image
              src="/minty-mark.png"
              alt=""
              width={40}
              height={40}
              priority
              className="h-9 w-9 shrink-0 object-contain sm:h-10 sm:w-10"
            />
          </Link>
        ) : null}
        <span className="min-w-0 cursor-default truncate text-base font-semibold text-text-primary sm:text-lg">
          {title}
        </span>
        {titleActions ? <div className="flex shrink-0 items-center">{titleActions}</div> : null}
      </div>
    ) : (
      <div className="flex min-w-0 flex-1 items-center gap-2 sm:gap-3">{brand}</div>
    );

  return (
    <header
      className={`bg-surface-card ${noBorder ? "" : "border-b border-border-default"} ${suppressTopSafeArea ? "" : "pt-[env(safe-area-inset-top,0px)]"}`}
    >
      <div className="mx-auto flex w-full max-w-[1920px] flex-row flex-wrap items-center justify-between gap-2 px-4 py-3 sm:flex-nowrap sm:gap-3 sm:px-6 sm:py-4">
        <div
          className={`flex min-w-0 min-h-10 items-center sm:min-h-0 ${statusBadge ? "flex-1 sm:flex-initial" : "flex-1"}`}
        >
          {leftSection}
        </div>
        {/* Rendered once (it reads the bill): on a phone the row has no room for it beside the
            way back, so it takes its own line under the row; from sm it sits after the title. */}
        {statusBadge ? (
          <div className="order-last flex w-full sm:order-none sm:w-auto sm:shrink-0">
            {statusBadge}
          </div>
        ) : null}
        <div
          className={`flex min-w-0 shrink-0 items-center justify-end gap-1.5 sm:gap-3 ${statusBadge ? "ml-auto" : ""}`}
        >
          <HeaderCompany name={companyName} />
          {/* The sidebar's two doors (components/ui/Sidebar.tsx, copied from minty-web): the
              initials open My Profile, the ≡ the menu. The menu's Logout is the app's. */}
          <div className="flex shrink-0 items-center gap-1.5 pl-0.5 sm:gap-2 sm:pl-2">
            <ViewerBadge />
            <NavMenu />
          </div>
        </div>
      </div>
    </header>
  );
}
