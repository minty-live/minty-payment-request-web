import type { ReactNode } from "react";

type LoadingScreenProps = {
  message?: string;
  showMessage?: boolean;
  embedded?: boolean;
  children?: ReactNode;
};

export function LoadingScreen({
  message = "Loading…",
  showMessage = false,
  embedded = false,
  children,
}: LoadingScreenProps) {
  const content = (
    <>
      <div className="h-10 w-10 animate-spin rounded-full border-4 border-border-default border-t-action-primary" />
      {showMessage && message ? (
        <p className="mt-6 text-sm text-text-secondary">{message}</p>
      ) : null}
    </>
  );

  if (embedded) {
    return (
      <div
        className="flex min-h-0 flex-1 flex-col w-full"
        role="status"
        aria-live="polite"
        aria-busy="true"
      >
        <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-4">
          {content}
        </div>
        {children}
      </div>
    );
  }

  return (
    <div
      className="flex min-h-dvh min-h-screen flex-col items-center justify-center bg-surface-card"
      role="status"
      aria-live="polite"
      aria-busy="true"
    >
      {content}
    </div>
  );
}
