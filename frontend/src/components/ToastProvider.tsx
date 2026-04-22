"use client";

import { Toaster } from "sonner";

export default function ToastProvider() {
  return (
    <Toaster
      position="top-right"
      theme="dark"
      closeButton
      expand={false}
      gap={8}
      toastOptions={{
        duration: 4500,
        style: {
          fontFamily: "var(--font-sans)",
          fontSize: "13.5px",
        },
      }}
    />
  );
}
