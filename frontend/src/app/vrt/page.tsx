"use client";

import React, { useState } from "react";
import { Button } from "@/components/ui/Button";
import { Input } from "@/components/ui/Input";
import { Modal } from "@/components/ui/Modal";

export default function VRTPage() {
  const [isModalOpen, setIsModalOpen] = useState(false);

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
      </section>

      <section className="mb-10 space-y-4 max-w-sm" id="vrt-inputs">
        <h2 className="text-lg font-bold">Inputs</h2>
        <Input label="Email Address" placeholder="Enter your email" data-testid="vrt-input-default" />
        <Input label="Disabled Input" value="Cannot edit me" disabled data-testid="vrt-input-disabled" />
      </section>

      <section className="mb-10 space-y-4" id="vrt-modals">
        <h2 className="text-lg font-bold">Modals</h2>
        <Button variant="secondary" onClick={() => setIsModalOpen(true)} data-testid="open-modal-btn">
          Open VRT Modal
        </Button>

        <Modal isOpen={isModalOpen} onClose={() => setIsModalOpen(false)} title="VRT Check">
          <p className="mb-4">This is a modal used for Visual Regression Testing.</p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setIsModalOpen(false)}>Cancel</Button>
            <Button variant="primary" onClick={() => setIsModalOpen(false)}>Confirm</Button>
          </div>
        </Modal>
      </section>
    </div>
  );
}
