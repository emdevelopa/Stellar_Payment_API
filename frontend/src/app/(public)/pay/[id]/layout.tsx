import { Metadata } from "next";

type Props = {
  params: Promise<{ id: string }>;
};

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000";

  try {
    const res = await fetch(`${API_URL}/api/payment-status/${id}`, {
      cache: "no-store",
    });

    if (!res.ok) {
      return {
        title: "Payment Not Found",
      };
    }

    const data = await res.json();
    const payment = data.payment;

    if (!payment) {
      return {
        title: "Payment Not Found",
      };
    }

    const amount = payment.amount.toLocaleString(undefined, {
      minimumFractionDigits: 0,
      maximumFractionDigits: 7,
    });

    return {
      title: `Pay ${amount} ${payment.asset.toUpperCase()}`,
      description: payment.description || `Payment request for ${amount} ${payment.asset.toUpperCase()}`,
    };
  } catch {
    return {
      title: "Payment Request",
    };
  }
}

export default function PayLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <>{children}</>;
}
