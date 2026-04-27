import { Metadata } from "next";
import KycSubmissionForm from "@/components/KycSubmissionForm";

export const metadata: Metadata = {
  title: "KYC Verification | PLUTO",
  description: "Complete your KYC verification to unlock full platform features",
};

export default function KycPage() {
  return (
    <div className="mx-auto max-w-2xl space-y-6 p-6">
      <div className="space-y-2">
        <h1 className="text-3xl font-bold text-white">KYC Verification</h1>
        <p className="text-slate-400">
          Complete the verification process to comply with regulatory requirements
          and unlock full access to platform features.
        </p>
      </div>

      <div className="rounded-2xl border border-white/10 bg-white/5 p-6 backdrop-blur">
        <KycSubmissionForm />
      </div>

      <div className="rounded-xl border border-blue-500/30 bg-blue-500/10 p-4">
        <h3 className="mb-2 font-semibold text-blue-400">Why KYC?</h3>
        <ul className="space-y-1 text-sm text-slate-400">
          <li>• Comply with regulatory requirements</li>
          <li>• Increase transaction limits</li>
          <li>• Access premium features</li>
          <li>• Enhanced account security</li>
        </ul>
      </div>
    </div>
  );
}
