export const lagosToday = (now = new Date()) =>
  new Date(now.getTime() + 3600000).toISOString().slice(0, 10);
