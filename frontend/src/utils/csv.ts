export const convertToCSV = (data: Record<string, unknown>[]) => {
  if (!data.length) return "";

  const headers = Object.keys(data[0]);

  const rows = data.map(row =>
    headers.map(field => JSON.stringify(row[field] ?? "")).join(",")
  );

  return [headers.join(","), ...rows].join("\n");
};

export const downloadCSV = (csv: string, filename = "payments.csv") => {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });

  const url = URL.createObjectURL(blob);

  const link = document.createElement("a");
  link.href = url;
  link.setAttribute("download", filename);

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
};