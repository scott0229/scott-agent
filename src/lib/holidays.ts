export const US_MARKET_HOLIDAYS = [
    // 2024
    "2024-01-01", // New Year's Day
    "2024-01-15", // Martin Luther King, Jr. Day
    "2024-02-19", // Washington's Birthday
    "2024-03-29", // Good Friday
    "2024-05-27", // Memorial Day
    "2024-06-19", // Juneteenth
    "2024-07-04", // Independence Day
    "2024-09-02", // Labor Day
    "2024-11-28", // Thanksgiving Day
    "2024-12-25", // Christmas Day

    // 2025
    "2025-01-01", // New Year's Day
    "2025-01-20", // Martin Luther King, Jr. Day
    "2025-02-17", // Washington's Birthday
    "2025-04-18", // Good Friday
    "2025-05-26", // Memorial Day
    "2025-06-19", // Juneteenth
    "2025-07-04", // Independence Day
    "2025-09-01", // Labor Day
    "2025-11-27", // Thanksgiving Day
    "2025-12-25", // Christmas Day

    // 2026
    "2026-01-01", // New Year's Day
    "2026-01-19", // Martin Luther King, Jr. Day
    "2026-02-16", // Washington's Birthday
    "2026-04-03", // Good Friday
    "2026-05-25", // Memorial Day
    "2026-06-19", // Juneteenth
    "2026-07-03", // Independence Day (observed)
    "2026-09-07", // Labor Day
    "2026-11-26", // Thanksgiving Day
    "2026-12-25"  // Christmas Day
];

export const isMarketHoliday = (date: Date): boolean => {
    // Use local time components to avoid timezone shifts
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const dateStr = `${year}-${month}-${day}`;
    return US_MARKET_HOLIDAYS.includes(dateStr);
};
