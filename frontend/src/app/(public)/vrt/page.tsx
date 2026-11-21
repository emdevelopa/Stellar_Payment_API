"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";
import CopyButton from "@/components/CopyButton";
import CheckoutQrModal from "@/components/CheckoutQrModal";
import WalletSelector from "@/components/WalletSelector";
import { TransactionResultModal } from "@/components/TransactionResultModal";

export default function VRTPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isQrModalOpen, setIsQrModalOpen] = useState(false);
  const [isResultOpen, setIsResultOpen] = useState(false);

  return (
    <div className="min-h-screen bg-black p-10 text-white">
      <h1 className="mb-8 font-mono text-xl text-mint">VRT Core Components</h1>

      <section className="mb-10 space-y-4" id="vrt-buttons">
        <h2 className="text-lg font-bold">Buttons</h2>
        <div className="flex gap-4">
          <Button variant="primary" data-testid="vrt-btn-primary">Primary Button</Button>
          <Button variant="secondary" data-testid="vrt-btn-secondary">Secondary Button</Button>
          <Button variant="primary" isLoading data-testid="vrt-btn-loading">Primary Loading</Button>
          <Button variant="primary" disabled data-testid="vrt-btn-disabled">Disabled</Button>
        </div>
        <div className="inline-flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.03] px-4 py-3">
          <span className="font-mono text-sm text-mint" data-testid="vrt-copy-value">
            sk_test_vrt_copy_glitch_signal
          </span>
          <CopyButton text="sk_test_vrt_copy_glitch_signal" className="shrink-0" />
        </div>
      </section>

      <section className="mb-10 space-y-4 max-w-sm" id="vrt-inputs">
        <h2 className="text-lg font-bold">Inputs</h2>
        <Input label="Email Address" placeholder="Enter your email" data-testid="vrt-input-default" />
        <Input label="Disabled Input" value="Cannot edit me" disabled data-testid="vrt-input-disabled" />
      </section>

      <section className="mb-10 space-y-4" id="vrt-qr">
        <h2 className="text-lg font-bold">QR Displays</h2>
        <div className="flex gap-4">
          <Button variant="secondary" onClick={() => setIsQrModalOpen(true)} data-testid="open-qr-modal-btn">
            Open Checkout QR
          </Button>
        </div>

        <div className="max-w-sm rounded-2xl border border-white/10 bg-white/5 p-6">
          <h3 className="mb-4 text-sm font-bold uppercase tracking-widest text-slate-500">Inline Wallet QR</h3>
          <WalletSelector networkPassphrase="Test SDF Network" onConnected={() => { }} />
        </div>

        <CheckoutQrModal
          isOpen={isQrModalOpen}
          onClose={() => setIsQrModalOpen(false)}
          qrValue="web+stellar:pay?destination=GABCD...&amount=100"
          paymentId="vrt-test-payment"
        />
      </section>

      <section className="mb-10 space-y-4" id="vrt-transaction-result">
        <h2 className="text-lg font-bold">Payment confirmation</h2>
        <Button
          variant="secondary"
          onClick={() => setIsResultOpen(true)}
          data-testid="open-transaction-result"
        >
          Open payment confirmation
        </Button>
        <TransactionResultModal
          isOpen={isResultOpen}
          onClose={() => setIsResultOpen(false)}
          txHash={"0123456789abcdef".repeat(4)}
          amount="25.5"
          assetCode="USDC"
          recipientDisplayName="Ada"
        />
      </section>

      <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="VRT Check">
        <p className="mb-4">This is a modal used for Visual Regression Testing.</p>
        <div className="flex justify-end gap-2">
          <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setIsModalOpen(false)}>Confirm</Button>
        </div>
      </Modal>
    </div>
  );
}
