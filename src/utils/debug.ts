const isProduction = process.env.NODE_ENV === "production";

export const debug = {
  log: (...args: any[]) => {
    if (!isProduction) {
      console.debug(...args);
    }
  },
};
