"use client";

import dynamic from "next/dynamic";
import type { ComponentProps } from "react";
import type { QRCodeSVG } from "qrcode.react";

type LazyQRCodeSVGProps = ComponentProps<typeof QRCodeSVG>;

// qrcode.react is about 45 KB (12 KB gzipped) and is only needed once a QR code is on
// screen. Loading it on demand keeps it out of the first JavaScript a payer downloads
// (#1852). It is client-only: nothing about a QR code needs to be server-rendered.
const QRCode = dynamic(() => import("qrcode.react").then((module) => module.QRCodeSVG), {
  ssr: false,
  loading: () => <div aria-hidden="true" className="h-full w-full animate-pulse rounded bg-[#F0F0F0]" />,
});

/**
 * `QRCodeSVG` loaded on demand. It takes the same props. The code's displayed size is
 * reserved while the library loads, so the page does not jump when the code appears.
 */
export default function LazyQRCodeSVG(props: LazyQRCodeSVGProps) {
  const { size = 128, style } = props;

  return (
    <div className="shrink-0" style={{ width: style?.width ?? size, height: style?.height ?? size }}>
      <QRCode {...props} />
    </div>
  );
}
