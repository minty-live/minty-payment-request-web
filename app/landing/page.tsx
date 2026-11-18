"use client";

import { useLandingHandoff } from "@minty/shared/landing";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense } from "react";
import { setAuth } from "@/lib/auth";
import { MINTY_MODULE_URL } from "@/lib/mintyUrls";

/**
 * Where accounts-api sends people: `/landing?code=<one-time code>&next=<path>&entity_id=…&
 * entity_name=…` (gap 4, 2026-11-09: a code, never the token). The shared hook swaps the code for
 * the token, stores it (lib/auth.ts) and forwards to `next` - "/" when there is none: the
 * middleware moves it to the company's own list. Nothing to land with: back into Minty's
 * `/entity` (the entity list, or sign-in). A code that cannot be swapped says so, and Continue
 * goes that same way.
 */
const HOME = "/";
const accountsApiUrl = () => MINTY_MODULE_URL;
const backIntoMinty = () => window.location.replace(`${MINTY_MODULE_URL}/entity`);

function LandingContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refused } = useLandingHandoff({
    searchParams,
    router,
    setAuth,
    home: HOME,
    onNoToken: backIntoMinty,
    accountsApiUrl,
  });

  if (refused) {
    return (
      <div className="flex min-h-dvh min-h-screen items-center justify-center bg-surface-page px-4">
        <div className="flex w-full max-w-sm flex-col items-center gap-4 text-center">
          <p role="alert" className="text-sm text-text-primary">
            {refused}
          </p>
          <button
            type="button"
            onClick={backIntoMinty}
            className="inline-flex min-h-11 cursor-pointer items-center justify-center rounded-xl bg-action-primary px-5 text-sm font-semibold text-action-on-primary hover:bg-action-primary-hover focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-border-focus active:bg-action-primary-pressed"
          >
            Continue
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-dvh min-h-screen items-center justify-center bg-surface-page">
      <span className="text-sm text-text-muted">Loading…</span>
    </div>
  );
}

export default function Landing() {
  return (
    <Suspense>
      <LandingContent />
    </Suspense>
  );
}
