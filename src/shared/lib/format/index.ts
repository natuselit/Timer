const moneyFormatter = new Intl.NumberFormat('uk-UA', {
  maximumFractionDigits: 0
});

export const INCOGNITO_FINANCIAL_MASK = '🇺🇦';

export const formatMoney = (value: number, incognitoEnabled: boolean): string =>
  incognitoEnabled ? INCOGNITO_FINANCIAL_MASK : `${moneyFormatter.format(value)} ₴`;

export const formatHourlyRate = (value: number, incognitoEnabled: boolean): string =>
  incognitoEnabled ? INCOGNITO_FINANCIAL_MASK : `${formatMoney(Math.floor(value), false)}/год`;
