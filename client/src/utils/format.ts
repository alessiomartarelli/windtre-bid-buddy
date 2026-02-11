export const formatCurrency = (value: number): string =>
  value.toLocaleString("it-IT", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });

export const formatPercent = (value: number): string => `${value.toFixed(0)}%`;

export const formatNumber = (value: number): string =>
  value.toLocaleString("it-IT", {
    maximumFractionDigits: 2,
  });
