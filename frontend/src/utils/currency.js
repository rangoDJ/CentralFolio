/**
 * Converts a native amount to CAD based on the provided FX rate.
 * @param {number} amount - The amount in native currency.
 * @param {string} currency - 'CAD' or 'USD'.
 * @param {number} fxRate - The current USD/CAD exchange rate.
 * @returns {number} - The amount converted to CAD.
 */
export const toCad = (amount, currency, fxRate) => {
  if (currency === 'CAD') return amount;
  return amount * fxRate;
};

/**
 * Calculates the FX impact for a holding.
 * FX impact = shares × nativePrice × (todayRate − yesterdayRate)
 */
export const calculateFxImpact = (shares, nativePrice, todayRate, yesterdayRate) => {
  return shares * nativePrice * (todayRate - yesterdayRate);
};
