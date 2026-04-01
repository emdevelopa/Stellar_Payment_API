"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { useMerchantLogout } from "@/lib/merchant-store";
import { Modal } from "@/components/ui/Modal";

interface DangerZoneProps {
  apiKey: string;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

export default function DangerZone({ apiKey }: DangerZoneProps) {
  const router = useRouter();
  const logout = useMerchantLogout();
  
  const [isFirstModalOpen, setIsFirstModalOpen] = useState(false);
  const [isSecondModalOpen, setIsSecondModalOpen] = useState(false);
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);

  const handleDeleteAccount = async () => {
    if (deleteConfirmation !== "DELETE") {
      toast.error("Please type DELETE to confirm");
      return;
    }

    setIsDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/merchants`, {
        method: "DELETE",
        headers: { "x-api-key": apiKey },
      });

      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error ?? "Failed to delete account");
      }

      toast.success("Account successfully deleted");
      logout();
      router.push("/register");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Failed to delete account";
      toast.error(msg);
      setIsDeleting(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.2em] text-red-600">
          Account Security
        </h2>
        <p className="text-xs font-medium text-[#6B6B6B] leading-relaxed">
          Critical actions that affect your entire account infrastructure.
        </p>
      </div>

      <div className="rounded-lg border border-red-100 bg-white p-8 relative overflow-hidden">
        <div className="absolute top-0 left-0 w-full h-1 bg-red-600" />
        <div className="flex flex-col gap-8">
          <div className="flex flex-col gap-2">
            <h3 className="text-sm font-bold text-[#0A0A0A] uppercase tracking-wider">Delete Account</h3>
            <p className="text-[10px] font-medium text-[#6B6B6B] uppercase tracking-widest leading-relaxed">
              Permanently remove your merchant account and all associated data.
            </p>
          </div>

          <button
            type="button"
            onClick={() => setIsFirstModalOpen(true)}
            className="flex h-12 w-fit items-center justify-center rounded-md border border-red-200 bg-red-50 px-8 text-[10px] font-bold text-red-600 uppercase tracking-widest transition-all hover:bg-red-100"
          >
            Initiate Deletion...
          </button>
        </div>
      </div>

      <Modal
        isOpen={isFirstModalOpen}
        onClose={() => setIsFirstModalOpen(false)}
        title="Delete Account"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-sm text-[#0A0A0A] font-medium">
              Are you sure? 
            </p>
            <ul className="list-disc pl-5 text-xs text-[#6B6B6B] space-y-2">
              <li>All account information will be revoked.</li>
              <li>Payment history will be lost.</li>
              <li>This action is permanent.</li>
            </ul>
          </div>

          <div className="flex gap-3">
            <button
              onClick={() => {
                setIsFirstModalOpen(false);
                setIsSecondModalOpen(true);
              }}
              className="flex-1 h-10 rounded-md bg-red-600 font-bold text-white text-xs uppercase tracking-widest transition-all hover:bg-red-700"
            >
              Continue
            </button>
            <button
              onClick={() => setIsFirstModalOpen(false)}
              className="flex-1 h-10 rounded-md border border-[#E8E8E8] bg-white text-xs font-bold text-[#6B6B6B] uppercase tracking-widest transition-all hover:bg-[#F5F5F5]"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        isOpen={isSecondModalOpen}
        onClose={() => {
          setIsSecondModalOpen(false);
          setDeleteConfirmation("");
        }}
        title="Final Confirmation"
      >
        <div className="flex flex-col gap-6">
          <div className="flex flex-col gap-3">
            <p className="text-xs text-[#0A0A0A] font-bold uppercase tracking-widest">
              Type <span className="underline">DELETE</span>
            </p>
            <input
              type="text"
              value={deleteConfirmation}
              onChange={(e) => setDeleteConfirmation(e.target.value)}
              placeholder="DELETE"
              className="w-full rounded-md border border-[#E8E8E8] bg-[#F9F9F9] p-3 font-mono text-sm text-[#0A0A0A] outline-none focus:border-red-500"
            />
          </div>

          <div className="flex gap-4 mt-4">
            <button
              onClick={handleDeleteAccount}
              disabled={deleteConfirmation !== "DELETE" || isDeleting}
              className="flex-1 h-12 rounded-md bg-red-600 font-bold text-white text-[10px] uppercase tracking-widest transition-all hover:bg-red-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDeleting ? "Deleting..." : "Permanently Delete Account"}
            </button>
            <button
              onClick={() => {
                setIsSecondModalOpen(false);
                setDeleteConfirmation("");
              }}
              disabled={isDeleting}
              className="flex-1 h-12 rounded-md border border-[#E8E8E8] bg-white text-[10px] font-bold text-[#6B6B6B] uppercase tracking-widest transition-all hover:text-[#0A0A0A]"
            >
              Cancel
            </button>
          </div>
        </div>
      </Modal>
    </div>
  );
}
