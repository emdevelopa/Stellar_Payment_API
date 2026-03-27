/**
 * Utility: CSV Export for Transaction History
 * Issue #175 – [FE] CSV Export for Transaction History
 */

export interface Transaction {
  id:                 string;
  createdAt:          string;
  type:               string;
  status:             string;
  amount:             string;
  asset:              string;
  sourceAccount:      string;
  destAccount:        string;
  memo?:              string;
  memoType?:          string;
  fee?:               string;
  ledger?:            string;
  hash:               string;
  networkPassphrase?: string;
  pagingToken?:       string;
  [key: string]:      string | undefined;
}

export interface CsvColumn {
  key:   keyof Transaction | string;
  label: string;
}

export const CSV_COLUMNS: CsvColumn[] = [
  { key: "id",                label: "Transaction ID"      },
  { key: "createdAt",         label: "Date / Time (UTC)"   },
  { key: "type",              label: "Type"                },
  { key: "status",            label: "Status"              },
  { key: "amount",            label: "Amount"              },
  { key: "asset",             label: "Asset"               },
  { key: "sourceAccount",     label: "Source Account"      },
  { key: "destAccount",       label: "Destination Account" },
  { key: "memo",              label: "Memo"                },
  { key: "memoType",          label: "Memo Type"           },
  { key: "fee",               label: "Fee (XLM)"           },
  { key: "ledger",            label: "Ledger"              },
  { key: "hash",              label: "Transaction Hash"    },
  { key: "networkPassphrase", label: "Network"             },
  { key: "pagingToken",       label: "Paging Token"        },
];

function escapeCell(value: string | undefined | null): string {
  if (value === null || value === undefined) return "";
  const str = String(value);
  if (str.includes(",") || str.includes("\n") || str.includes('"')) {
    return `"${str.replace(/"/g, '""')}"`;
  }
  return str;
}

function formatTimestamp(iso: string | undefined): string {
  if (!iso) return "";
  try {
    return new Date(iso).toUTCString();
  } catch {
    return iso;
  }
}

export function transactionsToCsv(
  transactions: Transaction[],
  columns: CsvColumn[] = CSV_COLUMNS
): string {
  const header = columns.map((c) => escapeCell(c.label)).join(",");

  const rows = transactions.map((tx) =>
    columns
      .map(({ key }) => {
        const value = key === "createdAt"
          ? formatTimestamp(tx[key])
          : tx[key];
        return escapeCell(value);
      })
      .join(",")
  );

  // UTF-8 BOM ensures Excel opens the file with correct encoding
  return "\uFEFF" + [header, ...rows].join("\r\n");
}

export function downloadCsv(
  csvContent: string,
  filename: string = `transactions_${new Date().toISOString().slice(0, 10)}.csv`
): void {
  const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
  const url  = URL.createObjectURL(blob);

  const link         = document.createElement("a");
  link.href          = url;
  link.download      = filename;
  link.style.display = "none";

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export function exportTransactionsToCsv(
  transactions: Transaction[],
  filename?: string
): void {
  const csv = transactionsToCsv(transactions);
  downloadCsv(csv, filename);
}
